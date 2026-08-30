import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);

/**
 * Actually build the system from a clean checkout.
 *
 * Two rules make this safe enough to offer at all.
 *
 * First, it clones the repository into a throwaway directory and works only
 * there. That is what "from scratch" means: nothing from anyone's laptop, no
 * uncommitted file, no folder someone forgot to add. Half the failures this
 * finds are exactly that.
 *
 * Second, it never runs unless the caller asked for it. Installing
 * dependencies executes the project's own scripts, so this belongs in a
 * disposable sandbox and nowhere else. The static audit stays the default.
 */
export async function runBuild(repo, { timeoutMs = 15 * 60 * 1000, keep = false } = {}) {
  const work = await mkdtemp(join(tmpdir(), 'ancient-build-'));
  const steps = [];
  let dir = join(work, 'checkout');

  try {
    await run('git', ['clone', '--depth', '1', '--recurse-submodules', repo, dir], { timeout: timeoutMs });
    steps.push({ step: 'clone', ok: true, note: 'clean checkout of committed files only' });
  } catch (err) {
    // Without submodules the clone may still succeed, and knowing which of the
    // two failed is the finding.
    try {
      await rm(dir, { recursive: true, force: true });
      await run('git', ['clone', '--depth', '1', repo, dir], { timeout: timeoutMs });
      steps.push({ step: 'clone', ok: true, note: 'cloned, but submodules could not be fetched' });
    } catch (err2) {
      steps.push({ step: 'clone', ok: false, note: short(err2.message) });
      return finish(work, steps, keep);
    }
  }

  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  } catch {
    steps.push({ step: 'detect', ok: false, note: 'no package.json in the checkout, nothing to run' });
    return finish(work, steps, keep);
  }

  const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  if (deps.length > 0) {
    const hasLock = await exists(join(dir, 'package-lock.json'));
    const cmd = hasLock ? ['ci'] : ['install'];
    const res = await tryRun('npm', cmd, dir, timeoutMs);
    steps.push({ step: `npm ${cmd[0]}`, ok: res.ok, note: res.note });
    if (!res.ok) return finish(work, steps, keep);
  } else {
    steps.push({ step: 'install', ok: true, note: 'no dependencies declared, nothing to install' });
  }

  const scripts = manifest.scripts ?? {};
  const buildScript = ['build', 'compile', 'bundle'].find((s) => scripts[s]);
  if (buildScript) {
    const res = await tryRun('npm', ['run', buildScript], dir, timeoutMs);
    steps.push({ step: `npm run ${buildScript}`, ok: res.ok, note: res.note });
  } else {
    steps.push({ step: 'build', ok: true, note: 'no build script: the project runs from source' });
  }

  return finish(work, steps, keep);
}

/**
 * npm on Windows is a batch file, not an executable, and Node refuses to spawn
 * one without a shell. Without this the build step failed on every Windows
 * machine with a spawn error, which the report then presented as "this project
 * does not build": a false accusation about somebody's code, caused by ours.
 *
 * Only the interpreter changes. Arguments stay a fixed list, and the directory
 * travels as cwd rather than as text in a command line, so nothing from the
 * repository reaches a shell.
 */
export function spawnFor(cmd, platform = process.platform) {
  const windows = platform === 'win32';
  const shellNeeded = windows && !/\.(exe|com)$/i.test(cmd) && cmd !== 'git';
  return { command: shellNeeded ? `${cmd}.cmd` : cmd, shell: shellNeeded };
}

async function tryRun(cmd, args, cwd, timeout) {
  const { command, shell } = spawnFor(cmd);
  try {
    const { stdout, stderr } = await run(command, args, { cwd, timeout, shell, maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, note: short(stderr || stdout, 'completed') };
  } catch (err) {
    return { ok: false, note: short(err.stderr || err.message) };
  }
}

async function exists(p) {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

function short(text, fallback = 'failed') {
  const lines = String(text ?? '').trim().split('\n').filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 160) : fallback;
}

async function finish(work, steps, keep) {
  if (!keep) await rm(work, { recursive: true, force: true });
  const failed = steps.find((s) => !s.ok);
  return {
    steps,
    ok: !failed,
    verdict: failed
      ? { level: 'risk', why: `a clean checkout does not build: ${failed.step} failed (${failed.note})` }
      : { level: 'ok', why: 'a clean checkout installs and builds with no manual steps' },
  };
}
