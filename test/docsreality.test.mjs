import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docsReality, pathCandidates, isPattern, describedAsGenerated, referencedPaths } from '../src/docsreality.mjs';

const run = promisify(execFile);
const dirs = [];

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'ancient-docs-'));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
  }
  return dir;
}

const FULL_DOC = `# Thing

## Setup

Run \`npm run start\` to begin.

## Deployment

Push to main and it deploys.

## Backups

Restore from the nightly dump.

## Secrets

Keys live in the vault, rotate them quarterly.
`;

// A command the documentation tells you to run, that the project no longer
// defines, is the clearest possible proof that nobody re-read this.
let d = await docsReality(await project({
  'package.json': JSON.stringify({ name: 'x', scripts: { dev: 'node .' } }),
  'README.md': FULL_DOC,
}));
assert.equal(d.verdict.level, 'risk');
assert.ok(d.findings.some((f) => f.kind === 'command is gone' && f.what.includes('start')));

// The same documentation is fine once the script exists.
d = await docsReality(await project({
  'package.json': JSON.stringify({ name: 'x', scripts: { start: 'node .' } }),
  'README.md': FULL_DOC,
}));
assert.equal(d.verdict.level, 'ok');
assert.equal(d.findings.length, 0);

// A path the documentation points at, that was renamed or deleted.
d = await docsReality(await project({
  'package.json': JSON.stringify({ name: 'x', scripts: { start: 'node .' } }),
  'README.md': FULL_DOC + '\nThe entry point is `src/index.js`.\n',
}));
assert.equal(d.verdict.level, 'risk');
assert.ok(d.findings.some((f) => f.kind === 'path is gone' && f.what.includes('src/index.js')));

// And it is not a finding when the file is really there.
d = await docsReality(await project({
  'package.json': JSON.stringify({ name: 'x', scripts: { start: 'node .' } }),
  'src/index.js': 'export const a = 1;\n',
  'README.md': FULL_DOC + '\nThe entry point is `src/index.js`.\n',
}));
assert.equal(d.findings.some((f) => f.kind === 'path is gone'), false);

// The day-one questions a new team cannot guess from the code.
d = await docsReality(await project({
  'package.json': JSON.stringify({ name: 'x' }),
  'README.md': '# Thing\n\n## Setup\n\nInstall it.\n',
}));
assert.equal(d.verdict.level, 'watch');
assert.equal(d.findings.filter((f) => f.kind === 'unanswered question').length, 3);

// No documentation at all is its own answer.
d = await docsReality(await project({ 'src/a.js': 'export const a = 1;\n' }));
assert.equal(d.verdict.level, 'risk');
assert.match(d.verdict.why, /no documentation/);

// Documentation left behind while the code moved on. Git knows both dates.
const drifted = await project({
  'package.json': JSON.stringify({ name: 'x', scripts: { start: 'node .' } }),
  'README.md': FULL_DOC,
});
await run('git', ['init', '-q', '-b', 'main'], { cwd: drifted });
await run('git', ['config', 'user.email', 't@e.pl'], { cwd: drifted });
await run('git', ['config', 'user.name', 'T'], { cwd: drifted });
await run('git', ['add', 'README.md'], { cwd: drifted });
await run('git', ['commit', '-qm', 'docs', '--date=2020-01-01T00:00:00'], {
  cwd: drifted,
  env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00' },
});
await writeFile(join(drifted, 'app.js'), 'export const a = 2;\n');
await run('git', ['add', '-A'], { cwd: drifted });
await run('git', ['commit', '-qm', 'code'], { cwd: drifted });

d = await docsReality(drifted);
assert.equal(d.verdict.level, 'watch');
assert.ok(d.findings.some((f) => f.kind === 'stale'), 'documentation frozen years behind the code is a finding');

// Only paths that look like real repository paths, because a false "this file
// is missing" costs more than a missed one.
const paths = referencedPaths('see `src/a.js` and [the guide](docs/guide.md) and `node_modules/x/y.js` and https://example.com/z.js');
assert.deepEqual(paths.sort(), ['docs/guide.md', 'src/a.js']);

for (const dir of dirs) await rm(dir, { recursive: true, force: true });

// Four ways this check accused real projects of something untrue. Each one was
// found by running the tool against a full clone and then reading the file it
// complained about.

// 1. Documentation writes a path from outside the checkout. webpack's
// CONTRIBUTING says `webpack/lib/index.js` for a file that sits at lib/index.js,
// and the report called that a broken instruction, in red, on the front page.
assert.deepEqual(pathCandidates('webpack/lib/index.js', 'webpack'), ['webpack/lib/index.js', 'lib/index.js']);
assert.deepEqual(pathCandidates('lib/index.js', 'webpack'), ['lib/index.js']);
assert.deepEqual(pathCandidates('other/lib/index.js', 'webpack'), ['other/lib/index.js']);
assert.deepEqual(pathCandidates('pkg/a.js', '@scope/pkg'), ['pkg/a.js', 'a.js']);

// 2. A backticked path used as the label of a link is a caption, not an
// instruction. puppeteer labels a github.com URL with `third_party/README.md`.
assert.deepEqual(
  referencedPaths('see [`third_party/README.md`](https://github.com/x/y/blob/main/packages/core/third_party/README.md)'),
  [], 'a link label is not a reference into this repository');
assert.deepEqual(referencedPaths('see `src/thing.js` for details'), ['src/thing.js']);
assert.deepEqual(referencedPaths('see [the guide](docs/guide.md)'), ['docs/guide.md']);

// 3. Documentation names families of scripts and leaves placeholders in them.
assert.equal(isPattern('test:chrome:'), true);
assert.equal(isPattern('test:chrome'), false);
assert.equal(isPattern('test:*'), true);
assert.equal(isPattern('build.'), true);
assert.equal(isPattern('test', 'npm run test<suite> now', 'npm run test'.length), true);
assert.equal(isPattern('test', 'npm run test and then stop', 'npm run test'.length), false);

// 4. A file introduced as a generated artifact is absent from a clean checkout
// on purpose, and "is not there any more" reads as rot where there is none.
const generated = 'Some generated artifacts (such as `src/types.ts`) can become stale.';
assert.equal(describedAsGenerated(generated, 'src/types.ts'), true);
assert.equal(describedAsGenerated('Edit `src/types.ts` before you start.', 'src/types.ts'), false);

console.log('docsreality: 30 assertions passed');
