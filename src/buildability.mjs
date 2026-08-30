import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { findDocs } from './docs-files.mjs';

/**
 * Could a new team build this from the repository alone?
 *
 * Two layers, and the split matters. The static audit never executes anything
 * from the repository: it names what stands between a clean machine and a
 * working build. Actually running the build is layer two, behind an explicit
 * flag, because "npm install" on a client's codebase runs that codebase's
 * scripts on whatever machine you are sitting at.
 *
 * The static layer alone already answers the question that ends arguments:
 * how many things does a newcomer have to find out from a person?
 */

const ECOSYSTEMS = [
  { id: 'node', marker: 'package.json', lock: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'], pin: ['.nvmrc', '.node-version', '.tool-versions'] },
  { id: 'python', marker: 'pyproject.toml', lock: ['poetry.lock', 'uv.lock', 'requirements.txt'], pin: ['.python-version', '.tool-versions'] },
  { id: 'python', marker: 'requirements.txt', lock: ['requirements.txt'], pin: ['.python-version'] },
  { id: 'go', marker: 'go.mod', lock: ['go.sum'], pin: ['go.mod'] },
  { id: 'rust', marker: 'Cargo.toml', lock: ['Cargo.lock'], pin: ['rust-toolchain.toml', 'rust-toolchain'] },
  { id: 'java', marker: 'pom.xml', lock: [], pin: ['.tool-versions', '.sdkmanrc'] },
  { id: 'java', marker: 'build.gradle', lock: ['gradle/wrapper/gradle-wrapper.properties'], pin: ['gradle/wrapper/gradle-wrapper.properties'] },
  { id: 'php', marker: 'composer.json', lock: ['composer.lock'], pin: ['composer.json'] },
  { id: 'ruby', marker: 'Gemfile', lock: ['Gemfile.lock'], pin: ['.ruby-version'] },
  { id: 'dotnet', marker: 'global.json', lock: ['packages.lock.json'], pin: ['global.json'] },
];

// Headings that mean "here is how you run this". English first, then the
// languages a European codebase is actually written in: a repository whose
// README says "Uruchomienie" is documented, and the first version of this
// pattern called our own repository undocumented for exactly that reason.
const BUILD_DOCS = new RegExp(
  '(^|\\n)\\s*(#+\\s*)?(' + [
    'install', 'installation', 'getting started', 'setup', 'development',
    'developing', 'contributing', 'build', 'run locally', 'quick ?start', 'usage',
    'uruchomienie', 'instalacja', 'wymagania', 'jak uruchomi', 'rozw[oó]j',
    'installation', 'installieren', 'entwicklung', 'instalaci[oó]n', 'utilisation',
  ].join('|') + ')',
  'i',
);
// Widened after the first run called puppeteer undocumented because its README
// says "npm i puppeteer" and this pattern only knew "npm install".
const BUILD_COMMAND = /(npm|yarn|pnpm) (i|install|ci|add|run|start|test)\b|npx |make\b|docker compose|docker-compose|docker build|\.\/gradlew|mvn |gradle |cargo (build|run)|go (build|run)|pip install|poetry install|uv sync|bundle install|composer install/i;

// Where a developer setup is actually written down. A user-facing README is
// not the only honest answer, and CONTRIBUTING is often the better one.
const DOC_FILES = ['README.md', 'CONTRIBUTING.md', 'DEVELOPMENT.md', 'docs/development.md', 'docs/setup.md', 'docs/CONTRIBUTING.md'];

export async function buildability(repo) {
  const present = async (p) => {
    try {
      await stat(join(repo, p));
      return true;
    } catch {
      return false;
    }
  };
  const read = async (p) => {
    try {
      return await readFile(join(repo, p), 'utf8');
    } catch {
      return null;
    }
  };

  const json = async (p) => {
    const text = await read(p);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const stacks = [];
  for (const eco of ECOSYSTEMS) {
    if (await present(eco.marker)) stacks.push(eco);
  }

  // A repository holding several projects has no manifest at the top, and
  // saying "no recognised project manifest" about it is simply wrong. Our own
  // repository is shaped that way and the first run said exactly that.
  const subprojects = stacks.length === 0 ? await findSubprojects(repo, present) : [];

  const findings = [];
  const ok = [];

  if (stacks.length === 0 && subprojects.length === 0) {
    findings.push({ kind: 'no stack', what: 'no recognised project manifest', where: '/' });
  } else if (subprojects.length > 0) {
    ok.push(`several projects in one repository: ${subprojects.join(', ')}`);
  }

  const manifest = await json('package.json');
  const declaresDeps = manifest
    ? Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).length > 0
    : true;

  for (const eco of stacks) {
    let hasLock = false;
    for (const l of eco.lock) if (await present(l)) hasLock = true;
    // A project with no dependencies has nothing to lock. Demanding a lockfile
    // there is a finding nobody would act on, and every one of those teaches
    // the reader to skim past the real ones.
    if (eco.lock.length > 0 && (eco.id !== 'node' || declaresDeps)) {
      if (hasLock) ok.push(`${eco.id}: dependencies are locked`);
      else findings.push({ kind: 'no lockfile', what: `${eco.id} dependencies are not locked, so two installs can differ`, where: eco.marker });
    }

    let pinned = false;
    for (const p of eco.pin) if (await present(p)) pinned = true;
    if (eco.id === 'node' && !pinned) {
      const pkg = await read('package.json');
      if (pkg && /"engines"\s*:/.test(pkg)) pinned = true;
    }
    if (pinned) ok.push(`${eco.id}: toolchain version is pinned`);
    else findings.push({ kind: 'no toolchain pin', what: `nothing states which ${eco.id} version this needs`, where: eco.marker });
  }

  // A documented path is the difference between reading and asking.
  let docText = '';
  for (const f of await findDocs(repo, DOC_FILES)) {
    const text = await read(f);
    if (text) docText += '\n' + text;
  }
  const documented = BUILD_DOCS.test(docText) && BUILD_COMMAND.test(docText);
  if (documented) ok.push('README documents how to install and run it');
  else findings.push({ kind: 'undocumented', what: 'the README does not show how to install and run this', where: 'README.md' });

  // A submodule is only a wall if the new team cannot reach it. Public test
  // fixtures are a detail; a private repository behind ssh is the whole story.
  const gitmodules = await read('.gitmodules');
  if (gitmodules) {
    const urls = [...gitmodules.matchAll(/url\s*=\s*(\S+)/g)].map((m) => m[1]);
    const privateOnes = urls.filter((u) => /^(git@|ssh:\/\/)/.test(u) || !/^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)/.test(u));
    if (privateOnes.length > 0) {
      findings.push({
        kind: 'private submodules',
        what: `${privateOnes.length} of ${urls.length} submodules live somewhere the new team may not reach (${privateOnes[0]})`,
        where: '.gitmodules',
      });
    } else {
      findings.push({
        kind: 'submodules',
        what: `${urls.length} public submodules must be checked out as well, which is a step people forget`,
        where: '.gitmodules',
      });
    }
  }

  const npmrc = await read('.npmrc');
  if (npmrc && /registry\s*=|_authToken|_auth\s*=/.test(npmrc)) {
    findings.push({ kind: 'private registry', what: 'installs point at a private registry that needs credentials', where: '.npmrc' });
  }

  if (manifest) {
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    const privateDeps = Object.entries(deps)
      .filter(([, spec]) => /^(file:|link:|git\+ssh:|ssh:\/\/)/.test(String(spec)))
      // A file: path that stays inside the checkout is a workspace package, not
      // a dependency somebody else has to be given. eslint depends on itself
      // with file:. to dogfood its own rules, and calling that a blocker for a
      // new team is simply wrong: cloning the repository brings it along.
      .filter(([, spec]) => !insideRepo(String(spec)));
    if (privateDeps.length > 0) {
      findings.push({
        kind: 'local or private dependency',
        what: `${privateDeps.length} dependencies come from outside the public registry (${privateDeps.slice(0, 2).map(([name]) => name).join(', ')})`,
        where: 'package.json',
      });
    }

    // Only ask for a build script where a build is plausibly needed. A plain
    // Node CLI that runs from source has nothing to build, and saying
    // otherwise is noise. Parsed as JSON rather than matched with a regex,
    // which read webpack's nested scripts wrongly.
    const scripts = Object.keys(manifest.scripts ?? {});
    const hasBuild = scripts.some((s) => /^(build|start|dev|compile|bundle)$/.test(s));
    // A tsconfig alone proves nothing: plenty of plain JavaScript projects keep
    // one for type checking. webpack does exactly that, and the first version
    // of this rule accused it of missing a build script it does not need.
    const compiles = (await present('tsconfig.json')) && (await hasTypescriptSource(repo));
    const bundled = (await present('vite.config.js')) || (await present('vite.config.ts'))
      || (await present('rollup.config.js')) || (await present('next.config.js'));
    const needsBuild = compiles || bundled;
    if (hasBuild) ok.push('a build or start script exists');
    else if (needsBuild) {
      findings.push({ kind: 'no build script', what: 'the project needs compiling but defines no build script', where: 'package.json' });
    } else {
      ok.push('nothing to build: the project runs from source');
    }
  }

  const envExample = (await present('.env.example')) || (await present('.env.sample')) || (await present('.env.template'));
  const envUsed = await usesEnv(repo, read);
  if (envUsed && !envExample) {
    findings.push({ kind: 'undocumented configuration', what: 'the build reads environment variables and no example file lists them', where: 'configuration' });
  } else if (envExample) {
    ok.push('an example environment file lists the required settings');
  }

  const dockerised = (await present('Dockerfile')) || (await present('docker-compose.yml')) || (await present('compose.yaml'));
  if (dockerised) ok.push('a container definition exists, which is the shortest path for a new team');

  return { stacks: stacks.map((s) => s.id), findings, ok, documented, dockerised, verdict: verdictFor(findings) };
}

