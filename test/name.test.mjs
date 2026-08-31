import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { projectName, ownerRepo } from '../src/name.mjs';

const run = promisify(execFile);

// A report someone forwards to their board is titled with whatever this
// returns. The folder name was the only answer, so a full clone of webpack
// sitting in webpackfull/ produced a report headed "webpackfull".
assert.equal(ownerRepo('git@github.com:webpack/webpack.git'), 'webpack/webpack');
assert.equal(ownerRepo('https://github.com/Marcin1000/ancient-code'), 'Marcin1000/ancient-code');
assert.equal(ownerRepo('https://github.com/Marcin1000/ancient-code.git'), 'Marcin1000/ancient-code');
assert.equal(ownerRepo('https://github.com/Marcin1000/ancient-code/'), 'Marcin1000/ancient-code');
assert.equal(ownerRepo('ssh://git@internal.example.com:22/team/app.git'), 'team/app');

// A clone of a directory on the same machine has no owner worth printing.
assert.equal(ownerRepo('/home/someone/clones/thing'), null);
assert.equal(ownerRepo('file:///home/someone/thing'), null);
assert.equal(ownerRepo(''), null);
assert.equal(ownerRepo(null), null);

const dirs = [];
async function repo(files = {}, remote = null) {
  const dir = await mkdtemp(join(tmpdir(), 'ancient-name-'));
  dirs.push(dir);
  await run('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  if (remote) await run('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  return dir;
}

// The remote knows the real name even when the folder does not.
let dir = await repo({ 'package.json': JSON.stringify({ name: 'whatever' }) }, 'git@github.com:webpack/webpack.git');
assert.equal(await projectName(dir), 'webpack/webpack');

// No remote: the manifest is the next best answer.
dir = await repo({ 'package.json': JSON.stringify({ name: '@scope/thing' }) });
assert.equal(await projectName(dir), '@scope/thing');

// Neither: the folder, which is where this started.
dir = await repo();
assert.equal(await projectName(dir), basename(dir));

// A broken manifest must not take the whole run down with it.
dir = await repo({ 'package.json': '{ not json' });
assert.equal(await projectName(dir), basename(dir));

for (const d of dirs) await rm(d, { recursive: true, force: true });
console.log('name: 14 assertions passed');
