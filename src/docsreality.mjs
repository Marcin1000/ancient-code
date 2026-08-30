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
  const ok = [];
  const all = docs.map((d) => d.text).join('\n');

  const scripts = await packageScripts(repo);
  for (const doc of docs) {
    // A command the documentation tells you to run, that the project no longer
    // defines, is the clearest possible proof that nobody re-read this.
    for (const m of doc.text.matchAll(/\b(?:npm|yarn|pnpm) run ([\w:.-]+)/g)) {
      const name = m[1];
      if (scripts && scripts.size > 0 && !scripts.has(name)) {
        findings.push({
          kind: 'command is gone',
          what: `the docs tell you to run "${name}", which the project no longer defines`,
          where: doc.path,
        });
      }
    }

    for (const path of referencedPaths(doc.text)) {
      if (!(await exists(join(repo, path)))) {
        findings.push({ kind: 'path is gone', what: `the docs point at ${path}, which is not here`, where: doc.path });
      }
    }
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
export function referencedPaths(text) {
  const found = new Set();
  const patterns = [
    /`([\w.-]+\/[\w./-]+\.\w{1,5})`/g,            // `src/thing.js` in backticks
    /\]\((?!https?:|#|mailto:)([\w./-]+\.\w{1,5})\)/g, // markdown link to a file
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const p = m[1].replace(/^\.\//, '');
      if (p.startsWith('/') || p.includes('..') || p.includes('*')) continue;
      if (/^(node_modules|dist|build)\//.test(p)) continue;
      found.add(p);
    }
  }
  return [...found];
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
