import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safetyNet } from '../src/safety.mjs';

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'ancient-safety-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
  }
  return dir;
}

const source = 'export const x = 1;\n';

// Nothing at all: the plainest finding there is.
const bare = await project({ 'src/a.js': source, 'src/b.js': source });
let s = await safetyNet(bare);
assert.equal(s.verdict.level, 'risk');
assert.match(s.verdict.why, /no test files/);

// Tests exist but nothing runs them, which is a different sentence.
const untested = await project({ 'src/a.js': source, 'src/a.test.js': source });
s = await safetyNet(untested);
assert.equal(s.verdict.level, 'risk');
assert.match(s.verdict.why, /nothing runs them/);

// A pipeline that never calls the tests is worse than none, because it looks
// like a safety net in every screenshot.
const ciNoTests = await project({
  'src/a.js': source,
  'src/a.test.js': source,
  '.github/workflows/ci.yml': 'jobs:\n  build:\n    steps:\n      - run: npm run build\n',
});
s = await safetyNet(ciNoTests);
assert.equal(s.verdict.level, 'risk');
assert.match(s.verdict.why, /no test command/);

// The whole point of the central-directory rule: a well-organised project
// must not be accused of having untested modules.
const central = await project({
  'src/a.js': source, 'src/b.js': source, 'src/c.js': source,
  'src/d.js': source, 'src/e.js': source, 'src/f.js': source,
  'test/a.test.js': source,
  '.github/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: npm test\n',
});
s = await safetyNet(central);
assert.equal(s.verdict.level, 'ok');
assert.equal(s.uncovered.length, 0, 'central tests must not read as uncovered modules');
assert.equal(s.totalTests, 1, 'totals count the test directory too');

// Counting after filtering is what once made this tool report that a repo with
// thousands of tests had none.
assert.ok(s.totalSource >= 6);

// A real gap: source with no tests anywhere near it, and no central directory.
const gap = await project({
  'payments/a.js': source, 'payments/b.js': source, 'payments/c.js': source,
  'payments/d.js': source, 'payments/e.js': source,
  'orders/x.js': source, 'orders/x.test.js': source,
  '.github/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: npm test\n',
});
s = await safetyNet(gap);
assert.equal(s.verdict.level, 'watch');
assert.deepEqual(s.uncovered, ['payments']);

// Documentation and examples are not the product; missing tests there is noise.
const docsOnly = await project({
  'src/a.js': source, 'src/a.test.js': source,
  'docs/one.js': source, 'docs/two.js': source, 'docs/three.js': source,
  'docs/four.js': source, 'docs/five.js': source,
  '.github/workflows/ci.yml': 'jobs:\n  test:\n    steps:\n      - run: vitest run\n',
});
s = await safetyNet(docsOnly);
assert.equal(s.uncovered.includes('docs'), false);

for (const dir of [bare, untested, ciNoTests, central, gap, docsOnly]) {
  await rm(dir, { recursive: true, force: true });
}
console.log('safety: 12 assertions passed');
