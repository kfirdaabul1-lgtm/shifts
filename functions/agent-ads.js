// ================= Paid-advertising agent: daily analysis + weekly report, per hotel and for the chain (owner, Nov 7) =================
// STATUS: connected to functions/index.js (Nov 7). The scheduled reports do nothing until agentcfg/ads.enabled === true.
// Also reads metaStruct (campaign structure, written daily by meta-struct.js) and adNotes (managers' directions).
//
// READ ONLY. The agent reads the campaign rows the Meta sync already writes (collection `campaigns`) and the CRM leads
// (collection `leads`), and writes REPORTS for managers to READ in the app (collection `adReports`). It cannot change a campaign,
// a budget or a bid: it has no tool for it, and the Meta token the app holds (ads_read) could not do it either.
//
// Who gets which report (one run per scope):
//   chain scope (hotel '')   - all data; read by the owner, the CEO and marketing holders who see every hotel
//   hotel scope (hotel 'h1') - only the campaigns and leads that belong to that hotel; read by that hotel's manager. EVERY hotel gets one
//   (also one with no event venues, e.g. a hostel that advertises rooms or hiring). Which hotel a campaign / lead belongs to is decided by, in order:
//     1. a hotel field on the document, 2. the Meta connection (agentcfg/ads.hotelOf {connectionId or connection name: hotelId}),
//     3. the venue (settings/{hotel}.venues), 4. the hotel's name inside the connection / campaign name, 5. (leads) the campaign it came from.
//   Anything that matches no hotel appears in the chain report only. The chain report always has everything.
//
// Schedule (Israel time):
//   adsDaily  07:00 every day except Sunday - a short analysis: what changed, what needs attention
//   adsWeekly 08:00 on Sunday               - the weekly campaign report for the week that just ended, with the directions the agent suggests
// The daily run skips a scope when the numbers have not changed since the last analysis (saves tokens), but never for more than 3 days.
// Manual run (owner only): POST adsRunNow {kind: 'daily' | 'weekly'}; chat with the data: POST adsAgent {messages, hotel} (managers by scope, Haiku).
//
// Reports are documents adReports/{kind}_{scope}_{date|week}: {kind, hotel, scopeName, date, week, headline, summary, highlights[],
// directions[], caveats, metrics, at, model, by:'ai'}. The numbers in `metrics` are computed by this code, not by the model.
const functions = require('firebase-functions/v1');
const crypto = require('crypto');
const C = require('./agent-common');
const { db } = C;
const REGION = 'europe-west1';
const SMART = 'claude-sonnet-5-5';
const DEFAULTS = { enabled: false, model: '', daily: true, weekly: true, rateHour: 30, keepDailyDays: 45, skipMaxDays: 3 };
const r2 = (x) => Math.round(x * 100) / 100;
const div = (a, b) => (b > 0 ? r2(a / b) : null);
const isSunday = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay() === 0;

// ---------- scopes: the chain, and every hotel ----------
const norm = (x) => String(x || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9֐-׿]+/g, '');
// which hotel does a campaign / lead belong to (see the header for the order)
async function attribution(cfg) {
  const [hs, ss, cs] = await Promise.all([db.collection('hotels').get(), db.collection('settings').get(), db.collection('campaigns').get()]);
  const hotels = hs.docs.map((d) => ({ id: d.id, name: (d.data() || {}).name || d.id, key: norm((d.data() || {}).name || d.id) })), ids = new Set(hotels.map((h) => h.id));
  const venueHotel = {}; ss.docs.forEach((d) => { const v = (d.data() || {}).venues; if (ids.has(d.id) && Array.isArray(v)) v.forEach((x) => { if (x && !venueHotel[x]) venueHotel[x] = d.id; }); });
  const conf = {}; Object.entries(cfg.hotelOf || {}).forEach(([k, v]) => { if (ids.has(v)) conf[norm(k)] = v; });
  const byConn = (id, name) => conf[norm(id)] || conf[norm(name)] || '';
  const byText = (t) => { const n = norm(t), hit = hotels.filter((h) => h.key.length >= 3 && n.includes(h.key)); return hit.length === 1 ? hit[0].id : ''; };
  const ok = (h) => (ids.has(h) ? h : '');
  const camp = (c) => ok(c.hotel) || byConn(c.metaConn, c.metaConnName) || venueHotel[c.venue] || byText((c.metaConnName || '') + ' ' + (c.name || '')) || '';
  const byName = {}; cs.docs.forEach((d) => { const c = d.data() || {}, n = String(c.name || '').trim(), h = camp(c); if (n && h && !byName[n]) byName[n] = h; });
  const lead = (l) => ok(l.hotel) || byConn(l.metaConn, l.metaConnName) || venueHotel[l.venue] || byName[String(l.campaign || '').trim()] || byText(l.campaign) || '';
  return { hotels, camp, lead };
}
async function scopeList(cfg) {
  const A = await attribution(cfg || {});
  return [{ key: 'chain', hotel: '', name: 'כל הרשת', A: null }, ...A.hotels.map((h) => ({ key: h.id, hotel: h.id, name: h.name, A }))];
}
const inScope = (scope, kind, item) => !scope.A || scope.A[kind](item) === scope.hotel;

