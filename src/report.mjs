import { ownershipRisk } from './ownership.mjs';

/**
 * The six questions from the transferability report. Five of them are measured
 * here today. The last one is named anyway, marked as not measured, because
 * a report that quietly omits what it cannot do teaches the reader to trust it
 * in places where it has nothing to say.
 */
export const CRITERIA = [
  { id: 'ownership', title: 'How many people understand each part?', measured: true },
  { id: 'safety', title: 'Is there a safety net for changes?', measured: true },
  { id: 'scaffolding', title: 'How much scaffolding did nobody remove?', measured: 'with ancient-fences' },
  { id: 'build', title: 'Does it build from scratch?', measured: true },
  { id: 'docs', title: 'Is the documentation real?', measured: true },
  { id: 'keys', title: 'Who holds the keys?', measured: false },
];

const RANK = { risk: 0, watch: 1, ok: 2 };

/**
 * Nothing that was not measured may come back as a pass. The command line
 * always supplies every input, but this is also the library entry point, and a
 * caller who leaves one out has to see "not measured" rather than a green line
 * they never earned. The same holds when git could not be read at all: an
 * empty history is a failure to measure, not a codebase with shared knowledge.
 */
const unmeasured = (why) => ({ level: 'unmeasured', why });

export function assess({ own, safety, fences, build, buildRun, docs } = {}) {
  const modules = (own?.modules ?? []).map((row) => ({ ...row, risk: ownershipRisk(row) }));
  const atRisk = modules
    .filter((m) => m.risk.level !== 'ok')
    .sort((a, b) => RANK[a.risk.level] - RANK[b.risk.level] || b.changes - a.changes);

  const ownershipVerdict = !own
    ? unmeasured('ownership was not measured in this run')
    : own.error
      ? unmeasured(own.error)
      : modules.length === 0
        ? unmeasured('no commits in the window measured, so ownership says nothing')
        : atRisk.some((m) => m.risk.level === 'risk')
          ? { level: 'risk', why: `${atRisk.filter((m) => m.risk.level === 'risk').length} of ${modules.length} modules depend on one person` }
          : atRisk.length > 0
            ? { level: 'watch', why: `${atRisk.length} of ${modules.length} modules are close to a single owner` }
            : { level: 'ok', why: `knowledge is shared across all ${modules.length} modules` };

  // Findings in tests are counted apart: a comment in a test linking to an
  // issue is usually the regression test for that bug, and a closed issue
  // there is a reason to keep the test rather than remove it.
  const scaffolding = fences
    ? {
        level: fences.summary.old > 0 ? 'watch' : 'ok',
        why: `${fences.summary.inSource ?? fences.summary.total} in source`
          + `${fences.summary.inTests ? `, ${fences.summary.inTests} in tests (kept, not work)` : ''}`
          + `, ${fences.summary.old} untouched for 3+ years, ${fences.summary.trackers} external issues to check`,
      }
    : unmeasured('the scaffolding scan did not run in this pass');

  // A build that was actually run beats any amount of inference about one.
  const buildVerdict = buildRun && build
    ? { level: buildRun.verdict.level, why: `${buildRun.verdict.why}; ${build.verdict.why}` }
    : buildRun
      ? buildRun.verdict
      : build
        ? build.verdict
        : unmeasured('buildability was not measured in this run');

  const safetyOut = safety ?? { verdict: unmeasured('the safety net was not measured in this run'), totalSource: null, totalTests: null, ci: { present: false, files: [] } };
  const docsOut = docs ?? { verdict: unmeasured('documentation was not measured in this run'), findings: [] };
  const buildOut = build ?? { verdict: buildVerdict, findings: [] };

  return { modules, atRisk, ownershipVerdict, scaffolding, safety: safetyOut, build: buildOut, buildRun, buildVerdict, docs: docsOut };
}

