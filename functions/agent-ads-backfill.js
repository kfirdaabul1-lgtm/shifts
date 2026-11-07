// ================= Paid-ads agent: one-off historical weekly reports (owner, Nov 7: "reports for every week since the start of September") =================
// Separate from agent-ads.js (that file is maintained in the project). Uses its exported helpers (_t) and writes the same
// adReports/weekly_{scope}_{week} documents, marked backfill:true. Triggered by an admin script creating adsJobs/{id}:
//   {kind:'meta', since}  - pull Meta campaign insights from `since` (the normal sync keeps only the last 35 days)
//   {kind:'week', week}   - write the weekly report of that week (Sunday) for the chain and every hotel
// Runs inside the function (it has the Claude key); clients cannot write adsJobs (rules: no match = denied).
const C = require('./agent-common');
const A = require('./agent-ads.js')._t;
const { db } = C;
const SMART = 'claude-sonnet-5-5';
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

const SAVE = { name: 'save_report', description: 'Save the report the manager will read. Call it ONCE, at the end.',
  input_schema: { type: 'object', properties: {
    headline: { type: 'string', description: 'one line (Hebrew, max 140 chars): the single most important thing' },
    summary: { type: 'string', description: '3-6 short sentences: what happened, with numbers' },
    highlights: { type: 'array', description: 'up to 6 campaigns worth a look', items: { type: 'object', properties: { campaign: { type: 'string' }, status: { type: 'string', enum: ['good', 'watch', 'bad'] }, note: { type: 'string' } }, required: ['campaign', 'status', 'note'] } },
    directions: { type: 'array', description: 'up to 3 directions that would have made sense for the next week, ranked', items: { type: 'object', properties: { title: { type: 'string' }, why: { type: 'string' }, action: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['title', 'why', 'action'] } },
    caveats: { type: 'string', description: 'data limits' } }, required: ['headline', 'summary'] } };

async function weekScope(scope, week, cfg) {
  const end = C.addDays(week, 6), asOf = C.addDays(week, 7), realToday = C.ilDate(new Date());
  const M = await A.metricsOf(scope, asOf);
  if (!(M.lastWeek && (M.lastWeek.n || M.lastWeek.spend)) && !M.hasData) return { scope: scope.key, skipped: 'no data' };
  if (!M.lastWeek.n && !M.lastWeek.spend) return { scope: scope.key, skipped: 'no campaigns that week' };
  let saved = null;
  const tools = [...A.readTools(scope), { ...SAVE, run: async (a) => { saved = A.cleanReport(a || {}); return { saved: true }; } }];
  const sys = A.system(await C.loadKB('ads'), scope, 'weekly').map((b) => ({ ...b, text: b.text.replace(/Today is \d{4}-\d{2}-\d{2}\./, `This is a HISTORICAL weekly report (written on ${realToday} for the week ${week} to ${end}). Write it as it would have been written on ${asOf}.`) }));
  const ctx = `Weekly report for the week ${week} to ${end} (Sunday to Saturday), compared with the weeks before it. This is a catch-up report written later (${realToday}).
Use ONLY data up to ${end}: always pass from/to to campaign_totals and leads_funnel (to=${end}); campaign_weeks counts back from today, so ignore its rows after ${end}.
Lead stages are as of today, so won/lost for this week may include deals closed after it — mention that once in caveats.
In METRICS, "lastWeek" is the report week; "thisWeek" is the week after it (ignore it).`;
  const model = cfg.model || SMART;
  const out = await C.runLoop({ model, system: sys, tools, messages: [{ role: 'user', content: ctx + '\n\nMETRICS (computed by the system):\n' + JSON.stringify(M) }], maxTurns: 10, maxTokens: 1500 });
  if (!saved) { const t = String(out.text || '').trim(); if (!t) { await C.logRun('ads', { scope: scope.key, kind: 'weekly-backfill', week, model, usage: out.U, error: 'no report' }); return { scope: scope.key, skipped: 'no report' }; } saved = A.cleanReport({ headline: t.split('\n')[0], summary: t }); }
  const id = 'weekly_' + scope.key + '_' + week;
  await db.doc('adReports/' + id).set({ kind: 'weekly', hotel: scope.hotel, scopeKey: scope.key, scopeName: scope.name, date: asOf, week, ...saved,
    metrics: { thisWeek: M.thisWeek, lastWeek: M.lastWeek, prevWeek: (M.last4Weeks || [])[1] || null, dayOfWeek: M.dayOfWeek, crm90d: M.crm90d }, at: Date.now(), model, by: 'ai', backfill: true });
  await C.logRun('ads', { scope: scope.key, kind: 'weekly-backfill', week, model, usage: out.U, tools: out.used, report: id });
  return { scope: scope.key, report: id, usage: out.U };
}

async function runWeek(week) {
  const cfg = await C.cfg('ads');
  const res = [];
  for (const s of await A.scopeList(cfg)) {
    try { res.push(await weekScope(s, week, cfg)); }
    catch (e) { console.error('ads backfill', week, s.key, e); res.push({ scope: s.key, error: clip(e.message || e, 200) }); }
  }
  return res;
}
module.exports = { runWeek };