/** Manifests one level down, which is what a multi-project repository looks like. */
async function findSubprojects(repo, present) {
  const { readdir } = await import('node:fs/promises');
  let entries;
  try {
    entries = await readdir(repo, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    for (const eco of ECOSYSTEMS) {
      if (await present(`${e.name}/${eco.marker}`)) {
        found.push(`${e.name} (${eco.id})`);
        break;
      }
    }
  }
  return found;
}

/** Real TypeScript sources, not just a config file kept for type checking. */
async function hasTypescriptSource(repo) {
  const { readdir } = await import('node:fs/promises');
  const stack = [repo];
  let looked = 0;
  while (stack.length && looked < 400) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      looked++;
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build'].includes(e.name)) continue;
        stack.push(join(dir, e.name));
      } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
        return true;
      }
    }
  }
  return false;
}

async function usesEnv(repo, read) {
  for (const f of ['docker-compose.yml', 'compose.yaml', 'Makefile', 'vite.config.js', 'vite.config.ts', 'next.config.js', 'webpack.config.js']) {
    const text = await read(f);
    if (text && /\$\{?[A-Z][A-Z0-9_]{2,}\}?|process\.env\.[A-Z]/.test(text)) return true;
  }
  return false;
}

/** A file: or link: target that resolves within the repository it is declared in. */
export function insideRepo(spec) {
  const m = /^(?:file:|link:)(.*)$/.exec(spec);
  if (!m) return false;
  const path = m[1].replace(/^\.\//, '');
  if (path === '' || path === '.') return true;
  if (path.startsWith('/') || path.startsWith('~')) return false;
  let depth = 0;
  for (const part of path.split('/')) {
    if (part === '..') depth -= 1;
    else if (part && part !== '.') depth += 1;
    if (depth < 0) return false;
  }
  return true;
}

function verdictFor(findings) {
  const blocking = findings.filter((f) =>
    ['no stack', 'undocumented', 'private registry', 'local or private dependency', 'private submodules', 'undocumented configuration'].includes(f.kind));
  if (blocking.length > 0) {
    return {
      level: 'risk',
      why: `${blocking.length} ${blocking.length === 1 ? 'thing a new team cannot' : 'things a new team cannot'} find out from the repository alone (${blocking.slice(0, 2).map((f) => f.kind).join(', ')})`,
    };
  }
  if (findings.length > 0) {
    return {
      level: 'watch',
      why: `${findings.length} ${findings.length === 1 ? 'gap that makes' : 'gaps that make'} the build less reproducible (${findings.slice(0, 2).map((f) => f.kind).join(', ')})`,
    };
  }
  return { level: 'ok', why: 'the repository states its toolchain, locks its dependencies and documents how to build' };
}
