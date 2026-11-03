import { clinic } from './clinic.js';
import { env } from './config.js';
import { PATIENTS } from './data/patients.js';
import { payerByKey } from './payers.js';

/**
 * One self-contained page for front-desk staff: live calls, the callback queue, and a scenario
 * runner. Same exam-room look as the project site (ink room, paper cards, duochrome stamps).
 */
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
<meta name="robots" content="noindex" />
<title>Front desk · ${clinic.name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Mono:wght@400;600&family=Atkinson+Hyperlegible+Next:wght@400;500;700&family=Lexend+Zetta:wght@800&family=Lexend:wght@700;800&display=swap">
<style>
:root {
  --ink: #0E1220; --ink-2: #161B2E; --ink-3: #222A45; --rule-d: #2E3756;
  --paper: #FBF6EA; --paper-2: #F2EAD6; --cream: #FFF1D6; --dim: #B3BCE0; --pdim: #4B5373;
  --red: #FF4A3D; --green: #34C774; --amber: #FFB436; --blue: #8CAAFF; --violet: #BC97FF;
  --red-p: #C42619; --green-p: #137A3D; --amber-p: #935600; --blue-p: #2645B0; --violet-p: #6633C4;
  --head: "Lexend", system-ui, sans-serif; --wide: "Lexend Zetta", "Lexend", system-ui, sans-serif;
  --body: "Atkinson Hyperlegible Next", system-ui, sans-serif; --mono: "Atkinson Hyperlegible Mono", ui-monospace, Menlo, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--ink); color: var(--cream); font: 16px/1.5 var(--body); }
