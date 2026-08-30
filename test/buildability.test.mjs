import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildability } from '../src/buildability.mjs';

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'ancient-build-audit-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
  }
  return dir;
}

const README = '# Thing\n\n## Installation\n\nnpm i thing\n';
const dirs = [];
const make = async (files) => {
  const d = await project(files);
  dirs.push(d);
  return buildability(d);
};

// A project with no dependencies has nothing to lock, and demanding a lockfile
// there is a finding nobody would act on.
let b = await make({
  'package.json': JSON.stringify({ name: 'x', engines: { node: '>=20' }, bin: { x: './x.mjs' } }),
  'README.md': README,
});
assert.equal(b.findings.some((f) => f.kind === 'no lockfile'), false);
assert.equal(b.findings.some((f) => f.kind === 'no build script'), false);
assert.equal(b.verdict.level, 'ok');

// A tsconfig without TypeScript sources is a type-checking setup, not a build.
b = await make({
  'package.json': JSON.stringify({ name: 'x', engines: { node: '>=20' }, dependencies: { a: '^1' }, scripts: { lint: 'eslint .' } }),
  'package-lock.json': '{}',
  'tsconfig.json': '{}',
  'src/a.js': 'export const a = 1;\n',
  'README.md': README,
});
assert.equal(b.findings.some((f) => f.kind === 'no build script'), false, 'plain JS with a tsconfig needs no build script');

// Real TypeScript sources with no build script is a genuine gap.
b = await make({
  'package.json': JSON.stringify({ name: 'x', engines: { node: '>=20' }, dependencies: { a: '^1' }, scripts: { lint: 'eslint .' } }),
  'package-lock.json': '{}',
  'tsconfig.json': '{}',
  'src/a.ts': 'export const a: number = 1;\n',
  'README.md': README,
});
assert.equal(b.findings.some((f) => f.kind === 'no build script'), true);

// The findings that actually stop a new team, each one named and located.
b = await make({
  'package.json': JSON.stringify({ name: 'x', dependencies: { internal: 'git+ssh://git@example.com/internal.git' } }),
  'package-lock.json': '{}',
  '.npmrc': '//npm.example.com/:_authToken=${TOKEN}\nregistry=https://npm.example.com\n',
  '.gitmodules': '[submodule "core"]\n  url = git@example.com:core.git\n',
  'README.md': '# Thing\n',
});
const kinds = b.findings.map((f) => f.kind);
assert.ok(kinds.includes('private registry'));
assert.ok(kinds.includes('local or private dependency'));
assert.ok(kinds.includes('private submodules'));
assert.ok(kinds.includes('undocumented'));
assert.equal(b.verdict.level, 'risk');

// Public submodules are a step people forget, not a wall they cannot pass.
b = await make({
  'package.json': JSON.stringify({ name: 'x', engines: { node: '>=20' } }),
  '.gitmodules': '[submodule "fixtures"]\n  url = https://github.com/tc39/test262\n',
  'README.md': README,
});
assert.equal(b.findings.some((f) => f.kind === 'private submodules'), false);
assert.equal(b.verdict.level, 'watch');

// Setup instructions live in CONTRIBUTING as often as in the README.
b = await make({
  'package.json': JSON.stringify({ name: 'x', engines: { node: '>=20' } }),
  'README.md': '# Thing\n\nA library.\n',
  'CONTRIBUTING.md': '## Development\n\nRun `npm install` and then `npm test`.\n',
});
assert.equal(b.findings.some((f) => f.kind === 'undocumented'), false);

// A repository holding several projects has no manifest at the top. Calling
// that "no recognised project manifest" is wrong, and it was: this tool said
// exactly that about its own repository.
b = await make({
  'README.md': '# Monorepo\n\n## Setup\n\nRun `npm test` in each package.\n',
  'tool/package.json': JSON.stringify({ name: 'tool', engines: { node: '>=20' } }),
  'service/pyproject.toml': '[project]\nname = "service"\n',
});
assert.equal(b.findings.some((f) => f.kind === 'no stack'), false);
assert.ok(b.ok.some((o) => o.includes('several projects in one repository')));

// Documentation is not only written in English. This tool called its own
// repository undocumented because the heading said "Uruchomienie".
b = await make({
  'package.json': JSON.stringify({ name: 'x', engines: { node: '>=20' } }),
  'README.md': '# Narzedzie\n\n## Uruchomienie\n\nnpm test w katalogu projektu.\n',
});
assert.equal(b.findings.some((f) => f.kind === 'undocumented'), false);

for (const d of dirs) await rm(d, { recursive: true, force: true });
console.log('buildability: 14 assertions passed');

// A readme is a readme whatever the shift key was doing. express keeps its in
// `Readme.md`, and the first version reported the project as undocumented and
// as having no documentation at all, twice, on the same run.
{
  const dir = await mkdtemp(join(tmpdir(), 'ancient-case-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node .' } }));
  await writeFile(join(dir, 'package-lock.json'), '{}');
  await writeFile(join(dir, 'Readme.md'), '# x\n\n## Installation\n\nRun `npm install` and then `npm test`.\n');
  const b = await buildability(dir);
  assert.equal(b.findings.some((f) => f.kind === 'undocumented'), false,
    'Readme.md counts, and so would README.MD');
  await rm(dir, { recursive: true, force: true });
  console.log('buildability: 1 more assertion passed (filename case)');
}
