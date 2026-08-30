import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild, spawnFor } from '../src/buildrun.mjs';

const run = promisify(execFile);

async function repo(files, { commitAll = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ancient-run-'));
  await run('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir });
  for (const [path, body] of Object.entries(files)) {
    await writeFile(join(dir, path), body);
  }
  if (commitAll) {
    await run('git', ['add', '-A'], { cwd: dir });
    await run('git', ['commit', '-qm', 'init'], { cwd: dir });
  }
  return dir;
}

const dirs = [];

// The plain case: everything needed is committed, nothing to install.
let dir = await repo({
  'package.json': JSON.stringify({ name: 'ok', scripts: { build: 'node build.mjs' } }),
  'build.mjs': 'console.log("built");\n',
});
dirs.push(dir);
let r = await runBuild(dir, { timeoutMs: 60000 });
assert.equal(r.ok, true, 'a self-contained project builds from a clean checkout');
assert.equal(r.verdict.level, 'ok');

// The finding this whole measurement exists for: it builds on the developer's
// machine because a file they never committed is sitting in their folder.
dir = await repo({
  'package.json': JSON.stringify({ name: 'uncommitted', scripts: { build: 'node build.mjs' } }),
});
await writeFile(join(dir, 'build.mjs'), 'console.log("built");\n');
await writeFile(join(dir, '.gitignore'), 'build.mjs\n');
await run('git', ['add', '-A'], { cwd: dir });
await run('git', ['commit', '-qm', 'init'], { cwd: dir });
dirs.push(dir);
r = await runBuild(dir, { timeoutMs: 60000 });
assert.equal(r.ok, false, 'a build that needs an uncommitted file must fail from a clean checkout');
assert.match(r.verdict.why, /npm run build failed|does not build/);

// A failing build script is reported as the step that failed, not as a crash.
dir = await repo({
  'package.json': JSON.stringify({ name: 'broken', scripts: { build: 'node -e "process.exit(1)"' } }),
});
dirs.push(dir);
r = await runBuild(dir, { timeoutMs: 60000 });
assert.equal(r.ok, false);
assert.equal(r.steps.find((s) => !s.ok).step, 'npm run build');

// Windows spawns npm as a batch file. Getting this wrong made the build step
// fail on every Windows machine, and the report then said the project does not
// build: a false accusation caused by our own code.
assert.deepEqual(spawnFor('npm', ['ci'], 'win32'), { command: 'npm.cmd ci', args: [], shell: true });
assert.deepEqual(spawnFor('npm', ['run', 'build'], 'win32'), { command: 'npm.cmd run build', args: [], shell: true });
assert.deepEqual(spawnFor('npm', ['ci'], 'linux'), { command: 'npm', args: ['ci'], shell: false });
assert.deepEqual(spawnFor('npm', ['ci'], 'darwin'), { command: 'npm', args: ['ci'], shell: false });
// git ships as a real executable, so it must not gain a shell it does not need.
assert.deepEqual(spawnFor('git', ['status'], 'win32'), { command: 'git', args: ['status'], shell: false });
assert.deepEqual(spawnFor('node.exe', ['-v'], 'win32'), { command: 'node.exe', args: ['-v'], shell: false });
// A shell concatenates rather than escapes, so an argument that is not a plain
// word is refused instead of being handed to it. The only argument that does
// not come from this repository is a script name out of somebody's package.json.
assert.equal(spawnFor('npm', ['run', 'build && del /q *'], 'win32').refused, 'build && del /q *');
assert.equal(spawnFor('npm', ['run', 'build && del /q *'], 'win32').shell, false);
// The same string on a system that needs no shell is passed through untouched.
assert.deepEqual(spawnFor('npm', ['run', 'a b'], 'linux'), { command: 'npm', args: ['run', 'a b'], shell: false });

for (const d of dirs) await rm(d, { recursive: true, force: true });
console.log('buildrun: 15 assertions passed');
