import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docsReality, referencedPaths } from '../src/docsreality.mjs';

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
console.log('docsreality: 14 assertions passed');
