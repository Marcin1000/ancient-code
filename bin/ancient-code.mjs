#!/usr/bin/env node
import { resolve, basename } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { ownership } from '../src/ownership.mjs';
import { safetyNet } from '../src/safety.mjs';
import { buildability } from '../src/buildability.mjs';
import { runBuild } from '../src/buildrun.mjs';
import { docsReality } from '../src/docsreality.mjs';
import { assess, renderText, renderHtml } from '../src/report.mjs';
import { scanFences } from '../src/fences.mjs';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const has = (f) => flags.includes(f);
const value = (f) => {
  const hit = flags.find((x) => x.startsWith(`${f}=`));
  return hit ? hit.slice(f.length + 1) : null;
};
const positional = args.filter((a) => !a.startsWith('--'));

if (has('--help') || positional[0] === 'help') {
  console.log(`ancient-code: what it would cost to hand this system to someone else.

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
`);
  process.exit(0);
}

const root = resolve(positional[0] ?? process.cwd());
const sinceYears = Number(value('--since') ?? 3);

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
  try {
    fences = JSON.parse(await readFile(resolve(fencesFile), 'utf8'));
  } catch (err) {
    console.error(`could not read ${fencesFile}: ${err.message}`);
  }
} else if (!has('--no-fences')) {
  fences = await scanFences(root);
}

const a = assess({ own, safety, fences, build, buildRun, docs });
const name = basename(root);

const reportFlag = flags.find((f) => f === '--report' || f.startsWith('--report='));
if (reportFlag) {
  const out = resolve(value('--report') ?? 'ancient-code.html');
  await writeFile(out, renderHtml(name, a, own), 'utf8');
  console.error(`report written to ${out}`);
}

if (has('--json')) {
  console.log(JSON.stringify({ repo: root, ownership: own, safety, build, buildRun, docs, assessment: a }, null, 2));
} else {
  console.log(renderText(name, a, own));
}