// ---------- data (always through a scope) ----------
async function campRows(scope, from, to) {
  const w0 = C.weekOf(from), snap = await db.collection('campaigns').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => inScope(scope, 'camp', c))
    .map((c) => ({ ...c, week: c.week || C.weekOf(c.start || C.ilDate(new Date())) })).filter((c) => c.week >= w0 && c.week <= to);
}
async function leadsIn(scope, from, to) {
  const t0 = Date.parse(from + 'T00:00:00+02:00'), t1 = Date.parse(to + 'T23:59:59+02:00');
  return (await db.collection('leads').get()).docs.map((d) => d.data()).filter((l) => inScope(scope, 'lead', l) && (+l.createdAt || 0) >= t0 && (+l.createdAt || 0) <= t1);
}
const rowOut = (c) => ({ week: c.week, name: c.name || '', platform: c.platform || '', spend: r2(+c.spend || 0), leads: +c.leads || 0, conversations: +c.msgs || 0, impressions: +c.impressions || 0, clicks: +c.clicks || 0, ctrPct: c.impressions ? r2((+c.clicks || 0) / c.impressions * 100) : null, cpl: div(+c.spend || 0, (+c.leads || 0)), revenue: +c.revenue || 0, cplMax: +c.cplMax || null, source: c.auto === 'meta' ? 'meta-sync' : 'manual' });
const range = (a) => { const to = C.isoOk(a.to) ? a.to : C.ilDate(new Date()); const from = C.isoOk(a.from) ? a.from : C.addDays(to, -28); return { from, to }; };
const sumWeek = (rows, w) => { const x = rows.filter((c) => c.week === w).reduce((t, c) => ({ n: t.n + 1, spend: t.spend + (+c.spend || 0), leads: t.leads + (+c.leads || 0), conversations: t.conversations + (+c.msgs || 0), clicks: t.clicks + (+c.clicks || 0), impressions: t.impressions + (+c.impressions || 0) }), { n: 0, spend: 0, leads: 0, conversations: 0, clicks: 0, impressions: 0 }); return { ...x, spend: r2(x.spend), cpl: div(x.spend, x.leads) }; };

// the numbers of a report, computed here (the model explains them, it does not calculate them)
async function metricsOf(scope, today) {
  const wk = C.weekOf(today), dow = new Date(today + 'T12:00:00Z').getUTCDay() + 1; // day of the week 1..7
  const rows = await campRows(scope, C.addDays(wk, -35), today), leads = await leadsIn(scope, C.addDays(today, -90), today);
  const fun = leads.reduce((t, l) => ({ leads: t.leads + 1, won: t.won + (l.stage === 'won' ? 1 : 0), lost: t.lost + (l.stage === 'lost' ? 1 : 0), revenue: t.revenue + (l.stage === 'won' ? +l.wonValue || 0 : 0) }), { leads: 0, won: 0, lost: 0, revenue: 0 });
  const last4 = [1, 2, 3, 4].map((i) => sumWeek(rows, C.addDays(wk, -7 * i)));
  return { today, weekStart: wk, dayOfWeek: dow, note: 'thisWeek is partial (dayOfWeek of 7 days so far); lastWeek and last4Weeks are complete weeks', thisWeek: sumWeek(rows, wk), lastWeek: last4[0], last4Weeks: last4, crm90d: { ...fun, revenue: Math.round(fun.revenue) }, hasData: rows.length > 0 || leads.length > 0 };
}

