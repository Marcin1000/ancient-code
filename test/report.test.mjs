import assert from 'node:assert/strict';
import { assess, renderText } from '../src/report.mjs';

// The one promise this whole tool makes: what was not measured is never
// reported as a pass. The command line always fills every input, but this is
// also the library entry point, and a caller who leaves one out must see it.
const empty = assess({});
for (const [name, verdict] of [
  ['ownership', empty.ownershipVerdict],
  ['safety', empty.safety.verdict],
  ['scaffolding', empty.scaffolding],
  ['build', empty.buildVerdict],
  ['docs', empty.docs.verdict],
]) {
  assert.equal(verdict.level, 'unmeasured', `${name} must not pass without a measurement`);
  assert.ok(verdict.why.length > 0, `${name} must say why it is unmeasured`);
}

// assess() with no argument at all must behave the same, not crash.
assert.equal(assess().ownershipVerdict.level, 'unmeasured');

// Git failing is a failure to measure, not a codebase with shared knowledge.
// Read naively, an empty module list looks exactly like a healthy repository.
const broken = assess({ own: { error: 'this is not a git repository', modules: [] } });
assert.equal(broken.ownershipVerdict.level, 'unmeasured');
assert.match(broken.ownershipVerdict.why, /not a git repository/);

// A repository with no commits in the window is the same situation.
const quiet = assess({ own: { sinceYears: 3, modules: [] } });
assert.equal(quiet.ownershipVerdict.level, 'unmeasured');

// A repository with real history still reports a real verdict.
const alive = assess({
  own: {
    sinceYears: 3,
    modules: [
      { module: 'src', changes: 10, authors: 1, topAuthor: 'Ada', topAuthorShare: 1, busFactor: 1, topAuthorLastSeen: '2026-01-01', lastTouched: '2026-01-01' },
      { module: 'docs', changes: 8, authors: 5, topAuthor: 'Grace', topAuthorShare: 0.3, busFactor: 3, topAuthorLastSeen: '2026-01-02', lastTouched: '2026-01-02' },
    ],
  },
});
assert.equal(alive.ownershipVerdict.level, 'risk');
assert.match(alive.ownershipVerdict.why, /1 of 2 modules/);

// The text report must render an unmeasured run without crashing, and it must
// not print "null" where a count belongs.
const text = renderText('nothing-measured', empty, {});
assert.match(text, /not measured/);
assert.ok(!/null/.test(text), 'no raw nulls in the report');
assert.match(text, /Source files: not measured/);

console.log('report: 17 assertions passed');
