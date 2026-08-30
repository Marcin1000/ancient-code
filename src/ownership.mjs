import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';

const run = promisify(execFile);

// Record and field separators in the git log output. Chosen because they
// cannot appear in an author name or a file path.
const REC = '\u0001';
const FLD = '\u0002';

/**
 * Who actually understands each part of the system.
 *
 * Read from authorship history rather than from a staffing plan, because a
 * staffing plan describes intentions and git describes what happened. The
 * number that matters to a client is not how many developers a vendor employs.
 * It is how many of them have ever touched the module that runs payments.
 */
export async function ownership(repo, { sinceYears = 3, maxModules = 40, maxCommits = 20000 } = {}) {
  // Node reports a missing working directory and a missing git binary with the
  // same ENOENT, so without this check pointing at a path that does not exist
  // was reported as "git is not on the PATH". That is a false statement about
  // the reader's machine, and it sends them looking in the wrong place.
  const here = await directory(repo);
  if (here) return { error: here, modules: [] };

  const years = Number(sinceYears);
  if (!Number.isFinite(years) || years <= 0) {
    return { error: `history window must be a positive number of years, not "${sinceYears}"`, modules: [] };
  }

  const since = new Date();
  since.setFullYear(since.getFullYear() - years);
  const sinceArg = since.toISOString().slice(0, 10);

  let stdout;
  try {
    ({ stdout } = await run('git', [
      // Two flags carry real weight here. --name-only instead of --numstat,
      // because counting lines has to diff file contents and a formatting
      // sweep is not understanding anyway. And --no-renames, because with
      // rename detection this same query took over two minutes on a mid-sized
      // repository and 0.4 seconds without it.
      'log', `--since=${sinceArg}`, '--no-merges', '--no-renames',
      '-n', String(maxCommits),
      '--format=%x01%an%x02%ad', '--date=short', '--name-only',
    ], { cwd: repo, maxBuffer: 256 * 1024 * 1024 }));
  } catch (err) {
    return { error: humanReason(err), modules: [] };
  }

  return summarize(stdout, { sinceYears: years, maxModules });
}

/** Split out so the parsing is testable without a repository. */
export function summarize(stdout, { sinceYears = 3, maxModules = 40 } = {}) {
  const modules = new Map();    // module -> Map(author -> changes)
  const lastTouch = new Map();  // module -> latest date seen
  const authorLast = new Map(); // author -> latest date seen anywhere

  const display = new Map(); // normalised author -> the prettiest spelling seen
  let author = null;
  let date = null;
  let seenInCommit = new Set();
  // Git for Windows can hand back CRLF. The date sits at the end of the record
  // line, so a stray carriage return would ride along inside every "last seen"
  // date and quietly poison the comparisons that pick the busiest author.
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(REC)) {
      const [raw, d] = line.slice(1).split(FLD);
      author = normalizeAuthor(raw);
      date = d;
      seenInCommit = new Set();
      if (author) {
        // One human, several git identities, is the norm rather than the
        // exception. Left unmerged it invents a second person and quietly
        // improves every bus factor by one.
        const best = display.get(author);
        if (!best || (raw.includes(' ') && !best.includes(' '))) display.set(author, raw);
        if (!authorLast.has(author) || authorLast.get(author) < d) authorLast.set(author, d);
      }
      continue;
    }
    if (!line || !author) continue;
    const file = line;
    if (isNoise(file)) continue;
    const mod = moduleOf(file);
    // One commit counts once per module, however many files it touched. Count
    // files instead and a single commit of regenerated documentation buries
    // every real change in the repository. That is not a hypothetical: it put
    // 300k "changes" on one directory the first time this ran.
    if (seenInCommit.has(mod)) continue;
    seenInCommit.add(mod);
    if (!modules.has(mod)) modules.set(mod, new Map());
    const authors = modules.get(mod);
    authors.set(author, (authors.get(author) ?? 0) + 1);
    if (!lastTouch.has(mod) || lastTouch.get(mod) < date) lastTouch.set(mod, date);
  }

  const rows = [...modules.entries()].map(([name, authors]) => {
    const total = [...authors.values()].reduce((a, b) => a + b, 0);
    const ranked = [...authors.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    return {
      module: name,
      changes: total,
      authors: ranked.length,
      topAuthor: display.get(top[0]) ?? top[0],
      topAuthorShare: total === 0 ? 0 : top[1] / total,
      // The classic definition: how many people you would have to lose before
      // half the knowledge of this module walks out with them.
      busFactor: busFactor(ranked, total),
      topAuthorLastSeen: authorLast.get(top[0]) ?? null,
      lastTouched: lastTouch.get(name) ?? null,
    };
  });

  rows.sort((a, b) => b.changes - a.changes);
  return { sinceYears, modules: rows.slice(0, maxModules) };
}