// ---------- tools (read-only; the scope is baked in, so a hotel report can never see another hotel) ----------
function readTools(scope) {
  return [
    { name: 'campaign_weeks', description: 'Weekly campaign rows (Meta sync + manual reports): spend ₪, leads, conversations started, impressions, clicks, CTR, cost per lead, revenue. Default: last 4 weeks.',
      input_schema: { type: 'object', properties: { weeks: { type: 'number', description: 'how many weeks back, default 4, max 26' }, platform: { type: 'string', description: 'meta | google | tiktok | other' } } },
      run: async (a) => { const n = Math.min(26, Math.max(1, +a.weeks || 4)), to = C.ilDate(new Date()), from = C.addDays(to, -7 * n);
        let rows = await campRows(scope, from, to); if (a.platform) rows = rows.filter((c) => c.platform === a.platform);
        return { scope: scope.name, from, to, rows: rows.sort((x, y) => y.week.localeCompare(x.week) || (y.spend || 0) - (x.spend || 0)).slice(0, 150).map(rowOut) }; } },

    { name: 'campaign_totals', description: 'Campaign totals for a date range (default last 28 days): spend, leads, conversations, clicks, CTR, cost per lead, over/under the cost-per-lead limit.',
      input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } } },
      run: async (a) => { const { from, to } = range(a), g = {}, lim = ((await db.doc('mktcfg/main').get()).data() || {}).cplMax || 0;
        for (const c of await campRows(scope, from, to)) { const k = (c.name || '?') + '|' + (c.platform || ''), x = g[k] = g[k] || { name: c.name || '?', platform: c.platform || '', spend: 0, leads: 0, conversations: 0, impressions: 0, clicks: 0, revenue: 0, weeks: 0, cplMax: +c.cplMax || +lim || 0 };
          x.spend += +c.spend || 0; x.leads += +c.leads || 0; x.conversations += +c.msgs || 0; x.impressions += +c.impressions || 0; x.clicks += +c.clicks || 0; x.revenue += +c.revenue || 0; x.weeks++; }
        const rows = Object.values(g).map((x) => ({ ...x, spend: r2(x.spend), ctrPct: x.impressions ? r2(x.clicks / x.impressions * 100) : null, cpl: div(x.spend, x.leads), overCplLimit: !!x.cplMax && x.spend > 0 && (x.leads ? x.spend / x.leads > x.cplMax : true) })).sort((x, y) => y.spend - x.spend);
        const T = rows.reduce((t, x) => ({ spend: t.spend + x.spend, leads: t.leads + x.leads, conversations: t.conversations + x.conversations }), { spend: 0, leads: 0, conversations: 0 });
        return { scope: scope.name, from, to, defaultCplLimit: +lim || null, total: { ...T, spend: r2(T.spend), cpl: div(T.spend, T.leads) }, campaigns: rows.slice(0, 60) }; } },

    { name: 'leads_funnel', description: 'What the leads really became (CRM), grouped by campaign (default), source, venue or kind. Counts: leads, open, won, lost, junk; won revenue (₪ before VAT), win rate, average days to close; for campaigns also spend, cost per lead, cost per won event and ROI.',
      input_schema: { type: 'object', properties: { group: { type: 'string', enum: ['campaign', 'source', 'venue', 'kind'] }, from: { type: 'string' }, to: { type: 'string' } } },
      run: async (a) => { const { from, to } = range(a), grp = ['source', 'venue', 'kind'].includes(a.group) ? a.group : 'campaign', ls = await leadsIn(scope, from, to), g = {}, lost = {};
        for (const l of ls) { const k = grp === 'campaign' ? (l.campaign || '· ' + (l.source || 'no source')) : grp === 'source' ? (l.source || 'none') : grp === 'venue' ? (l.venue || 'none') : (l.cat || 'events');
          const x = g[k] = g[k] || { n: 0, open: 0, won: 0, lost: 0, junk: 0, revenue: 0, days: 0 };
          x.n++; if (l.stage === 'won') { x.won++; x.revenue += +l.wonValue || 0; if (l.wonAt && l.createdAt) x.days += (l.wonAt - l.createdAt) / 864e5; } else if (l.stage === 'lost') { x.lost++; const why = l.lostReason || 'not given'; lost[why] = (lost[why] || 0) + 1; } else if (l.stage === 'junk') x.junk++; else x.open++; }
        const spend = {}; if (grp === 'campaign') for (const c of await campRows(scope, from, to)) { const n = String(c.name || '').trim(); if (n) spend[n] = (spend[n] || 0) + (+c.spend || 0); }
        const rows = Object.entries(g).map(([k, x]) => { const sp = spend[k] || 0; return { group: k, leads: x.n, open: x.open, won: x.won, lost: x.lost, junk: x.junk, winRatePct: x.won + x.lost ? Math.round(x.won / (x.won + x.lost) * 100) : null, revenue: Math.round(x.revenue), avgDaysToClose: x.won ? r2(x.days / x.won) : null, ...(grp === 'campaign' ? { spend: r2(sp), costPerLead: div(sp, x.n), costPerWon: div(sp, x.won), roi: sp ? r2(x.revenue / sp) : null } : {}) }; }).sort((x, y) => y.revenue - x.revenue || y.leads - x.leads);
        return { scope: scope.name, from, to, group: grp, note: 'Leads are counted by creation date; revenue is booked on the lead (stage won). Thin samples (<10 leads or <3 won) prove nothing.', rows: rows.slice(0, 60), lostReasons: lost }; } },

    { name: 'campaign_structure', description: 'How the Meta campaigns are BUILT (read once a day from Meta, last 28 days): objective, budget, bid; ad sets with optimisation goal and audience (ages, genders, places, interests, custom audiences, placements); ads with format, headline, text, button and each ad\'s numbers; numbers split by age+gender and by placement. Without "campaign": a short overview of every campaign. With "campaign" (part of the name): the full detail of the matching campaigns.',
      input_schema: { type: 'object', properties: { campaign: { type: 'string', description: 'part of the campaign name; empty = overview of all' } } },
      run: async (a) => {
        const cut = Date.now() - 4 * 864e5, q = String(a.campaign || '').trim().toLowerCase();
        const all = (await db.collection('metaStruct').get()).docs.map((d) => d.data()).filter((c) => (+c.at || 0) > cut && inScope(scope, 'camp', c));
        if (!all.length) return { scope: scope.name, note: 'No campaign structure was read from Meta yet for this scope (it is read once a day at 05:30).' };
        if (!q) return { scope: scope.name, readAt: new Date(Math.max(...all.map((c) => +c.at || 0))).toISOString().slice(0, 10), campaigns: all.sort((x, y) => ((y.last28 || {}).spend || 0) - ((x.last28 || {}).spend || 0)).slice(0, 40).map((c) => ({ name: c.name, ...c.campaign, last28: c.last28, adsets: (c.adsets || []).length, ads: (c.ads || []).length,
          audience: (c.adsets || []).slice(0, 2).map((x) => ({ ages: x.audience && x.audience.ages, genders: x.audience && x.audience.genders, places: x.audience && (x.audience.places || []).slice(0, 4), interests: x.audience && (x.audience.interests || []).slice(0, 5), placements: x.audience && x.audience.placements })),
          formats: [...new Set((c.ads || []).map((x) => x.format))] })) };
        const hit = all.filter((c) => String(c.name || '').toLowerCase().includes(q)).slice(0, 3);
        if (!hit.length) return { scope: scope.name, error: 'no campaign name contains that text', names: all.map((c) => c.name).slice(0, 60) };
        return { scope: scope.name, campaigns: hit.map((c) => ({ name: c.name, ...c.campaign, last28: c.last28, adsets: c.adsets, ads: c.ads, byAgeGender: c.byAgeGender, byPlacement: c.byPlacement })) };
      } },

    { name: 'agency_changes', description: 'What the social media agency (or anyone) CHANGED in the Meta ad accounts in the last 21 days, from Meta\'s activity log: new / paused / edited campaigns, ad sets and ads, budget and bid changes, audience/targeting edits, with who and when. Use it to judge the agency\'s work (what they did, how often, whether it made sense against the numbers). Optional "campaign" = part of a campaign / ad set / ad name.',
      input_schema: { type: 'object', properties: { campaign: { type: 'string' } } },
      run: async (a) => {
        const q = String(a.campaign || '').trim().toLowerCase(), cut = Date.now() - 4 * 864e5;
        const docs = (await db.collection('metaActs').get()).docs.map((d) => d.data()).filter((d) => (+d.at || 0) > cut);
        if (!docs.length) return { scope: scope.name, note: 'The change log was not read from Meta yet (it is read once a day at 05:30), or the token has no access to it.' };
        // scope: only objects that belong to this scope's campaigns (by name), or everything for the chain
        const names = scope.A ? new Set((await db.collection('metaStruct').get()).docs.map((d) => d.data()).filter((c) => inScope(scope, 'camp', c)).flatMap((c) => [c.name, ...(c.adsets || []).map((x) => x.name), ...(c.ads || []).map((x) => x.name)]).filter(Boolean)) : null;
        const items = docs.flatMap((d) => d.items || []).filter((x) => (!names || names.has(x.obj)) && (!q || String(x.obj).toLowerCase().includes(q)))
          .sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 120);
        return { scope: scope.name, count: items.length, changes: items };
      } },
  ];
}

