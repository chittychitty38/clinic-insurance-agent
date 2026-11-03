import { clinic } from './clinic.js';
import { env } from './config.js';
import { PATIENTS } from './data/patients.js';
import { payerByKey } from './payers.js';

/** One self-contained page for front-desk staff: live calls, callback queue, and a scenario runner. */
export function renderDashboard(opts: { token?: string }): string {
  const scenarios = PATIENTS.map((p) => ({
    id: p.id,
    name: `${p.firstName} ${p.lastName}`,
    dob: p.dateOfBirth,
    payer: payerByKey(p.coverage.payerKey)?.displayName ?? p.coverage.payerKey,
    memberId: p.coverage.memberId,
    scenario: p.scenario,
  }));
  const phone = env.CLINIC_PHONE_NUMBER ?? '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${clinic.name} · Insurance Line</title>
<style>
:root {
  --bg: #f6f7f9; --panel: #ffffff; --ink: #0f172a; --muted: #64748b; --line: #e2e8f0;
  --accent: #0f766e; --accent-soft: #ccfbf1;
  --ok: #15803d; --ok-soft: #dcfce7; --warn: #b45309; --warn-soft: #fef3c7;
  --bad: #b91c1c; --bad-soft: #fee2e2; --info: #1d4ed8; --info-soft: #dbeafe; --neutral-soft: #f1f5f9;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b1120; --panel: #111827; --ink: #e5e7eb; --muted: #94a3b8; --line: #1f2937;
    --accent: #2dd4bf; --accent-soft: #134e4a;
    --ok: #4ade80; --ok-soft: #14532d; --warn: #fbbf24; --warn-soft: #422006;
    --bad: #f87171; --bad-soft: #450a0a; --info: #93c5fd; --info-soft: #1e3a8a; --neutral-soft: #1f2937;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
header { padding: 24px 32px 0; max-width: 1200px; margin: 0 auto; display: flex; gap: 16px; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; }
h1 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
.sub { color: var(--muted); margin-top: 2px; }
.phone { background: var(--accent); color: white; padding: 10px 16px; border-radius: 12px; font-weight: 600; text-decoration: none; }
@media (prefers-color-scheme: dark) { .phone { color: #042f2e; } }
nav { max-width: 1200px; margin: 20px auto 0; padding: 0 32px; display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
nav button { background: none; border: 0; padding: 10px 14px; font: inherit; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
nav button.on { color: var(--ink); border-color: var(--accent); font-weight: 600; }
nav .count { background: var(--neutral-soft); border-radius: 999px; padding: 0 7px; font-size: 12px; margin-left: 4px; }
main { max-width: 1200px; margin: 0 auto; padding: 20px 32px 60px; }
section { display: none; } section.on { display: block; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; margin-bottom: 12px; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.spacer { flex: 1; }
.chip { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: var(--neutral-soft); color: var(--muted); white-space: nowrap; }
.chip.ACCEPTED { background: var(--ok-soft); color: var(--ok); }
.chip.ACCEPTED_COPAY_UNCONFIRMED, .chip.NOT_IN_NETWORK, .chip.DENTAL_PLAN, .chip.WHICH_INSURANCE, .chip.UNKNOWN_INSURANCE { background: var(--warn-soft); color: var(--warn); }
.chip.COVERAGE_INACTIVE, .chip.TOOL_ERROR, .chip.CLINIC_SETUP_ISSUE { background: var(--bad-soft); color: var(--bad); }
.chip.PLEASE_VERIFY_DETAILS, .chip.PAYER_UNAVAILABLE, .chip.NEED_INFO, .chip.CALLBACK_CREATED { background: var(--info-soft); color: var(--info); }
.say { margin: 10px 0 0; padding: 10px 14px; border-left: 3px solid var(--accent); background: var(--neutral-soft); border-radius: 0 10px 10px 0; }
.muted { color: var(--muted); } .small { font-size: 13px; } .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.timeline { margin: 10px 0 0; padding: 0; list-style: none; }
.timeline li { padding: 8px 0; border-top: 1px dashed var(--line); }
details summary { cursor: pointer; color: var(--muted); font-size: 13px; margin-top: 8px; }
pre { white-space: pre-wrap; word-break: break-word; background: var(--neutral-soft); padding: 10px 12px; border-radius: 10px; font-size: 12.5px; margin: 8px 0 0; max-height: 360px; overflow: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 10px 8px; border-top: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border-top: 0; }
td.result { width: 46%; }
button.btn { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; }
button.btn.primary { background: var(--accent); color: white; border-color: var(--accent); }
@media (prefers-color-scheme: dark) { button.btn.primary { color: #042f2e; } }
button.btn:disabled { opacity: .5; cursor: progress; }
.empty { text-align: center; padding: 40px; color: var(--muted); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.stat b { display: block; font-size: 22px; }
@media (max-width: 720px) {
  header, nav, main { padding-left: 16px; padding-right: 16px; }
  td.result { width: auto; }
  .hide-sm { display: none; }
}
</style>
</head>
<body>
<header>
  <div>
    <h1>${clinic.name} · Insurance line</h1>
    <div class="sub">${clinic.agentName}, the AI front desk, answers "do you take my insurance, and what's my copay?" with live payer data.</div>
  </div>
  ${phone ? `<a class="phone" href="tel:${phone}">Call ${formatPhone(phone)}</a>` : ''}
</header>
<nav>
  <button data-tab="calls" class="on">Calls <span class="count" id="n-calls">0</span></button>
  <button data-tab="callbacks">Callback queue <span class="count" id="n-cb">0</span></button>
  <button data-tab="scenarios">Patient scenarios <span class="count">${scenarios.length}</span></button>
</nav>
<main>
  <section id="calls" class="on"><div id="calls-list"><div class="empty">No calls yet. Dial the number above to try it.</div></div></section>
  <section id="callbacks"><div id="cb-list"></div></section>
  <section id="scenarios">
    <div class="stats" id="stats"></div>
    <div class="card">
      <div class="row">
        <div><b>Every preset patient, through the same pipeline the phone agent uses.</b>
        <div class="muted small">Live Stedi sandbox checks. The right column is the exact sentence the caller would hear.</div></div>
        <span class="spacer"></span>
        <label class="small muted"><input type="checkbox" id="routine" /> routine eye exam</label>
        <button class="btn primary" id="run-all">Run all</button>
      </div>
      <table>
        <thead><tr><th>Patient</th><th class="hide-sm">Insurance on card</th><th>Scenario</th><th class="result">What ${clinic.agentName} says</th></tr></thead>
        <tbody id="scenario-rows"></tbody>
      </table>
    </div>
  </section>
</main>
<script>
const TOKEN = ${JSON.stringify(opts.token ?? '')};
const SCENARIOS = ${JSON.stringify(scenarios)};
const q = (p) => p + (TOKEN ? (p.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN) : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = (o) => String(o || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const time = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';

document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button, section').forEach((el) => el.classList.remove('on'));
  b.classList.add('on'); document.getElementById(b.dataset.tab).classList.add('on');
});

function renderCalls(calls) {
  const real = calls.filter((c) => c.source !== 'dashboard');
  document.getElementById('n-calls').textContent = real.length;
  if (!real.length) return;
  document.getElementById('calls-list').innerHTML = real.map((c) => {
    const last = [...c.events].reverse().find((e) => e.tool === 'check_insurance');
    return '<div class="card">' +
      '<div class="row"><b>' + esc(c.source === 'phone' ? (c.callerNumber || 'Phone call') : c.source + ' call') + '</b>' +
      '<span class="muted small">' + time(c.startedAt) + (c.durationSeconds ? ' · ' + Math.round(c.durationSeconds) + 's' : '') + (c.endedAt ? '' : ' · <b style="color:var(--ok)">live</b>') + '</span>' +
      '<span class="spacer"></span>' + (last ? '<span class="chip ' + esc(last.outcome) + '">' + esc(label(last.outcome)) + '</span>' : '') + '</div>' +
      (last && last.say ? '<div class="say">' + esc(last.say) + '</div>' : '') +
      (c.summary ? '<p class="small"><b>Summary:</b> ' + esc(c.summary) + '</p>' : '') +
      '<ul class="timeline">' + c.events.map((e) =>
        '<li class="small"><span class="muted">' + time(e.at) + '</span> · <b>' + esc(e.tool) + '</b> <span class="chip ' + esc(e.outcome) + '">' + esc(label(e.outcome)) + '</span> <span class="muted">' + e.ms + ' ms</span>' +
        '<details><summary>details</summary><pre>' + esc(JSON.stringify({ args: e.args, detail: e.detail }, null, 2)) + '</pre></details></li>').join('') + '</ul>' +
      (c.transcript ? '<details><summary>Transcript</summary><pre>' + esc(c.transcript) + '</pre></details>' : '') +
      (c.recordingUrl ? '<p class="small"><a href="' + esc(c.recordingUrl) + '" target="_blank" rel="noopener">Recording</a></p>' : '') +
    '</div>';
  }).join('');
}

function renderCallbacks(cbs) {
  const open = cbs.filter((c) => c.status === 'open');
  document.getElementById('n-cb').textContent = open.length;
  document.getElementById('cb-list').innerHTML = cbs.length ? cbs.map((c) =>
    '<div class="card"><div class="row"><b>' + esc(c.callerName) + '</b><span class="mono">' + esc(c.phone || 'no number') + '</span>' +
    '<span class="muted small">' + time(c.at) + '</span><span class="spacer"></span>' +
    (c.status === 'open' ? '<button class="btn" onclick="done(\\'' + c.id + '\\')">Mark done</button>' : '<span class="chip ACCEPTED">Done</span>') +
    '</div><div class="say">' + esc(c.reason) + '</div></div>').join('') : '<div class="empty">No callback requests.</div>';
}

async function done(id) { await fetch(q('/api/callbacks/' + id + '/done'), { method: 'POST' }); refresh(); }

async function refresh() {
  try {
    const r = await fetch(q('/api/state'));
    if (!r.ok) return;
    const s = await r.json();
    renderCalls(s.calls); renderCallbacks(s.callbacks);
  } catch {}
}

const results = {};
function renderScenarios() {
  document.getElementById('scenario-rows').innerHTML = SCENARIOS.map((s) => {
    const r = results[s.id];
    return '<tr><td><b>' + esc(s.name) + '</b><div class="muted small">DOB ' + esc(s.dob) + '</div></td>' +
      '<td class="hide-sm">' + esc(s.payer) + '<div class="mono muted">' + esc(s.memberId) + '</div></td>' +
      '<td class="small">' + esc(s.scenario) + '</td>' +
      '<td class="result">' + (r ? (r.loading ? '<span class="muted small">Checking with payer…</span>' :
        '<span class="chip ' + esc(r.answer.outcome) + '">' + esc(label(r.answer.outcome)) + '</span> <span class="muted small">' + (r.audit.ms ?? '') + (r.audit.ms ? ' ms' : '') + '</span>' +
        '<div class="say small">' + esc(r.answer.say) + '</div>' +
        '<details><summary>facts &amp; payer request</summary><pre>' + esc(JSON.stringify({ facts: r.answer.facts, next_step: r.answer.next_step, stediCheckId: r.audit.stediCheckId, interpreted: r.audit.facts, request: r.audit.request }, null, 2)) + '</pre></details>')
        : '<button class="btn" onclick="runOne(\\'' + s.id + '\\')">Run check</button>') + '</td></tr>';
  }).join('');
  const done = Object.values(results).filter((r) => r && !r.loading);
  const by = (o) => done.filter((r) => r.answer.outcome === o).length;
  document.getElementById('stats').innerHTML = done.length ? [
    ['Checked', done.length], ['Accepted', by('ACCEPTED')], ['Not accepted', by('NOT_IN_NETWORK') + by('COVERAGE_INACTIVE') + by('DENTAL_PLAN')],
    ['Escalated safely', done.length - by('ACCEPTED') - by('NOT_IN_NETWORK') - by('COVERAGE_INACTIVE') - by('DENTAL_PLAN')],
  ].map(([k, v]) => '<div class="stat"><span class="muted small">' + k + '</span><b>' + v + '</b></div>').join('') : '';
}

async function runOne(id) {
  results[id] = { loading: true }; renderScenarios();
  const r = await fetch(q('/api/check/' + id), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visit_type: document.getElementById('routine').checked ? 'routine' : 'medical' }) });
  results[id] = r.ok ? await r.json() : { answer: { outcome: 'TOOL_ERROR', say: 'HTTP ' + r.status }, audit: {} };
  renderScenarios();
}

document.getElementById('run-all').onclick = async (ev) => {
  ev.target.disabled = true;
  for (let i = 0; i < SCENARIOS.length; i += 4) await Promise.all(SCENARIOS.slice(i, i + 4).map((s) => runOne(s.id)));
  ev.target.disabled = false;
};

renderScenarios(); refresh(); setInterval(refresh, 3000);
</script>
</body>
</html>`;
}

function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}
