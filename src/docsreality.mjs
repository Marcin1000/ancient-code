import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { findDocs } from './docs-files.mjs';

const run = promisify(execFile);

/**
 * Is the documentation still about this repository?
 *
 * Whether documentation is good cannot be measured, and any tool claiming
 * otherwise is guessing. Whether it describes a repository that no longer
 * exists can be measured exactly: a command that is gone, a path that was
 * renamed, a setting nobody reads any more.
 *
 * This is the same shape as a dead fence. The instruction outlived the thing
 * it pointed at, and the next person follows it into a wall.
 */

const DOC_CANDIDATES = [
  'README.md', 'readme.md', 'CONTRIBUTING.md', 'DEVELOPMENT.md',
  'docs/README.md', 'docs/development.md', 'docs/setup.md', 'docs/deployment.md',
];

// Things a new team has to do on day one and cannot guess.
const OPERATIONS = [
  { id: 'deploy', re: /\bdeploy|wdro[żz]|publish|release\b/i, what: 'how to deploy it' },
  { id: 'backup', re: /\bbackup|kopi[aę] zapasow|restore|odtworz/i, what: 'how to restore a backup' },
  { id: 'secrets', re: /\bsecret|token|api[ _-]?key|klucz|rotat/i, what: 'where the secrets live and how to rotate them' },
];

export async function docsReality(repo, { staleMonths = 18 } = {}) {
  const docs = [];
  for (const path of await findDocs(repo, DOC_CANDIDATES)) {
    const text = await readIf(join(repo, path));
    if (text) docs.push({ path, text });
  }
  if (docs.length === 0) {
    return {
      docs: [],
      findings: [{ kind: 'no docs', what: 'no README or contributing guide at all', where: '/' }],
      verdict: { level: 'risk', why: 'there is no documentation to check' },
    };
  }

  const findings = [];
  const missing = [];
  const ok = [];
  const all = docs.map((d) => d.text).join('\n');

  const scripts = await packageScripts(repo);
  const projectName = await packageName(repo);
  for (const doc of docs) {
    // A command the documentation tells you to run, that the project no longer
    // defines, is the clearest possible proof that nobody re-read this.
    for (const m of doc.text.matchAll(/\b(?:npm|yarn|pnpm) run ([\w:.-]+)/g)) {
      const name = m[1];
      // Documentation names families of scripts and leaves placeholders in
      // them: puppeteer writes test:chrome:** and test:chrome:<test-type>.
      // Read literally, both became "this script no longer exists".
      if (isPattern(name, doc.text, m.index + m[0].length)) continue;
      if (scripts && scripts.size > 0 && !scripts.has(name)) {
        findings.push({
          kind: 'command is gone',
          what: `the docs tell you to run "${name}", which the project no longer defines`,
          where: doc.path,
        });
      }
    }

    for (const path of referencedPaths(doc.text)) {
      const candidates = pathCandidates(path, projectName);
      let here = false;
      for (const c of candidates) if (await exists(join(repo, c))) { here = true; break; }
      if (!here && !describedAsGenerated(doc.text, path)) missing.push({ path, where: doc.path });
    }
  }

  // A file the repository deliberately ignores is absent on purpose, not by
  // neglect. puppeteer tells you to copy .vscode/launch.template.json to
  // .vscode/launch.json, a file every contributor creates and git is told to
  // ignore. Calling that a broken instruction is a false accusation.
  const ignored = await gitIgnored(repo, missing.map((m) => m.path));
  for (const m of missing) {
    if (ignored.has(m.path)) continue;
    findings.push({ kind: 'path is gone', what: `the docs point at ${m.path}, which is not here`, where: m.where });
  }

  for (const op of OPERATIONS) {
    if (!op.re.test(all)) {
      findings.push({ kind: 'unanswered question', what: `nothing says ${op.what}`, where: docs[0].path });
    } else {
      ok.push(`documented: ${op.what}`);
    }
  }

  // Documentation and the code it describes drift apart silently. Git knows
  // when each was last touched, and the gap is the finding.
  const drift = await staleness(repo, docs.map((d) => d.path));
  if (drift && drift.months > staleMonths) {
    findings.push({
      kind: 'stale',
      what: `the documentation has not been touched for ${Math.round(drift.months)} months, while the code was changed ${drift.codeDate}`,
      where: drift.doc,
    });
  } else if (drift) {
    ok.push(`documentation was last touched ${drift.docDate}`);
  }

  return { docs: docs.map((d) => d.path), findings, ok, verdict: verdictFor(findings) };
}

function verdictFor(findings) {
  const broken = findings.filter((f) => ['command is gone', 'path is gone', 'no docs'].includes(f.kind));
  if (broken.length > 0) {
    return {
      level: 'risk',
      why: broken.length === 1
        ? 'one instruction in the documentation points at something that is not there any more'
        : `${broken.length} instructions in the documentation point at something that is not there any more`,
    };
  }
  const stale = findings.find((f) => f.kind === 'stale');
  if (stale) return { level: 'watch', why: stale.what };
  const missing = findings.filter((f) => f.kind === 'unanswered question');
  if (missing.length > 1) {
    return { level: 'watch', why: `${missing.length} day-one questions are unanswered: ${missing.map((f) => f.what.replace('nothing says ', '')).join('; ')}` };
  }
  return { level: 'ok', why: 'the documentation matches the repository and covers the first day' };
}

