import assert from 'node:assert/strict';
import { renderHtml, assess } from '../src/report.mjs';

/**
 * A stray brace in the stylesheet is invisible in the source and silent in the
 * browser: CSS has no errors, it just discards the rule it cannot parse and
 * carries on. One orphan `}` in the sister project took `th,td` with it, so
 * every table in every HTML report lost its padding, its alignment and its
 * vertical anchoring, on desktop only, in a file nobody opens in a debugger.
 *
 * This reads the emitted stylesheet the way a parser does.
 */
export function cssProblems(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const problems = [];
  let depth = 0;
  let line = 1;
  for (const ch of clean) {
    if (ch === '\n') line += 1;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) {
        problems.push(`line ${line}: a closing brace with nothing open, everything after it is discarded`);
        depth = 0;
      }
    }
  }
  if (depth > 0) problems.push(`${depth} block${depth === 1 ? '' : 's'} left unclosed`);
  return problems;
}

const styleOf = (html) => html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));

const own = {
  sinceYears: 3,
  modules: [{
    module: 'src', changes: 10, authors: 1, topAuthor: 'A', topAuthorShare: 1,
    busFactor: 1, topAuthorLastSeen: '2026-01-01', lastTouched: '2026-01-01',
  }],
};
const css = styleOf(renderHtml('owner/repo', assess({ own }), own));

assert.deepEqual(cssProblems(css), [], 'the stylesheet must parse as written');

// The rules that carry the table and the verdict rows.
for (const selector of ['th,td{', 'thead th{', 'td.num{', 'table{', '.row{', '.brand{']) {
  assert.ok(css.includes(selector), `${selector} is missing from the stylesheet`);
}

const cell = css.slice(css.indexOf('th,td{'), css.indexOf('}', css.indexOf('th,td{')));
assert.match(cell, /padding:/, 'table cells need padding or the text touches the border');
assert.match(cell, /text-align:left/, 'headers default to centred and stop lining up with their column');
assert.match(cell, /vertical-align:top/, 'a short cell must sit level with a tall one');

// The checker has to fail on the real thing, not just pass on a good file.
assert.equal(cssProblems('a{b:c}}d{e:f}').length, 1, 'an orphan closing brace is a problem');
assert.equal(cssProblems('a{b:c').length, 1, 'an unclosed block is a problem');
assert.deepEqual(cssProblems('@media (x){a{b:c}}'), [], 'nesting one level deep is fine');

console.log('stylesheet: 13 assertions passed');
