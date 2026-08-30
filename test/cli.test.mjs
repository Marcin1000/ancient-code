import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ancient-code.mjs');

/** Runs the CLI and returns what a shell would see, never throwing. */
async function cli(args, opts = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, ...args], { maxBuffer: 32 * 1024 * 1024, ...opts });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout ?? '', stderr: err.stderr ?? String(err.message) };
  }
}

let r = await cli(['--help']);
assert.equal(r.code, 0);
assert.match(r.stdout, /--run-build/);
assert.match(r.stdout, /Who holds the keys/);

// A mistyped option used to be ignored, so the run looked like it had done what
// was asked. Being wrong quietly is the failure this guards against.
r = await cli(['.', '--no-fenses']);
assert.equal(r.code, 2, 'an unknown option must not be ignored');
assert.match(r.stderr, /unknown option --no-fenses/);

// Every option in the help text has to be one the tool accepts, or the help is
// the thing lying.
const help = (await cli(['--help'])).stdout;
for (const flag of help.match(/^\s{2}(--[a-z-]+)/gm).map((l) => l.trim())) {
  const probe = await cli(['.', flag === '--since' ? '--since=1' : flag, '--no-fences', '--help']);
  assert.notEqual(probe.code, 2, `${flag} appears in the help but is rejected`);
}

r = await cli(['.', '/tmp']);
assert.equal(r.code, 2, 'two paths is a mistake, not a silent choice of one');
assert.match(r.stderr, /one path at a time/);

// Pointing at a path that does not exist reported "git is not on the PATH",
// because Node uses one ENOENT for a missing binary and a missing directory.
// A tool that misdiagnoses the reader's machine is worse than one that stops.
r = await cli(['/definitely/not/here']);
assert.equal(r.code, 1);
assert.match(r.stderr, /there is nothing at/);
assert.ok(!/not on the PATH/.test(r.stderr), 'must not blame git for a missing directory');

r = await cli(['.', '--since=abc', '--no-fences']);
assert.equal(r.code, 1);
assert.match(r.stderr, /positive number of years/);

// A named file that cannot be read is not a reason to report "not measured".
r = await cli(['.', '--fences=/definitely/not/here.json']);
assert.equal(r.code, 2);
assert.match(r.stderr, /could not read --fences=/);

r = await cli(['.', '--report=', '--no-fences']);
assert.equal(r.code, 2);
assert.match(r.stderr, /needs a file name/);

// A repository with no commits must say so, not produce an empty green report.
const empty = await mkdtemp(join(tmpdir(), 'ancient-cli-'));
await run('git', ['init', '-q', '-b', 'main'], { cwd: empty });
r = await cli([empty]);
assert.equal(r.code, 1);
assert.match(r.stderr, /no commits yet/);

// A path that is a file, not a directory.
const afile = join(empty, 'README.md');
await writeFile(afile, '# hello\n');
r = await cli([afile]);
assert.equal(r.code, 1);
assert.match(r.stderr, /is a file/);
await rm(empty, { recursive: true, force: true });

console.log('cli: 18 assertions passed');