/**
 * Paths a document points at. Only ones that look like real repository paths,
 * because a false "this file is missing" is worse than a missed one.
 */
/**
 * Whether the documentation introduces this path as something the build makes.
 * "Generated artifacts (such as `src/types.ts`) can become stale" is not a
 * broken instruction: the file is absent from a clean checkout on purpose, and
 * reporting it as gone reads as rot where there is none.
 */
export function describedAsGenerated(text, path) {
  const at = text.indexOf(path);
  if (at < 0) return false;
  const before = text.slice(Math.max(0, at - 160), at).toLowerCase();
  return /\b(generated|generates|artifacts?|build output|is created|are created|produced by|autogenerated|auto-generated)\b/.test(before);
}

export function referencedPaths(text) {
  const found = new Set();
  // A backticked path used as the label of a link is not an instruction to look
  // in the repository, it is the caption on a URL that already says where the
  // file lives. puppeteer writes [`third_party/README.md`](https://.../packages/
  // puppeteer-core/third_party/README.md), and reading only the label made the
  // report accuse them of a broken instruction that is not broken.
  const withoutLinkLabels = text.replace(/\[(`[^`\]]*`|[^\]]*)\]\(https?:[^)]*\)/g, ' ');
  const patterns = [
    [/`([\w.-]+\/[\w./-]+\.\w{1,5})`/g, withoutLinkLabels],     // `src/thing.js` in backticks
    [/\]\((?!https?:|#|mailto:)([\w./-]+\.\w{1,5})\)/g, text],  // markdown link to a file
  ];
  for (const [re, source] of patterns) {
    for (const m of source.matchAll(re)) {
      const p = m[1].replace(/^\.\//, '');
      if (p.startsWith('/') || p.includes('..') || p.includes('*')) continue;
      if (/^(node_modules|dist|build)\//.test(p)) continue;
      found.add(p);
    }
  }
  return [...found];
}

/**
 * Documentation routinely writes a path from outside the checkout: webpack's
 * CONTRIBUTING says `webpack/lib/index.js` for a file that sits at lib/index.js.
 * Reading that literally produced a RISK verdict on a file that is right there,
 * which is the worst thing this tool can do: a confident, false accusation.
 */
/**
 * Whether a script name is a stand-in rather than something to type: it ends in
 * a separator with nothing after it, carries a glob, or is followed by a
 * placeholder in angle brackets.
 */
export function isPattern(name, text = '', endsAt = -1) {
  if (/[:.\-]$/.test(name) || name.includes('*')) return true;
  if (endsAt >= 0 && /^[<{[]/.test(text.slice(endsAt))) return true;
  return false;
}

export function pathCandidates(path, projectName) {
  const out = [path];
  const first = path.split('/')[0];
  if (projectName && (first === projectName || first === projectName.split('/').pop())) {
    out.push(path.slice(first.length + 1));
  }
  return out;
}

async function packageScripts(repo) {
  const text = await readIf(join(repo, 'package.json'));
  if (!text) return null;
  try {
    return new Set(Object.keys(JSON.parse(text).scripts ?? {}));
  } catch {
    return null;
  }
}

/**
 * Which of these paths the repository itself tells git to ignore. One call for
 * the whole list, because a spawn per path on a large documentation set is the
 * difference between a fast tool and one people stop running.
 */
async function gitIgnored(repo, paths) {
  const out = new Set();
  if (paths.length === 0) return out;
  // The paths come from documentation, so there are tens of them at most and
  // they fit on a command line. Reading them from stdin needs a writable pipe,
  // which execFile does not give, and the first attempt hung waiting for one.
  const list = [...new Set(paths)];
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    try {
      const { stdout } = await run('git', ['check-ignore', '--no-index', '--', ...chunk], {
        cwd: repo, maxBuffer: 4 * 1024 * 1024,
      });
      for (const line of stdout.split(/\r?\n/)) if (line) out.add(line.trim());
    } catch (err) {
      // Exit code 1 means nothing in this chunk matched, which is an answer.
      // Anything else (no git, not a repository) leaves the set as it is and
      // the check falls back to reporting what it found.
      if (err.code === 1 && err.stdout) {
        for (const line of err.stdout.split(/\r?\n/)) if (line) out.add(line.trim());
      }
    }
  }
  return out;
}

async function packageName(repo) {
  const text = await readIf(join(repo, 'package.json'));
  if (!text) return null;
  try {
    return JSON.parse(text).name ?? null;
  } catch {
    return null;
  }
}

async function staleness(repo, docPaths) {
  const docDate = await lastCommitDate(repo, docPaths);
  const codeDate = await lastCommitDate(repo, ['.']);
  if (!docDate || !codeDate) return null;
  const months = (new Date(codeDate) - new Date(docDate)) / (30.44 * 24 * 3600 * 1000);
  return { doc: docPaths[0], docDate, codeDate, months };
}

async function lastCommitDate(repo, paths) {
  try {
    const { stdout } = await run('git', ['log', '-1', '--format=%ad', '--date=short', '--', ...paths], { cwd: repo });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readIf(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