a { color: inherit; }
.wrap { max-width: 1240px; margin: 0 auto; padding: 0 max(16px, env(safe-area-inset-left)); }
.label { font: 600 11px/1.3 var(--mono); letter-spacing: .16em; text-transform: uppercase; }
header { border-bottom: 2px solid var(--rule-d); }
header .wrap { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 24px; padding-block: 18px; }
.brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
.mark { flex: none; width: 40px; height: 40px; display: grid; place-items: center; background: var(--paper); color: var(--ink); border: 2px solid var(--ink); outline: 2px solid var(--paper); border-radius: 8px; font: 800 22px/1 var(--wide); transform: rotate(-8deg); box-shadow: 3px 4px 0 var(--red); }
h1 { margin: 0; font: 800 24px/1.1 var(--head); letter-spacing: -.02em; }
.brand .label { color: var(--dim); margin-top: 4px; }
.head-right { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.listening { display: inline-flex; align-items: center; gap: 9px; padding: 8px 14px; border: 2px solid var(--rule-d); border-radius: 999px; color: var(--dim); }
.listening i { width: 9px; height: 9px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 4px rgba(52, 199, 116, .2), 0 0 12px var(--green); }
.phone { display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px; border-radius: 999px; background: var(--red); color: var(--ink); font: 700 15px/1 var(--head); text-decoration: none; box-shadow: 4px 5px 0 var(--cream); }
.leds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 24px 0 8px; }
.led { background: #070A12; border: 3px solid var(--ink-3); border-radius: 14px; padding: 14px 16px 12px; display: grid; gap: 4px; }
.led .label { color: var(--red); }
.led b { font: 600 clamp(28px, 3.6vw, 42px)/1 var(--mono); color: #8BFFB4; text-shadow: 0 0 16px rgba(52, 199, 116, .55); font-variant-numeric: tabular-nums; }
.led small { color: var(--dim); font-size: 13px; }
nav { display: flex; flex-wrap: wrap; gap: 10px; margin: 22px 0 20px; }
nav button { min-height: 42px; padding: 0 16px; border-radius: 999px; border: 2px solid var(--rule-d); background: transparent; color: var(--cream); font: 700 14px/1 var(--head); cursor: pointer; }
nav button.on { background: var(--cream); color: var(--ink); border-color: var(--cream); }
nav .count { font: 600 12px/1 var(--mono); margin-left: 6px; opacity: .7; }
main { padding-bottom: 72px; }
section { display: none; } section.on { display: block; }
.card { background: var(--paper); color: var(--ink); border: 3px solid var(--ink); outline: 3px solid var(--paper); border-radius: 12px; padding: 16px 18px; margin: 0 0 22px; box-shadow: 7px 8px 0 var(--shade, var(--ink-3)); }
.card.g-accepted { --shade: var(--green); } .card.g-declined { --shade: var(--amber); } .card.g-staff { --shade: var(--blue); } .card.g-error { --shade: var(--violet); } .card.urgent { --shade: var(--red); border-color: var(--red-p); }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.spacer { flex: 1; }
.who { font: 800 17px/1.2 var(--head); }
.meta { font: 600 12px/1.4 var(--mono); color: var(--pdim); letter-spacing: .04em; }
.live { color: var(--green-p); }
.stamp { display: inline-block; font: 700 11px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; padding: 5px 8px; border: 2px solid currentColor; border-radius: 5px; white-space: nowrap; color: var(--pdim); }
.stamp.big { transform: rotate(-3deg); }
.ACCEPTED, .QA_PASS, .DONE { color: var(--green-p); }
.ACCEPTED_COPAY_UNCONFIRMED, .COVERAGE_UNCONFIRMED, .CALLBACK_CREATED, .NEED_INFO, .STARTED { color: var(--blue-p); }
.NOT_IN_NETWORK, .COVERAGE_INACTIVE, .DENTAL_PLAN, .VISION_PLAN, .WHICH_INSURANCE, .UNKNOWN_INSURANCE { color: var(--amber-p); }
.PLEASE_VERIFY_DETAILS, .PAYER_UNAVAILABLE, .CLINIC_SETUP_ISSUE, .TOOL_ERROR { color: var(--violet-p); }
.URGENT, .QA_FAIL { color: var(--red-p); }
.said { margin: 12px 0 0; padding: 12px 14px; background: var(--paper-2); border-radius: 8px; font-size: 16.5px; }
.said .label { display: block; color: var(--pdim); margin-bottom: 4px; }
.summary { margin: 10px 0 0; font-size: 15px; color: var(--pdim); }
.timeline { margin: 12px 0 0; padding: 0; list-style: none; border-top: 2px dashed #B9AE95; }
.timeline li { padding: 9px 0; border-bottom: 1px solid #DED3BA; font: 600 12.5px/1.5 var(--mono); }
.timeline li:last-child { border-bottom: 0; }
.timeline .t { color: var(--pdim); }
.timeline .ms { color: var(--pdim); }
.note { display: inline-block; margin-left: 6px; padding: 2px 7px; border-radius: 5px; background: #DDF3E5; color: var(--green-p); }
.note.heard { background: #E3E8FB; color: var(--blue-p); }
details summary { cursor: pointer; color: var(--pdim); font: 600 11px/1.6 var(--mono); letter-spacing: .12em; text-transform: uppercase; margin-top: 8px; }
pre { white-space: pre-wrap; word-break: break-word; background: var(--paper-2); color: var(--ink); padding: 10px 12px; border-radius: 8px; font: 12.5px/1.5 var(--mono); margin: 8px 0 0; max-height: 360px; overflow: auto; }
.empty { border: 2px dashed var(--rule-d); border-radius: 14px; padding: 48px 20px; text-align: center; color: var(--dim); }
.empty b { display: block; font: 800 22px/1.2 var(--head); color: var(--cream); margin-bottom: 6px; }
.btn { font: 700 12px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; padding: 10px 14px; min-height: 38px; border-radius: 999px; border: 2px solid var(--ink); background: transparent; color: var(--ink); cursor: pointer; }
.btn.hot { background: var(--red); border-color: var(--red); color: var(--ink); box-shadow: 3px 4px 0 var(--cream); }
.btn:disabled { opacity: .5; cursor: progress; }
.table-card { padding: 0; overflow: hidden; }
.table-head { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; padding: 16px 18px; border-bottom: 3px double var(--ink); }
.table-head b { font: 800 17px/1.3 var(--head); }
.table-head .meta { margin-top: 2px; }
.check { display: inline-flex; align-items: center; gap: 8px; font: 600 12px/1 var(--mono); color: var(--pdim); letter-spacing: .06em; text-transform: uppercase; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 12px 18px; border-top: 1px solid #DED3BA; vertical-align: top; }
th { font: 600 11px/1.3 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--pdim); border-top: 0; }
td.result { width: 46%; }
td .said { margin-top: 8px; font-size: 15px; }
.tally { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; border-bottom: 3px double var(--ink); }
.tally div { padding: 12px 18px; border-right: 1px solid #DED3BA; }
.tally div:last-child { border-right: 0; }
.tally b { display: block; font: 800 26px/1.1 var(--head); }
.tally:empty { display: none; }
@media (max-width: 820px) {
  .leds, .tally { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  td.result { width: auto; }
  .hide-sm { display: none; }
  th, td { padding: 10px 12px; }
}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <div class="brand">
      <span class="mark" aria-hidden="true">E</span>
      <div><h1>Front desk</h1><div class="label">${clinic.name} · ${clinic.agentName}, the insurance line</div></div>
    </div>
    <div class="head-right">
      <span class="listening label"><i></i>Listening</span>
      ${phone ? `<a class="phone" href="tel:${phone}">${formatPhone(phone)}</a>` : ''}
    </div>
  </div>
</header>
<main class="wrap">
  <div class="leds" aria-live="polite">
    <div class="led"><span class="label">Calls</span><b id="s-calls">0</b><small>since the server started</small></div>
    <div class="led"><span class="label">Answered by ${clinic.agentName}</span><b id="s-solo">0</b><small>no staff needed</small></div>
    <div class="led"><span class="label">Callbacks open</span><b id="s-cb">0</b><small id="s-urgent">none urgent</small></div>
    <div class="led"><span class="label">Wait on the insurer</span><b id="s-wait">–</b><small>average, after the card is read</small></div>
  </div>
  <nav>
    <button data-tab="calls" class="on">Calls<span class="count" id="n-calls">0</span></button>
    <button data-tab="callbacks">Callback queue<span class="count" id="n-cb">0</span></button>
    <button data-tab="scenarios">Patient scenarios<span class="count">${scenarios.length}</span></button>
  </nav>
  <section id="calls" class="on"><div id="calls-list"><div class="empty"><b>No calls yet</b>Call ${phone ? formatPhone(phone) : 'the line'} and watch it appear here, step by step, as it happens.</div></div></section>
  <section id="callbacks"><div id="cb-list"></div></section>
  <section id="scenarios">
    <div class="card table-card">
      <div class="table-head">
        <div><b>Every preset patient, through the same pipeline the phone agent uses</b><div class="meta">Live Stedi sandbox checks. The right column is the exact sentence the caller would hear.</div></div>
        <span class="spacer"></span>
        <label class="check"><input type="checkbox" id="routine" /> Routine eye exam</label>
        <button class="btn hot" id="run-all">Run all</button>
      </div>
      <div class="tally" id="stats"></div>
      <table>
        <thead><tr><th>Patient</th><th class="hide-sm">Card</th><th class="hide-sm">Scenario</th><th class="result">What ${clinic.agentName} says</th></tr></thead>
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
const GROUP = { ACCEPTED: 'accepted', NOT_IN_NETWORK: 'declined', COVERAGE_INACTIVE: 'declined', DENTAL_PLAN: 'declined', VISION_PLAN: 'declined', ACCEPTED_COPAY_UNCONFIRMED: 'staff', COVERAGE_UNCONFIRMED: 'staff', PLEASE_VERIFY_DETAILS: 'error', PAYER_UNAVAILABLE: 'error', CLINIC_SETUP_ISSUE: 'error' };
const stamp = (o, big) => '<span class="stamp ' + (big ? 'big ' : '') + esc(o) + '">' + esc(label(o)) + '</span>';

document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button, section').forEach((el) => el.classList.remove('on'));
  b.classList.add('on'); document.getElementById(b.dataset.tab).classList.add('on');
});

function renderStats(calls, cbs) {
  const real = calls.filter((c) => c.source !== 'dashboard');
  const lastCheck = (c) => [...c.events].reverse().find((e) => e.tool === 'check_insurance');
  const callbackOn = (c) => c.events.some((e) => e.tool === 'request_callback');
  const solo = real.filter((c) => { const l = lastCheck(c); return l && ['accepted', 'declined'].includes(GROUP[l.outcome]) && !callbackOn(c); }).length;
  const waits = real.flatMap((c) => c.events.filter((e) => e.tool === 'check_insurance' && e.detail && typeof e.detail.waitedMs === 'number').map((e) => e.detail.waitedMs));
  const open = cbs.filter((c) => c.status === 'open');
  const urgent = open.filter((c) => c.urgent).length;
  document.getElementById('s-calls').textContent = real.length;
  document.getElementById('s-solo').textContent = solo;
  document.getElementById('s-cb').textContent = open.length;
  document.getElementById('s-urgent').textContent = urgent ? urgent + ' urgent: call today' : 'none urgent';
  document.getElementById('s-wait').textContent = waits.length ? (waits.reduce((a, b) => a + b, 0) / waits.length / 1000).toFixed(2) + ' s' : '–';
}

function renderCalls(calls) {
  const real = calls.filter((c) => c.source !== 'dashboard');
  document.getElementById('n-calls').textContent = real.length;
  if (!real.length) return;
  document.getElementById('calls-list').innerHTML = real.map((c) => {
    const last = [...c.events].reverse().find((e) => e.tool === 'check_insurance');
    return '<div class="card' + (last ? ' g-' + (GROUP[last.outcome] || 'staff') : '') + '">' +
      '<div class="row"><span class="who">' + esc(c.source === 'phone' ? (c.callerNumber || 'Phone call') : c.source + ' call') + '</span>' +
      '<span class="meta">' + time(c.startedAt) + (c.durationSeconds ? ' · ' + Math.round(c.durationSeconds) + ' s' : '') + (c.endedAt ? '' : ' · <b class="live">LIVE</b>') + '</span>' +
      '<span class="spacer"></span>' + (c.qaPassed === undefined ? '' : '<span class="stamp ' + (c.qaPassed ? 'QA_PASS">QA pass' : 'QA_FAIL">QA fail') + '</span>') +
      (last ? stamp(last.outcome, true) : '') + '</div>' +
      (last && last.say ? '<div class="said"><span class="label">${clinic.agentName} said</span>' + esc(last.say) + '</div>' : '') +
      (c.summary ? '<p class="summary">' + esc(c.summary) + '</p>' : '') +
      '<ul class="timeline">' + c.events.map((e) =>
        '<li><span class="t">' + time(e.at) + '</span> · ' + esc(e.tool) + ' ' + stamp(e.outcome) + ' <span class="ms">' + e.ms + ' ms</span>' + eventNote(e) +
        '<details><summary>Details</summary><pre>' + esc(JSON.stringify({ args: e.args, detail: e.detail }, null, 2)) + '</pre></details></li>').join('') + '</ul>' +
      (c.qa ? '<details><summary>QA fields</summary><pre>' + esc(JSON.stringify(c.qa, null, 2)) + '</pre></details>' : '') +
      (c.transcript ? '<details><summary>Transcript</summary><pre>' + esc(c.transcript) + '</pre></details>' : '') +
      (c.recordingUrl ? '<details><summary>Recording</summary><p class="meta"><a href="' + esc(c.recordingUrl) + '" target="_blank" rel="noopener">Open the recording</a></p></details>' : '') +
    '</div>';
  }).join('');
}

// What made this step fast or forgiving: the payer answer was already in hand, or a misheard ID was matched to the chart.
function eventNote(e) {
  const d = e.detail || {};
  let note = '';
  if (d.prefetched) note += '<span class="note">pre-checked · caller waited ' + d.waitedMs + ' ms</span>';
  if (d.memberIdHeardAs) note += '<span class="note heard">heard ' + esc(d.memberIdHeardAs) + ', matched the card on file</span>';
  return note;
}

function renderCallbacks(cbs) {
  const open = cbs.filter((c) => c.status === 'open');
  document.getElementById('n-cb').textContent = open.length;
  document.getElementById('cb-list').innerHTML = cbs.length ? cbs.map((c) =>
    '<div class="card' + (c.urgent && c.status === 'open' ? ' urgent' : '') + '"><div class="row">' + (c.urgent ? '<span class="stamp big URGENT">Urgent · call today</span>' : '') + '<span class="who">' + esc(c.callerName) + '</span><span class="meta">' + esc(c.phone || 'no number') + ' · ' + time(c.at) + '</span>' +
    '<span class="spacer"></span>' +
    (c.status === 'open' ? '<button class="btn" onclick="done(\\'' + c.id + '\\')">Mark done</button>' : '<span class="stamp DONE">Done</span>') +
    '</div><div class="said"><span class="label">Reason</span>' + esc(c.reason) + '</div></div>').join('') : '<div class="empty"><b>Queue is clear</b>When ${clinic.agentName} can’t give a confident answer, the caller lands here with the reason.</div>';
}

async function done(id) { await fetch(q('/api/callbacks/' + id + '/done'), { method: 'POST' }); refresh(); }

async function refresh() {
  try {
    const r = await fetch(q('/api/state'));
    if (!r.ok) return;
    const s = await r.json();
    renderStats(s.calls, s.callbacks); renderCalls(s.calls); renderCallbacks(s.callbacks);
  } catch {}
}

const results = {};
function renderScenarios() {
  document.getElementById('scenario-rows').innerHTML = SCENARIOS.map((s) => {
    const r = results[s.id];
    return '<tr><td><span class="who" style="font-size:15px">' + esc(s.name) + '</span><div class="meta">DOB ' + esc(s.dob) + '</div></td>' +
      '<td class="hide-sm">' + esc(s.payer) + '<div class="meta">' + esc(s.memberId) + '</div></td>' +
      '<td class="hide-sm" style="font-size:14px">' + esc(s.scenario) + '</td>' +
      '<td class="result">' + (r ? (r.loading ? '<span class="meta">Asking the insurer…</span>' :
        stamp(r.answer.outcome) + ' <span class="meta">' + (r.audit.ms ?? '') + (r.audit.ms ? ' ms' : '') + '</span>' +
        '<div class="said">' + esc(r.answer.say) + '</div>' +
        '<details><summary>Facts and payer request</summary><pre>' + esc(JSON.stringify({ facts: r.answer.facts, next_step: r.answer.next_step, stediCheckId: r.audit.stediCheckId, interpreted: r.audit.facts, request: r.audit.request }, null, 2)) + '</pre></details>')
        : '<button class="btn" onclick="runOne(\\'' + s.id + '\\')">Run check</button>') + '</td></tr>';
  }).join('');
  const finished = Object.values(results).filter((r) => r && !r.loading);
  const by = (g) => finished.filter((r) => GROUP[r.answer.outcome] === g).length;
  document.getElementById('stats').innerHTML = finished.length ? [
    ['Checked', finished.length], ['Accepted', by('accepted')], ['Not accepted', by('declined')], ['Sent to staff safely', by('staff') + by('error')],
  ].map(([k, v]) => '<div><span class="meta">' + k + '</span><b>' + v + '</b></div>').join('') : '';
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