export function renderText(repoName, a, own = {}) {
  const L = [];
  const mark = (level) => ({ ok: '  ok  ', watch: ' watch', risk: ' RISK ', unmeasured: '  --  ' }[level] ?? '  ?   ');
  L.push('');
  L.push(`  ANCIENT CODE / transferability, partial run`);
  L.push(`  ${repoName}`);
  L.push('  ' + '='.repeat(72));
  L.push(`  [${mark(a.ownershipVerdict.level)}]  How many people understand each part?`);
  L.push(`            ${a.ownershipVerdict.why}`);
  L.push(`  [${mark(a.safety.verdict.level)}]  Is there a safety net for changes?`);
  L.push(`            ${a.safety.verdict.why}`);
  L.push(`  [${mark(a.scaffolding.level)}]  How much scaffolding did nobody remove?`);
  L.push(`            ${a.scaffolding.why}`);
  L.push(`  [${mark(a.buildVerdict.level)}]  Does it build from scratch?`);
  L.push(`            ${a.buildVerdict.why}`);
  for (const f of a.build.findings) L.push(`            missing: ${f.what} (${f.where})`);
  if (a.buildRun) for (const s of a.buildRun.steps) L.push(`            ${s.ok ? 'ran' : 'FAILED'}: ${s.step} (${s.note})`);
  L.push(`  [${mark(a.docs.verdict.level)}]  Is the documentation real?`);
  L.push(`            ${a.docs.verdict.why}`);
  for (const f of (a.docs.findings ?? []).filter((f) => f.kind !== 'unanswered question')) {
    L.push(`            ${f.kind}: ${f.what} (${f.where})`);
  }
  for (const c of CRITERIA.filter((c) => c.measured === false)) {
    L.push(`  [${mark('unmeasured')}]  ${c.title}`);
    L.push(`            not measured in this run`);
  }
  L.push('');
  L.push(`  KNOWLEDGE CONCENTRATED IN ONE PERSON  (last ${own.sinceYears ?? '?'} years)`);
  L.push('  ' + '-'.repeat(72));
  if (a.atRisk.length === 0) {
    L.push('  Nothing stands out. Every module has been touched by several people.');
  }
  for (const m of a.atRisk.slice(0, 12)) {
    L.push(`  ${m.risk.level.toUpperCase().padEnd(6)} ${m.module.padEnd(30)} ${String(m.changes).padStart(6)} changes`);
    L.push(`         ${m.risk.why}`);
    L.push(`         busiest: ${m.topAuthor}, last seen ${m.topAuthorLastSeen ?? 'unknown'}`);
    L.push('');
  }
  L.push('  ' + '-'.repeat(72));
  const counted = (n) => (n === null || n === undefined ? 'not measured' : n);
  L.push(`  Source files: ${counted(a.safety.totalSource)}   test files: ${counted(a.safety.totalTests)}   CI: ${a.safety.ci.present ? a.safety.ci.files.join(', ') : 'none'}`);
  L.push('');
  L.push('  Measured from the repository only. Nothing here is an opinion about');
  L.push('  anyone. One of the six questions still needs a person: who holds the keys.');
  L.push('');
  return L.join('\n');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderHtml(repoName, a, own) {
  const row = (level, title, why) => `
    <div class="row">
      <div><h4>${esc(title)}</h4><p>${esc(why)}</p></div>
      <span class="state s-${level}">${{ ok: 'ok', watch: 'watch', risk: 'risk', unmeasured: 'not measured' }[level] ?? level}</span>
    </div>`;

  const risky = a.atRisk.slice(0, 12).map((m) => `
    <tr>
      <td><code>${esc(m.module)}</code></td>
      <td class="num">${m.changes}</td>
      <td class="num">${m.authors}</td>
      <td><span class="state s-${m.risk.level}">${m.risk.level}</span><p>${esc(m.risk.why)}</p></td>
      <td class="num">${esc(m.topAuthorLastSeen ?? 'unknown')}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ancient Code: ${esc(repoName)}</title>
<style>
:root{--ground:#0F1216;--surface:#171C22;--surface2:#1E242B;--line:#2B333B;--ink:#E7E1D4;--dim:#A7A69C;--muted:#83877F;--gold:#E0A45C;--inst:#8FC3D2;--risk:#C2603F}
@media (prefers-color-scheme:light){:root{--ground:#E3E2DC;--surface:#EDEBE4;--surface2:#F3F1EB;--line:#CFCCC1;--ink:#1A1E22;--dim:#4A4F53;--muted:#6B6F68;--gold:#8B5514;--inst:#2A6274;--risk:#993A1E}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:66rem;margin:0 auto;padding:0 clamp(1rem,4vw,2.5rem)}
header{border-bottom:1px solid var(--line);padding:3rem 0 2rem}
h1{font:300 clamp(2rem,5vw,3.2rem)/1.05 ui-serif,Georgia,serif;letter-spacing:-.02em;margin:0}
.mono,code,.num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.mono{font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0}
.sub{color:var(--dim);margin:.7rem 0 0}
.panel{border:1px solid var(--line);background:var(--surface);margin:2.5rem 0}
.row{display:grid;grid-template-columns:1fr auto;gap:1rem;padding:1rem 1.3rem;border-bottom:1px solid var(--line);align-items:center}
.row:last-child{border-bottom:0}
.row h4{margin:0;font-size:1rem}
.row p{margin:.2rem 0 0;color:var(--dim);font-size:.86rem}
.state{font-family:ui-monospace,monospace;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;color:var(--dim)}
.s-risk{color:var(--risk)}
.s-watch{color:var(--gold)}
.s-unmeasured{color:var(--muted)}
h2{font:300 1.6rem/1.1 ui-serif,Georgia,serif;margin:2.5rem 0 1rem}
.scroll{overflow-x:auto;border:1px solid var(--line);background:var(--surface)}
table{border-collapse:collapse;width:100%;min-width:44rem;font-size:.88rem}
th,td{text-align:left;padding:.75rem 1rem;border-bottom:1px solid var(--line);vertical-align:top}
thead th{font-family:ui-monospace,monospace;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:400;background:var(--surface2);white-space:nowrap}
td p{margin:.3rem 0 0;color:var(--dim);font-size:.8rem}
td.num{font-variant-numeric:tabular-nums;color:var(--dim);white-space:nowrap;font-size:.82rem}
footer{border-top:1px solid var(--line);margin-top:3rem;padding:2rem 0 4rem;color:var(--muted);font-size:.85rem}
footer p{max-width:62ch}
</style></head><body>
<header><div class="wrap">
  <p class="mono">Ancient Code / transferability, partial run / ${esc(new Date().toISOString().slice(0, 10))}</p>
  <h1>${esc(repoName)}</h1>
  <p class="sub">Measured from the repository. Three of the six questions still need a person.</p>
</div></header>
<main class="wrap">
  <div class="panel">
    ${row(a.ownershipVerdict.level, 'How many people understand each part?', a.ownershipVerdict.why)}
    ${row(a.safety.verdict.level, 'Is there a safety net for changes?', a.safety.verdict.why)}
    ${row(a.scaffolding.level, 'How much scaffolding did nobody remove?', a.scaffolding.why)}
    ${row(a.buildVerdict.level, 'Does it build from scratch?', a.buildVerdict.why)}
    ${row(a.docs.verdict.level, 'Is the documentation real?', a.docs.verdict.why)}
    ${row('unmeasured', 'Who holds the keys?', 'answered by a person, not by a scanner')}
  </div>
  <h2>Where knowledge is concentrated</h2>
  <div class="scroll"><table>
    <thead><tr><th>Module</th><th>Changes</th><th>People</th><th>Reading</th><th>Busiest person last seen</th></tr></thead>
    <tbody>${risky || '<tr><td colspan="5">Nothing stands out: every module has been touched by several people.</td></tr>'}</tbody>
  </table></div>
</main>
<footer><div class="wrap">
  <p>Ownership is read from ${own.sinceYears} years of authorship history, counting one change per commit per module. Test coverage is presence of test files and a CI job that runs them, not a coverage run. Nothing in this report is an opinion about any person's work.</p>
</div></footer>
</body></html>`;
}
