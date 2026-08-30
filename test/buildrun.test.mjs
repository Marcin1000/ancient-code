import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild } from '../src/buildrun.mjs';

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

for (const d of dirs) await rm(d, { recursive: true, force: true });
console.log('buildrun: 6 assertions passed');
