#!/usr/bin/env node
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { ownership } from '../src/ownership.mjs';
import { safetyNet } from '../src/safety.mjs';
import { buildability } from '../src/buildability.mjs';
import { runBuild } from '../src/buildrun.mjs';
import { docsReality } from '../src/docsreality.mjs';
import { assess, renderText, renderHtml } from '../src/report.mjs';
import { scanFences } from '../src/fences.mjs';
import { projectName } from '../src/name.mjs';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const has = (f) => flags.includes(f);
const value = (f) => {
  const hit = flags.find((x) => x.startsWith(`${f}=`));
  return hit ? hit.slice(f.length + 1) : null;
};
const positional = args.filter((a) => !a.startsWith('--'));

const usage = `ancient-code: what it would cost to hand this system to someone else.

  ancient-code [path] [options]

  --since=YEARS       how far back to read authorship history (default 3)
  --fences=FILE       output of "ancient-fences --json". Without it the
                      scaffolding question is answered here directly
  --no-fences         skip the scaffolding question entirely (faster)
  --run-build         clone into a temporary directory and actually install and
                      build it. Runs the project's own scripts, so use it only
                      in a disposable sandbox
  --report[=FILE]     write the client-facing HTML report
  --json              full machine-readable output

Five of the six questions are measured here. Who holds the keys still needs a
person, and the report says so rather than quietly leaving it out.
`;

if (has('--help') || positional[0] === 'help') {
  console.log(usage);
  process.exit(0);
}

// A mistyped option used to be ignored in silence, so `--no-fenses` produced a
// full report that had quietly scanned everything. Being wrong loudly is the
// only acceptable behaviour here.
const KNOWN = new Set(['--since', '--fences', '--no-fences', '--run-build', '--report', '--json', '--help']);
const unknown = flags.filter((f) => !KNOWN.has(f.split('=')[0]));
if (unknown.length > 0) {
  console.error(`ancient-code: unknown option ${unknown.join(', ')}`);
  console.error(usage);
  process.exit(2);
}
if (positional.length > 1) {
  console.error(`ancient-code: one path at a time, got ${positional.length}: ${positional.join(', ')}`);
  process.exit(2);
}

const root = resolve(positional[0] ?? process.cwd());
const sinceYears = value('--since') ?? 3;

const own = await ownership(root, { sinceYears });
if (own.error) {
  console.error(`cannot read history: ${own.error}`);
  process.exit(1);
}
const safety = await safetyNet(root);
const build = await buildability(root);
const docs = await docsReality(root);

// Running someone else's build executes their scripts, so it never happens by
// default and the report says plainly which of the two it is reporting.
let buildRun = null;
if (has('--run-build')) {
  buildRun = await runBuild(root);
}

// The scaffolding question used to need a second tool and a second command,
// which meant most runs answered five questions out of six and said so. The
// scanner is a dependency now, so one command answers all five that can be
// measured.
let fences = null;
const fencesFile = value('--fences');
if (fencesFile) {
  // Asking for a specific file and getting a report that silently says "not
  // measured" is the same failure as the mistyped option: the run looks like it
  // worked. If the file was named, it has to be there.
  try {
    fences = JSON.parse(await readFile(resolve(fencesFile), 'utf8'));
  } catch (err) {
    console.error(`ancient-code: could not read --fences=${fencesFile}: ${err.message}`);
    process.exit(2);
  }
} else if (!has('--no-fences')) {
  fences = await scanFences(root);
}

const a = assess({ own, safety, fences, build, buildRun, docs });
// The folder is the last resort, not the first: a full clone of webpack in a
// directory called webpackfull produced a report titled "webpackfull".
const name = await projectName(root);

const reportFlag = flags.find((f) => f === '--report' || f.startsWith('--report='));
if (reportFlag) {
  const named = value('--report');
  if (named === '') {
    console.error('ancient-code: --report= needs a file name, or use --report on its own');
    process.exit(2);
  }
  const out = resolve(named ?? 'ancient-code.html');
  try {
    await writeFile(out, renderHtml(name, a, own), 'utf8');
  } catch (err) {
    console.error(`ancient-code: could not write ${out}: ${err.message}`);
    process.exit(2);
  }
  console.error(`report written to ${out}`);
}

if (has('--json')) {
  console.log(JSON.stringify({ repo: root, ownership: own, safety, build, buildRun, docs, assessment: a }, null, 2));
} else {
  console.log(renderText(name, a, own));
}
