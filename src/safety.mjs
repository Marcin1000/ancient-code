import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { moduleOf, isNoise } from './ownership.mjs';

/**
 * Is there a safety net under changes to this system?
 *
 * Deliberately measures presence, not coverage. Real coverage means running
 * the suite, which needs the project's toolchain, its secrets and its time.
 * Presence is cheap, honest and already decisive: a payments module with no
 * test file next to it is a fact worth putting in front of whoever pays.
 */

const CI_FILES = [
  '.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', 'azure-pipelines.yml',
  '.circleci/config.yml', 'bitbucket-pipelines.yml', '.drone.yml', 'wercker.yml',
];

const TEST_COMMANDS = /\b(npm|yarn|pnpm)\s+(run\s+)?test|vitest|jest|mocha|ava\b|playwright test|cypress run|pytest|tox\b|go test|cargo test|mvn (-\w+ )*test|gradle\w* test|phpunit|rspec|bundle exec rake/i;

const TEST_FILE = /(^|\/)(tests?|spec|__tests__)\//i;
const TEST_NAME = /(\.|_|-)(test|spec)\.[a-z]+$|^test_.*\.py$|Test\.(java|kt|cs)$|_test\.(go|rb|py)$/i;

// Directories that support the product without being it. Missing tests here
// is a different conversation from missing tests in the payments module.
const SUPPORTING = new Set([
  'docs', 'doc', 'website', 'examples', 'example', 'samples', 'scripts',
  'tools', 'benchmark', 'benchmarks', '.github', 'demo', 'demos',
]);

// A project may keep tests beside the code or in one place. Both are fine.
const CENTRAL_TEST_DIRS = new Set(['test', 'tests', 'spec', '__tests__', 'testing']);

const SOURCE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.swift', '.php', '.cs', '.c', '.cc', '.cpp', '.m',
]);

export async function safetyNet(repo) {
  const ci = await findCi(repo);
  const files = await listFiles(repo);

  const perModule = new Map(); // module -> { source, tests }
  for (const f of files) {
    const isTest = TEST_FILE.test(f) || TEST_NAME.test(f.split('/').pop());
    const ext = f.slice(f.lastIndexOf('.'));
    if (!SOURCE_EXT.has(ext)) continue;
    const mod = moduleOf(f);
    if (!perModule.has(mod)) perModule.set(mod, { source: 0, tests: 0 });
    const row = perModule.get(mod);
    if (isTest) row.tests++;
    else row.source++;
  }

  const all = [...perModule.entries()]
    .map(([module, counts]) => ({ module, ...counts }))
    .sort((a, b) => b.source - a.source);

  // Totals count everything, including a dedicated test directory that holds
  // no production source. Filtering first made this tool report that webpack
  // has no tests at all, which is spectacularly wrong.
  const totalSource = all.reduce((a, m) => a + m.source, 0);
  const totalTests = all.reduce((a, m) => a + m.tests, 0);

  const modules = all.filter((m) => m.source > 0);

  // When a project keeps its tests in one central directory, a module without
  // test files beside it proves nothing. Saying otherwise would flag every
  // well-organised codebase, and one false accusation costs more than ten
  // findings are worth.
  const centralTests = all.some((m) => CENTRAL_TEST_DIRS.has(m.module) && m.tests > 0);
  const uncovered = centralTests
    ? []
    : modules.filter((m) => m.tests === 0 && m.source >= 5 && !SUPPORTING.has(m.module));

  return {
    ci,
    totalSource,
    totalTests,
    modules,
    centralTests,
    uncovered: uncovered.map((m) => m.module),
    verdict: verdictFor({ ci, totalTests, uncovered, modules, centralTests }),
  };
}

function verdictFor({ ci, totalTests, uncovered, modules, centralTests }) {
  if (totalTests === 0) {
    return { level: 'risk', why: 'no test files found anywhere in the repository' };
  }
  if (!ci.present) {
    return { level: 'risk', why: 'tests exist but nothing runs them automatically' };
  }
  if (!ci.runsTests) {
    return { level: 'risk', why: `${ci.files.join(', ')} exists but no test command runs in it` };
  }
  if (uncovered.length > 0) {
    const worst = uncovered.slice(0, 3).map((m) => m.module).join(', ');
    return {
      level: 'watch',
      why: `tests run in CI, but ${uncovered.length} of ${modules.length} modules have no test files at all (${worst})`,
    };
  }
  if (centralTests) {
    return {
      level: 'ok',
      why: 'tests run in CI and live in a central test directory; tying them to individual modules would need a coverage run',
    };
  }
  return { level: 'ok', why: 'tests exist in every module and CI runs them' };
}

async function findCi(repo) {
  const found = [];
  for (const candidate of CI_FILES) {
    try {
      await stat(join(repo, candidate));
      found.push(candidate);
    } catch {
      /* not present */
    }
  }
  if (found.length === 0) return { present: false, runsTests: false, files: [] };

  let runsTests = false;
  for (const f of found) {
    for (const file of await ciFiles(repo, f)) {
      try {
        const text = await readFile(file, 'utf8');
        if (TEST_COMMANDS.test(text)) {
          runsTests = true;
          break;
        }
      } catch {
        /* unreadable is not a crash */
      }
    }
    if (runsTests) break;
  }
  return { present: true, runsTests, files: found };
}

async function ciFiles(repo, candidate) {
  const full = join(repo, candidate);
  const info = await stat(full);
  if (info.isFile()) return [full];
  const entries = await readdir(full, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => join(full, e.name));
}

async function listFiles(repo, max = 60000) {
  const out = [];
  const stack = [repo];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = relative(repo, full);
      if (e.isDirectory()) {
        if (e.name === '.git' || isNoise(`${rel}/x`)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        if (!isNoise(rel)) out.push(rel);
      }
    }
  }
  return out;
}
