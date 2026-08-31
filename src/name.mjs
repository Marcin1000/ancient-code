import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const run = promisify(execFile);

/**
 * What to call the repository in a report somebody forwards.
 *
 * The folder name is the worst of the three answers and used to be the only
 * one: a full clone of webpack sitting in webpackfull/ produced a report
 * titled "webpackfull". The remote knows the real name, the manifest knows the
 * published one, and the folder is only the last resort.
 */
export async function projectName(root) {
  const remote = await gitRemote(root);
  if (remote) return remote;

  const pkg = await readJson(join(root, 'package.json'));
  if (pkg?.name) return pkg.name;

  return basename(root);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function gitRemote(root) {
  try {
    const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd: root });
    return ownerRepo(stdout.trim());
  } catch {
    return null;
  }
}

/** "git@github.com:webpack/webpack.git" and the https form both give webpack/webpack. */
export function ownerRepo(url) {
  if (!url) return null;
  const clean = String(url).trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = /[:/]([^/:]+)\/([^/]+)$/.exec(clean);
  if (!m) return null;
  // A local path clone has no owner worth printing, only a directory above it.
  if (/^(\.|\/|[a-z]:\\)/i.test(clean) || clean.startsWith('file:')) return null;
  return `${m[1]}/${m[2]}`;
}