// ---------- managers' directions (adNotes {hotel ('' = whole chain), text, by, byName, at}) ----------
async function notesFor(scope) {
  const hs = scope.hotel ? [scope.hotel, ''] : [''];
  const q = await Promise.all(hs.map((h) => db.collection('adNotes').where('hotel', '==', h).get()));
  return q.flatMap((x) => x.docs.map((d) => d.data())).sort((a, b) => (+b.at || 0) - (+a.at || 0)).slice(0, 25)
    .map((n) => ({ date: C.ilDate(new Date(+n.at || Date.now())), by: clip(n.byName, 40), forWhole: n.hotel ? 'this hotel' : 'whole chain', text: clip(n.text, 400) }));
}
const notesTxt = (ns) => ns.length ? '\n\nMANAGERS\' DIRECTIONS (newest first). Follow them; when two conflict follow the newest and say so in caveats. In the report, say briefly how you took them into account:\n' + JSON.stringify(ns) : '';

// ---------- prompts ----------
// the agency-review checklist is always included (agentKB/ads in Firestore may replace kb/ads.md, but not this)
let AUDIT_KB = ''; try { AUDIT_KB = '\n\nCHECKLIST FOR REVIEWING THE AGENCY (Meta best practice, use it for verdicts):\n' + require('fs').readFileSync(require('path').join(__dirname, 'kb', 'ads-audit.md'), 'utf8').slice(0, 12000); } catch (e) { }
function system(kb, scope, kind) {
  const who = scope.hotel ? `the manager of ${scope.name}` : 'the chain management (owner / CEO)';
  const rules = `Your name is Aliana (אליאנה). You are the paid-advertising analyst of the Seven Collection hotels; when asked who you are, say you are Aliana (7EVEN / Sola, The Gutman with its spa, 7seas, Hostel 180). The ads are not only for events: they also promote rooms, the spa, brides and hiring (a hostel has no event hall and advertises rooms and jobs). Today is ${C.ilDate(new Date())}.
You write a ${kind === 'weekly' ? 'WEEKLY CAMPAIGN REPORT' : 'DAILY ANALYSIS'} for ${who}, for scope "${scope.name}". It is a document the manager READS in the app, not a chat: write it so it can be read in under a minute and acted on.

YOUR ROLE: you are the owner's independent expert on paid social (Meta: Facebook/Instagram/WhatsApp ads), on the OWNER'S side, reviewing the work of the external social media agency that runs the campaigns. You think like a senior performance-marketing lead: you know how Meta campaigns should be built (objective, optimisation event, campaign/ad-set structure, budgets and learning phase, audiences, placements, creative and copy, testing, frequency, landing/WhatsApp flow, lead quality) and you JUDGE whether what the agency did is right for these hotels and goals. Give clear verdicts ("נכון", "לא נכון", "לא בטוח") with the reason and the numbers, and say what the owner should ask or demand from the agency. Do not hide behind "I only read data": the owner wants your professional opinion.
You do not touch the ad accounts yourself (read only) and never say that you changed anything; the agency executes.
Tools for judging the agency: campaign_structure (how each campaign is built), agency_changes (what they changed and when), the weekly numbers and the CRM (what it brought), and the owner's/managers' directions + what was learned from the agency WhatsApp group (in MANAGERS' DIRECTIONS).
Data: weekly campaign rows (the Meta sync writes spend ₪, impressions, clicks, leads, conversations started; manual reports may exist too) and the CRM leads with source, campaign name, stage and won revenue (before VAT). Google Ads is NOT connected yet: say so once in caveats, never invent Google numbers. The tools only show this scope's data.

How to work:
- The METRICS in the user message are computed by the system: trust and quote them, do not recompute. Use the tools to look inside campaigns and the CRM funnel.
- Judge a campaign by what it brought, not by cheap leads: cost per lead AND cost per won event AND return on spend. Events close slowly (weeks), so recent weeks always look worse than they will: say so.
- The current week is partial (see dayOfWeek): never call a partial week a drop without saying it is partial.
- Flag campaigns over the cost-per-lead limit, big changes against the previous weeks, and leads with no campaign name (we cannot learn from them).
- Small samples (under 10 leads or under 3 won) prove nothing: say the data is thin and what you would watch next.
- ${kind === 'weekly' ? 'Weekly report: what happened this week against the previous weeks, which campaigns earned their budget and which did not, and up to 3 directions you suggest for next week. Build on the daily headlines you are given.' : 'Daily analysis: what changed since the previous analysis, and what needs attention today. If nothing important changed, say so in one line; do not repeat the previous analysis.'}
- Directions: specific (which campaign, which number, what to do, why), at most 3, ranked. No generic marketing advice.
- Review the agency's work too: look at campaign_structure and agency_changes, and when something they built or changed is wrong (or very right) for the goal, say so as a highlight or direction (what to ask the agency).
- Write in Hebrew. Short. Numbers with ₪. Never invent a number.
- Finish by calling save_report ONCE with the final content. That is what the manager reads.`;
  const k = kb.trim() ? '\n\nBUSINESS CONTEXT FROM THE OWNER (goals, budgets, seasons, rules):\n' + kb : '\n\nBUSINESS CONTEXT: none given yet. Do not assume goals or budgets; state your assumption when it matters.';
  return [{ type: 'text', text: rules + k + AUDIT_KB, cache_control: { type: 'ephemeral' } }];
}

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const SAVE_REPORT = { name: 'save_report', description: 'Save the report the manager will read. Call it ONCE, at the end.',
  input_schema: { type: 'object', properties: {
    headline: { type: 'string', description: 'one line (Hebrew, max 140 chars): the single most important thing' },
    summary: { type: 'string', description: '3-6 short sentences: what is happening, with numbers' },
    highlights: { type: 'array', description: 'up to 6 campaigns worth a look', items: { type: 'object', properties: { campaign: { type: 'string' }, status: { type: 'string', enum: ['good', 'watch', 'bad'] }, note: { type: 'string' } }, required: ['campaign', 'status', 'note'] } },
    directions: { type: 'array', description: 'up to 3 suggested directions, ranked', items: { type: 'object', properties: { title: { type: 'string' }, why: { type: 'string', description: 'the numbers behind it' }, action: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['title', 'why', 'action'] } },
    caveats: { type: 'string', description: 'data limits: thin sample, partial week, leads without campaign, Google not connected' } }, required: ['headline', 'summary'] } };
const cleanReport = (a) => ({ headline: clip(a.headline, 200), summary: clip(a.summary, 1500),
  highlights: (Array.isArray(a.highlights) ? a.highlights : []).slice(0, 6).map((h) => ({ campaign: clip(h.campaign, 120), status: ['good', 'watch', 'bad'].includes(h.status) ? h.status : 'watch', note: clip(h.note, 300) })),
  directions: (Array.isArray(a.directions) ? a.directions : []).slice(0, 3).map((d) => ({ title: clip(d.title, 160), why: clip(d.why, 400), action: clip(d.action, 400), priority: ['high', 'medium', 'low'].includes(d.priority) ? d.priority : 'medium' })),
  caveats: clip(a.caveats, 400) });

// ---------- one scope, one report ----------
async function previousReports(scope, ids) { // by fixed document ids, so no index is needed
  const snaps = await Promise.all(ids.map((id) => db.doc('adReports/' + id).get()));
  return snaps.filter((s) => s.exists).map((s) => { const d = s.data(); return { date: d.date, headline: d.headline, summary: clip(d.summary, 400), directions: (d.directions || []).map((x) => x.title) }; });
}
async function runScope(scope, kind, cfg, today, force) {
  const M = await metricsOf(scope, today);
  if (!M.hasData) return { scope: scope.key, skipped: 'no data' };
  const digest = crypto.createHash('sha1').update(JSON.stringify([M.thisWeek, M.last4Weeks, M.crm90d])).digest('hex').slice(0, 16);
  const sref = db.doc('agentState/ads_' + kind + '_' + scope.key), st = (await sref.get()).data() || {};
  if (!force && kind === 'daily' && st.digest === digest && Date.now() - (+st.at || 0) < cfg.skipMaxDays * 864e5) return { scope: scope.key, skipped: 'unchanged' };

  let week = M.weekStart, ctxTxt;
  if (kind === 'weekly') {
    week = C.addDays(M.weekStart, -7); // the week that just ended
    const days = await previousReports(scope, [0, 1, 2, 3, 4, 5, 6].map((i) => 'daily_' + scope.key + '_' + C.addDays(week, i)));
    ctxTxt = `Weekly report for the week ${week} to ${C.addDays(week, 6)} (Sunday to Saturday), compared with the weeks before it. It is now ${today}, so that week is complete; use campaign_weeks / campaign_totals with from=${week} and to=${C.addDays(week, 6)} for it.\nDaily headlines of that week (yours, from the daily analyses): ${JSON.stringify(days)}`;
  } else {
    const prev = await previousReports(scope, [1, 2, 3].map((i) => 'daily_' + scope.key + '_' + C.addDays(today, -i)));
    const pw = await previousReports(scope, ['weekly_' + scope.key + '_' + C.addDays(M.weekStart, -7)]);
    ctxTxt = `Daily analysis for ${today}.\nPrevious daily analyses (latest first): ${JSON.stringify(prev)}\nLast weekly report: ${JSON.stringify(pw)}`;
  }
  let saved = null;
  const tools = [...readTools(scope), { ...SAVE_REPORT, run: async (a) => { saved = cleanReport(a || {}); return { saved: true }; } }];
  const model = cfg.model || SMART;
  const out = await C.runLoop({ model, system: system(await C.loadKB('ads'), scope, kind), tools, messages: [{ role: 'user', content: ctxTxt + notesTxt(await notesFor(scope)) + '\n\nMETRICS (computed by the system):\n' + JSON.stringify(M) }], maxTurns: kind === 'weekly' ? 10 : 8, maxTokens: 4000 }); // Hebrew reports need room (1500 cut them off)
  if (!saved) { const t = String(out.text || '').trim(); if (!t) { await C.logRun('ads', { scope: scope.key, kind, model, usage: out.U, error: 'no report produced' }); return { scope: scope.key, skipped: 'no report' }; } saved = cleanReport({ headline: t.split('\n')[0], summary: t }); }
  const id = kind + '_' + scope.key + '_' + (kind === 'weekly' ? week : today);
  await db.doc('adReports/' + id).set({ kind, hotel: scope.hotel, scopeKey: scope.key, scopeName: scope.name, date: today, week, ...saved, metrics: { thisWeek: M.thisWeek, lastWeek: M.lastWeek, dayOfWeek: M.dayOfWeek, crm90d: M.crm90d }, at: Date.now(), model, by: 'ai' });
  await sref.set({ digest, at: Date.now() });
  await C.logRun('ads', { scope: scope.key, kind, model, usage: out.U, tools: out.used, report: id });
  return { scope: scope.key, report: id };
}

async function cleanupDaily(cfg) { // old daily analyses are not kept forever; weekly reports stay
  try {
    const cut = Date.now() - cfg.keepDailyDays * 864e5, q = await db.collection('adReports').where('at', '<', cut).limit(200).get();
    for (const d of q.docs) if ((d.data() || {}).kind === 'daily') await d.ref.delete();
  } catch (e) { console.error('adsDaily cleanup', e); }
}
async function runAll(kind, force) {
  const cfg = { ...DEFAULTS, ...(await C.cfg('ads')) };
  if (cfg.enabled !== true || (!force && cfg[kind] === false)) return [];
  const today = C.ilDate(new Date());
  if (!force && kind === 'daily' && isSunday(today)) return []; // on Sunday the weekly report replaces the daily one
  const done = [];
  for (const s of await scopeList(cfg)) { // one after the other: the scheduled function has up to 9 minutes
    try { done.push(await runScope(s, kind, cfg, today, force)); }
    catch (e) { console.error('ads', kind, s.key, e); await C.logRun('ads', { scope: s.key, kind, error: clip(e.message || e, 300) }); done.push({ scope: s.key, error: true }); }
  }
  if (kind === 'daily') await cleanupDaily(cfg);
  return done;
}
exports.adsDaily = functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '512MB' }).pubsub.schedule('0 7 * * *').timeZone('Asia/Jerusalem').onRun(async () => { await runAll('daily', false); return null; });
exports.adsWeekly = functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '512MB' }).pubsub.schedule('0 8 * * 0').timeZone('Asia/Jerusalem').onRun(async () => { await runAll('weekly', false); return null; });