function busFactor(ranked, total) {
  let acc = 0;
  let count = 0;
  for (const [, lines] of ranked) {
    acc += lines;
    count++;
    if (acc > total / 2) break;
  }
  return count;
}

/**
 * Merge the identities of one person. Case, dots and separators differ between
 * a laptop, a CI job and a web edit; the human does not.
 */
export function normalizeAuthor(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/\[bot\]/g, ' bot')
    .replace(/[._\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Group by the directory a person would name in conversation. */
/**
 * Paths reach this module from two places: git, which always writes them with
 * forward slashes, and the local filesystem, which on Windows writes them with
 * backslashes. Without this line every file on Windows landed in one module
 * called "(root)", so the whole safety measurement quietly said nothing.
 */
export function toPosix(file) {
  return String(file).replace(/\\/g, '/');
}

export function moduleOf(file) {
  const parts = toPosix(file).split('/');
  if (parts.length === 1) return '(root)';
  const containers = new Set(['src', 'lib', 'packages', 'apps', 'services', 'modules', 'app']);
  if (containers.has(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

/** Generated and vendored files say nothing about who understands the system. */
export function isNoise(file) {
  const path = toPosix(file);
  return /(^|\/)(node_modules|vendor|dist|build|third_party|\.yarn)\//.test(path)
    || /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.(js|css)|\.svg|\.png|\.jpg|\.snap)$/.test(path);
}

/**
 * The client-facing reading. Three states, because there are three different
 * conversations: fine, watch it, and this is a real risk today.
 */
export function ownershipRisk(row, { staleMonths = 18 } = {}) {
  const stale = row.topAuthorLastSeen ? monthsSince(row.topAuthorLastSeen) > staleMonths : false;
  const share = Math.round(row.topAuthorShare * 100);

  if (row.authors === 1) {
    return stale
      ? { level: 'risk', why: `one person has ever touched it, and has not committed anywhere since ${row.topAuthorLastSeen}` }
      : { level: 'risk', why: 'one person has ever touched it' };
  }
  if (row.busFactor === 1 && stale) {
    return { level: 'risk', why: `one person made ${share}% of the changes and has not committed anywhere since ${row.topAuthorLastSeen}` };
  }
  // A bus factor of one with a thin majority is a different situation from a
  // module somebody owns outright. Saying "risk" to both spends the word.
  if (row.busFactor === 1 && row.topAuthorShare >= 0.6) {
    return { level: 'risk', why: `one person made ${share}% of the changes` };
  }
  if (row.busFactor === 1) {
    return { level: 'watch', why: `no single owner, but the busiest person made ${share}% of the changes` };
  }
  if (row.busFactor === 2 && row.topAuthorShare > 0.6) {
    return { level: 'watch', why: `two people, and one of them made ${share}%` };
  }
  return { level: 'ok', why: `${row.busFactor} people share the knowledge` };
}

export function monthsSince(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / (30.44 * 24 * 3600 * 1000);
}

/**
 * The first thing a new user does is run this in a directory. When that fails,
 * the reason has to be a sentence, not a dump of the command we tried.
 */
/** Empty when the path is a usable directory, otherwise the reason it is not. */
async function directory(repo) {
  try {
    const info = await stat(repo);
    if (!info.isDirectory()) return `${repo} is a file, and this reads a repository directory`;
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') return `there is nothing at ${repo}`;
    if (err.code === 'EACCES') return `no permission to read ${repo}`;
    return `cannot open ${repo}: ${err.code ?? err.message}`;
  }
}

function humanReason(err) {
  const text = `${err.message}`;
  if (/does not have any commits yet|bad default revision/.test(text)) {
    return 'this repository has no commits yet, so there is no history to read';
  }
  if (/not a git repository/.test(text)) {
    return 'this is not a git repository, and ownership is read from authorship history';
  }
  if (/ENOENT/.test(text) && /spawn git/.test(text)) {
    return 'git is not on the PATH, and this reads history with git';
  }
  return text.split(/\r?\n/)[0].trim();
}
