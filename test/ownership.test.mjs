import assert from 'node:assert/strict';
import { summarize, moduleOf, isNoise, normalizeAuthor, ownershipRisk } from '../src/ownership.mjs';

const REC = '\u0001';
const FLD = '\u0002';

/** Build the git log output this module parses, so tests need no repository. */
function log(commits) {
  return commits.map(([author, date, files]) =>
    `${REC}${author}${FLD}${date}\n${files.join('\n')}\n`).join('\n');
}

// One commit counts once per module, however many files it touched. Without
// this, a single commit of regenerated output outweighs a year of real work.
const bulk = summarize(log([
  ['Ada', '2026-01-05', ['website/a.js', 'website/b.js', 'website/c.js', 'website/d.js']],
  ['Grace', '2026-01-06', ['src/core/pay.js']],
  ['Linus', '2026-01-07', ['src/core/pay.js']],
]));
const website = bulk.modules.find((m) => m.module === 'website');
assert.equal(website.changes, 1, 'four files in one commit are one change');

// Ownership concentration is the finding, and the merged identity is what
// makes it visible: the same human writing under two spellings.
const merged = summarize(log([
  ['Alexander Akait', '2026-08-01', ['lib/http/server.js']],
  ['alexander.akait', '2026-08-02', ['lib/http/client.js']],
  ['alexander-akait', '2026-08-03', ['lib/http/proxy.js']],
  ['Somebody Else', '2026-08-04', ['lib/http/util.js']],
]));
const http = merged.modules.find((m) => m.module === 'lib/http');
assert.equal(http.authors, 2, 'three spellings of one name are one person');
assert.equal(http.busFactor, 1);
assert.equal(http.topAuthor, 'Alexander Akait', 'the readable spelling is the one reported');

assert.equal(normalizeAuthor('Alexander Akait'), normalizeAuthor('alexander.akait'));
assert.equal(normalizeAuthor('dependabot[bot]'), 'dependabot bot');
assert.equal(normalizeAuthor(''), '');

// Modules are named the way a person would name them in conversation.
assert.equal(moduleOf('src/payments/refund.ts'), 'src/payments');
assert.equal(moduleOf('lib/http.js'), 'lib');
assert.equal(moduleOf('README.md'), '(root)');

// Generated and vendored files say nothing about who understands the system.
assert.equal(isNoise('node_modules/left-pad/index.js'), true);
assert.equal(isNoise('package-lock.json'), true);
assert.equal(isNoise('src/payments/refund.ts'), false);

// The three readings exist because they start three different conversations.
const sole = { authors: 1, busFactor: 1, topAuthorShare: 1, topAuthorLastSeen: '2026-08-01' };
assert.equal(ownershipRisk(sole).level, 'risk');
assert.match(ownershipRisk({ ...sole, topAuthorLastSeen: '2020-01-01' }).why, /has not committed anywhere since/);

const dominant = { authors: 5, busFactor: 1, topAuthorShare: 0.7, topAuthorLastSeen: '2026-08-01' };
assert.equal(ownershipRisk(dominant).level, 'risk');

// A bus factor of one on a thin majority is not the same thing as ownership.
const thin = { authors: 6, busFactor: 1, topAuthorShare: 0.51, topAuthorLastSeen: '2026-08-01' };
assert.equal(ownershipRisk(thin).level, 'watch');

const shared = { authors: 8, busFactor: 4, topAuthorShare: 0.3, topAuthorLastSeen: '2026-08-01' };
assert.equal(ownershipRisk(shared).level, 'ok');

console.log('ownership: 18 assertions passed');