// ---------- owner-only: run now / chat with the data ----------
async function rateOk(uid, max) {
  const ref = db.doc('agentRate/ads_' + uid), hour = new Date().toISOString().slice(0, 13);
  return db.runTransaction(async (tx) => { const s = await tx.get(ref), d = s.exists ? s.data() : {}, n = d.hour === hour ? (+d.n || 0) : 0; if (n >= max) return false; tx.set(ref, { hour, n: n + 1, total: (+d.total || 0) + 1, at: Date.now() }); return true; });
}
const http = (name, timeout, fn) => functions.region(REGION).runWith({ timeoutSeconds: timeout, memory: '512MB' }).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.set('Access-Control-Allow-Methods', 'POST');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const cfg = { ...DEFAULTS, ...(await C.cfg('ads')) };
    if (cfg.enabled !== true) { res.status(503).json({ error: 'סוכן הקידום עוד לא הופעל.' }); return; }
    const u = await C.ownerOnly(req); if (!u) { res.status(401).json({ error: 'auth' }); return; }
    if (!(await rateOk(u.uid, cfg.rateHour))) { res.status(429).json({ error: 'הגעת למגבלת הבקשות לשעה.' }); return; }
    await fn(req, res, cfg, u);
  } catch (e) { console.error(name, e); res.status(500).json({ error: 'משהו השתבש. נסו שוב בעוד רגע.' }); }
});
exports.adsRunNow = http('adsRunNow', 540, async (req, res) => {
  const kind = (req.body || {}).kind === 'weekly' ? 'weekly' : 'daily';
  res.json({ kind, results: await runAll(kind, true) });
});
// chat with the ads agent (owner, Nov 7): managers ask questions about THEIR scope; runs on Haiku (cfg.chatModel), reports stay on Sonnet.
// Who: owner / CEO (any scope, incl. the chain), hotel managers (gm) and social media holders (mkt) for their hotels; mkt with all hotels also the chain.
// Works even while the scheduled reports are off (cfg.enabled); cfg.chat === false turns it off.
const CHAT = 'claude-haiku-5-5';
// Aliana is given per person on the employee card (employees/{uid}.ai.aliana, owner Nov 9): hotel scope = the person's hotel(s); chain staff = whole chain + every hotel
const chatOk = (c, h) => !!c && !c.denied && (c.owner || (!!(c.ai && c.ai.aliana) && (h ? (c.hotels.length === 0 || c.hotels.includes(h)) : c.hotels.length === 0)));
// owner, Nov 8: analysis questions (audits, why / what to change, comparisons, judging the agency) go to Sonnet; short general questions stay on Haiku.
// A clear analysis word decides at once; otherwise a tiny Haiku call classifies the question. Override: agentcfg/ads.chatModel (general) / analysisModel.
const ANALYSIS = 'claude-sonnet-5-5';
const ANA_RE = /נתח|ניתוח|תבדק|בדק[יו]?\b|בדיקה|למה|מדוע|האם .*(נכון|טוב|כדאי|משתלם)|עבודה טובה|תשווה|השווא|המלצ|מה כדאי|מה לשנות|אסטרטג|ביקורת|לשפר|שיפור|audit|analy|why|compare/i;
async function chatModelFor(cfg, hist) {
  const gen = cfg.chatModel || CHAT, ana = cfg.analysisModel || ANALYSIS;
  const q = String((hist[hist.length - 1] || {}).content || '').slice(0, 600);
  if (ANA_RE.test(q)) return ana;
  try {
    const j = await C.claude({ model: CHAT, max_tokens: 3, system: 'Classify the manager\'s question to a paid-ads analyst. Reply with one letter only: A = needs analysis or judgement (why, evaluate, recommend, compare, audit the agency, what to change); G = a simple factual or general question (a number, a list, a definition, small talk).', messages: [{ role: 'user', content: q }] });
    const t = ((j.content || [])[0] || {}).text || '';
    return /^\s*A/i.test(t) ? ana : gen;
  } catch (e) { return gen; }
}
async function chatCore(cfg, c, h, hist, extra) {
    const scope = h ? (await scopeList(cfg)).find((x) => x.hotel === h) : { key: 'chain', hotel: '', name: 'כל הרשת', A: null };
    if (!scope) return { error: 'scope' };
    const model = await chatModelFor(cfg, hist), ns = await notesFor(scope);
    const sys = system(await C.loadKB('ads'), scope, 'daily').map((b) => ({ ...b, text: b.text.replace(/Finish by calling save_report ONCE[^\n]*/, `This is a CHAT, not a report: answer the question of ${clip(c.name, 60) || 'the manager'} directly, short (a few sentences or a short list), in Hebrew, with numbers from the tools. Use campaign_structure for questions about audiences, ads, texts or placements, and agency_changes for what the agency did. When asked whether the agency is doing things right, audit: go over structure, targeting, creative, budgets, changes and results, and give a verdict per point. Do not write a full report.`) + notesTxt(ns) + (extra ? '\n\n' + extra : '') }));
    const out = await C.runLoop({ model, system: sys, tools: readTools(scope), messages: hist, maxTurns: 8, maxTokens: 8000, mustAnswer: true }); // the newer models think before answering: a small limit was all used up by thinking, leaving no text
    await C.logRun('ads', { uid: c.uid, kind: 'chat', scope: scope.key, model, usage: out.U, tools: out.used, stop: out.stop, textLen: (out.text || '').length });
    return { text: out.text || 'לא הצלחתי לענות על זה. אפשר לנסח אחרת?', scope: scope.name, used: out.used };
}
exports.adsAgent = functions.region(REGION).runWith({ timeoutSeconds: 120, memory: '512MB' }).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.set('Access-Control-Allow-Methods', 'POST');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const cfg = { ...DEFAULTS, ...(await C.cfg('ads')) };
    if (cfg.chat === false) { res.status(503).json({ error: 'הצ׳אט עם אליאנה כבוי.' }); return; }
    const c = await require('./assistant.js')._t.caller(req);
    if (!c || c.denied) { res.status(401).json({ error: 'auth' }); return; }
    const body = req.body || {}, hs = (await db.collection('hotels').get()).docs.map((d) => ({ id: d.id, name: (d.data() || {}).name || d.id }));
    let h = typeof body.hotel === 'string' ? body.hotel : null;
    if (h === null) h = chatOk(c, '') ? '' : (c.hotels[0] || '');
    if (h && !hs.some((x) => x.id === h)) { res.status(400).json({ error: 'מלון לא מוכר.' }); return; }
    if (!chatOk(c, h)) { res.status(403).json({ error: 'אין לך הרשאה לדוחות הקידום של ' + (h ? 'המלון הזה' : 'כל הרשת') + '.' }); return; }
    if (!(await rateOk(c.uid, +cfg.chatRate || 30))) { res.status(429).json({ error: 'הגעת למגבלת השאלות לשעה. נסו שוב מאוחר יותר.' }); return; }
    const hist = (Array.isArray(body.messages) ? body.messages : []).slice(-8)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()).map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }));
    while (hist.length && hist[0].role !== 'user') hist.shift();
    if (!hist.length || hist[hist.length - 1].role !== 'user') { res.status(400).json({ error: 'empty' }); return; }
    const r = await chatCore(cfg, c, h, hist); if (r.error) { res.status(400).json({ error: r.error }); return; }
    res.json({ text: r.text, scope: r.scope, tools: [...new Set(r.used)] });
  } catch (e) { console.error('adsAgent', e); res.status(500).json({ error: 'משהו השתבש. נסו שוב בעוד רגע.' }); }
});

exports._t = { readTools, metricsOf, scopeList, runScope, runAll, system, cleanReport, notesFor, notesTxt, chatOk, chatCore, rateOk, DEFAULTS };
