// ================= Operations manager agent: makes sure every hotel runs as it should, and supervises the other agents (owner, Nov 12) =================
// Connected Nov 13 (owner). Does nothing until agentcfg/ops.enabled === true; agentcfg/ops.push === false = reports only, no pushes.
//
// What it may do (owner's choice, Nov 12: "alerts and prepares drafts"):
//   - READ everything operational: shifts, schedule (assignments + 10days), requests, housekeeping board, calls, faults, tours, spa, groups,
//     events (quotes), shift reports, purchase requests, complaints, and the other agents' logs / reports.
//   - WRITE only: its reports (opsReports), staffing drafts (opsDrafts), its state (opsState / opsSent / opsWatch), push notifications,
//     and directions to other agents (adNotes for the ads agent, agentTasks for the yield agent). It never changes a shift, the schedule,
//     a room, a fault or a booking, and never publishes anything.
// Who hears from it (owner, Nov 12): the hotel manager (gm), each department manager about their own department (roles.apps.dept + depts),
// the duty manager on shift today (whoever is assigned to today's 'ops' shift), and the reception (10days must be updated every day).
// One bundled push per person per run, never the same item twice a day, at most cfg.maxPushPerDay pushes per person, nothing at night.
//
// Runs (Asia/Jerusalem):
//   opsMorning 07:15  per hotel: today's and tomorrow's checks → report + pushes; then the chain report for the owner,
//                     with the other agents' health and up to cfg.maxDirections directions to them.
//   opsCheckin 14:00  code only (no Claude), two hours before check-in (16:00): arrival rooms not ready, open calls, faults in arrival rooms, today's holes.
//   opsWatch   every 5 minutes, code only: housekeeping calls open > 25 min, a fault in a check-in room open > 2 h, Adam's hand-offs nobody answered.
//   opsWeekly  Sunday 08:00  staffing DRAFT for next week (availability opens that day) from the 10days numbers → opsDrafts/{hotel}_{week}.
//   The owner's answers (Nov 12) are the defaults below and the ratios in agentcfg/ops; directions to other agents are off (maxDirections 0) while they learn.
//   opsRunNow  owner only: POST {kind:'morning'|'checkin'|'weekly', hotel?, push?}
//   opsJob     opsJobs/{id} {kind, push?} created by an admin script (functions/ops-run.js) → runAll inside the function (it has the Claude key).
// Every number and every alert is computed in this code; the model only writes the summary and the directions.
const functions = require('firebase-functions/v1');
const crypto = require('crypto');
const C = require('./agent-common');
const { db, admin } = C;
const REGION = 'europe-west1';
const DEFAULTS = {
  enabled: false, morning: true, checkin: true, weekly: true, push: true, supervise: true,
  model: '', fastModel: 'claude-haiku-5-5', smartModel: 'claude-sonnet-5-5',
  maxPushPerDay: 4, quietFrom: 22, quietTo: 7,
  tenDaysAhead: 7, tenDaysStaleDays: 2, faultHours: 24, faultHighDays: 1, callMins: 25, prDays: 0, cmpDays: 2, // owner, Nov 12: a fault within a day, a call within 30 min (alert at 25), purchase requests later (0 = off)
  arrivalFaultHours: 2, handoffMins: 60, handoffMorningMins: 120, watch: true, // fault in a check-in room: 2 h; Adam's hand-offs: 1 h in working hours, 2 h from the start of the next day
  hkTarget: 14, // rooms one housekeeping attendant cleans in a shift (departure + refresh); the owner sets the real number
  ratios: {}, // optional, per hotel id or 'default': {dining:{bf:40,dn:30}, kitchen:{covers:60}, ...}: guests per one worker
  maxDirections: 0, agents: ['ads', 'reply', 'yield'], // owner, Nov 12: the other agents are still learning → supervise only, no directions until he says so
};
const DEPT = { ops: 'תפעול / מנהל תורן', reception: 'קבלה', housekeeping: 'משק', public: 'שטחים ציבוריים', maintenance: 'אחזקה', kitchen: 'מטבח', dining: 'חדר אוכל', bar: 'בר', dishwash: 'שוטף כלים', laundry: 'מכבסה' };
const AGENT_HE = { ads: 'עדי (קמפיינים)', reply: 'אדם (מענה ללידים)', yield: 'גיא (תשואה)' };
const DOW = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const dowOf = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const dm = (iso) => (iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : '');
const dayName = (iso, today) => (iso === today ? 'היום' : iso === C.addDays(today, 1) ? 'מחר' : 'יום ' + DOW[dowOf(iso)] + ' ' + dm(iso));
const schedPath = (w, h) => 'schedule/' + (h === 'main' ? w : w + '_' + h);
const shiftHotel = (s) => s.hotel || 'main';
const occL = (v) => String(v || '').split(',').filter(Boolean);
const ilHour = (ms) => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(new Date(ms)) % 24;
const SEV = { high: 3, medium: 2, low: 1 };
// agentLog row without undefined values (Firestore add() throws synchronously on undefined, which broke the first run)
const log = (data) => { try { return C.logRun('ops', JSON.parse(JSON.stringify(data))); } catch (e) { console.error('ops log', e.message); } };

// ---------- loading ----------
async function loadHotels() { const s = await db.collection('hotels').get(); return s.docs.map((d) => ({ id: d.id, name: (d.data() || {}).name || d.id })); }
const docData = async (p) => { try { const d = await db.doc(p).get(); return d.exists ? d.data() || {} : null; } catch (e) { return null; } };
async function q(col, ...conds) { try { let r = db.collection(col); for (const [f, op, v] of conds) r = r.where(f, op, v); const s = await r.get(); return s.docs.map((d) => ({ id: d.id, ...d.data() })); } catch (e) { console.error('ops query', col, e.message); return []; } }

// who is on each shift of the hotel on these dates: the schedule doc's assignment + approved requests (same logic as srRemind)
async function staffing(h, dates) {
  const shifts = (await q('shifts', ['date', 'in', dates])).filter((s) => shiftHotel(s) === h && +s.need > 0);
  const weeks = [...new Set(dates.map(C.weekOf))], sched = {};
  for (const w of weeks) sched[w] = await docData(schedPath(w, h));
  const reqs = (await q('requests', ['hotel', '==', h], ['status', '==', 'approved'])).filter((r) => r.type !== 'extend');
  return shifts.map((s) => {
    const sd = sched[C.weekOf(s.date)] || {}; let a = [...(((sd.assign || {})[s.id]) || [])];
    for (const r of reqs) {
      if (r.from === s.id) a = a.filter((u) => u !== r.uid); if (r.to === s.id && !a.includes(r.uid)) a.push(r.uid);
      if (r.type === 'swap' && r.peer) { if (r.from === s.id && !a.includes(r.peer)) a.push(r.peer); if (r.to === s.id) a = a.filter((u) => u !== r.peer); }
    }
    return { id: s.id, date: s.date, dept: s.dept, kind: s.kind, start: s.start || '', end: s.end || '', need: +s.need, who: a, published: !!sd.published };
  });
}
async function tenDays(h, from, n) { // the 10days numbers reception enters: schedule doc .daily[date] {ci, cid, co, bf, dn, rf}
  const out = {}, weeks = {};
  for (let i = 0; i < n; i++) { const d = C.addDays(from, i), w = C.weekOf(d); if (!(w in weeks)) weeks[w] = await docData(schedPath(w, h)); out[d] = ((weeks[w] || {}).daily || {})[d] || null; }
  return out;
}
async function people(hotel) { // routing table for one hotel
  const rs = await db.collection('roles').get(), P = { gm: [], sched: [], reception: [], spa: [], maint: [], dept: {} };
  rs.forEach((d) => {
    const r = d.data() || {}, a = r.apps || { shifts: true }, hs = r.hotels || [], inH = !hs.length || hs.includes(hotel);
    if (r.station) { if (hs.includes(hotel)) P.reception.push(d.id); return; }
    if (!inH) return;
    if (a.gm) P.gm.push(d.id); if (a.shifts) P.sched.push(d.id); if (a.front) P.reception.push(d.id); if (a.spa) P.spa.push(d.id); if (a.maint) P.maint.push(d.id);
    if (a.dept && hs.includes(hotel)) for (const k of r.depts || []) (P.dept[k] = P.dept[k] || []).push(d.id);
  });
  return P;
}
function route(groups, P, duty) {
  const out = new Set();
  for (const g of groups) {
    if (g === 'duty') duty.forEach((u) => out.add(u));
    else if (g.startsWith('dept:')) { const k = g.slice(5), L = P.dept[k] || []; (L.length ? L : P.gm).forEach((u) => out.add(u)); if (k === 'maintenance') P.maint.forEach((u) => out.add(u)); }
    else if (g.startsWith('by:')) out.add(g.slice(3));
    else (P[g] || []).forEach((u) => out.add(u));
  }
  return [...out].filter(Boolean);
}

// ---------- the checks (all in code) ----------
// item: {key, area, sev, text, to:[groups], dept?}
function checkStaff(st, today, cfg, out, kind) {
  const days = kind === 'checkin' ? [today] : [today, C.addDays(today, 1)];
  for (const d of days) {
    const gaps = {};
    for (const s of st.filter((x) => x.date === d)) { const miss = s.need - s.who.length; if (miss > 0) (gaps[s.dept] = gaps[s.dept] || []).push(`${s.start}-${s.end} חסר ${miss}`); }
    for (const [dept, L] of Object.entries(gaps)) out.push({ key: 'gap_' + d + '_' + dept, area: 'staff', dept, sev: d === today ? 'high' : 'medium', to: ['dept:' + dept, 'gm'], text: `${dayName(d, today)}: משמרות לא מאוישות ב${DEPT[dept] || dept} (${L.join(', ')})` });
  }
  if (kind === 'checkin') return;
  const todayShifts = st.filter((x) => x.date === today);
  if (todayShifts.length && !todayShifts.some((x) => x.published)) out.push({ key: 'unpub_' + C.weekOf(today), area: 'staff', sev: 'high', to: ['sched', 'gm'], text: 'הסידור של השבוע הזה עוד לא פורסם לעובדים' });
  const ops = todayShifts.filter((x) => x.dept === 'ops');
  if (!ops.some((x) => x.who.length)) out.push({ key: 'noduty_' + today, area: 'staff', dept: 'ops', sev: 'high', to: ['gm', 'sched'], text: ops.length ? 'אין מנהל תורן משובץ היום (משמרת תפעול פתוחה ולא מאוישת)' : 'לא נפתחה היום משמרת תפעול / מנהל תורן' });
}
async function checkNextWeek(h, today, out) { // owner, Nov 12: availability for next week opens on Sunday, so its shifts must be open from Sunday; publishing is checked from Thursday
  const nw = C.addDays(C.weekOf(today), 7), sd = await docData(schedPath(nw, h)), shifts = (await q('shifts', ['date', '>=', nw], ['date', '<=', C.addDays(nw, 6)])).filter((s) => shiftHotel(s) === h);
  if (!shifts.length) out.push({ key: 'nwopen_' + nw, area: 'staff', sev: dowOf(today) >= 2 ? 'high' : 'medium', to: ['sched', 'gm'], text: `לא נפתחו עדיין משמרות לשבוע הבא (${dm(nw)})` });
  else if (!(sd && sd.published) && dowOf(today) >= 4) out.push({ key: 'nwpub_' + nw, area: 'staff', sev: 'medium', to: ['sched', 'gm'], text: `הסידור לשבוע הבא (${dm(nw)}) עוד לא פורסם` });
}
async function checkTenDays(h, today, cfg, out, hostel) {
  const TD = await tenDays(h, today, Math.max(cfg.tenDaysAhead, 14)), miss = [];
  for (let i = 0; i < cfg.tenDaysAhead; i++) { const d = C.addDays(today, i), x = TD[d]; if (!x || (x.ci == null && x.cid == null) || x.co == null || x.bf == null) miss.push(d); }
  const hash = crypto.createHash('sha1').update(JSON.stringify(TD)).digest('hex').slice(0, 16), sref = db.doc('opsState/tendays_' + h), s = (await sref.get()).data() || {};
  const since = s.hash === hash ? +s.since || Date.now() : Date.now();
  await sref.set({ hash, since, at: Date.now() });
  const staleDays = Math.floor((Date.now() - since) / 864e5);
  if (miss.length) out.push({ key: 'tendays_miss_' + today, area: 'tendays', sev: miss.includes(today) || miss.includes(C.addDays(today, 1)) ? 'high' : 'medium', to: ['reception', 'gm'], text: `חסרים מספרי 10days (צ׳ק אין, צ׳ק אאוט, ארוחת בוקר) ל-${miss.length} מתוך ${cfg.tenDaysAhead} הימים הקרובים: ${miss.slice(0, 4).map((d) => dayName(d, today)).join(', ')}. לעדכן היום בעמוד הקבלה` });
  else if (staleDays >= cfg.tenDaysStaleDays) out.push({ key: 'tendays_stale_' + today, area: 'tendays', sev: 'medium', to: ['reception'], text: `מספרי 10days לא השתנו כבר ${staleDays} ימים. לעבור עליהם היום מול מערכת ההזמנות ולעדכן` });
  return { days: TD, staleDays, hostel };
}
async function checkTours(h, today, out) {
  const T = (await q('tours', ['hotel', '==', h])).filter((t) => t.date && t.date >= C.addDays(today, -7) && t.date <= C.addDays(today, 1));
  const info = [];
  for (const t of T) {
    if (t.status === 'scheduled' && t.date < today) out.push({ key: 'tour_open_' + t.id, area: 'tours', sev: 'low', to: ['by:' + (t.by || ''), 'gm'], text: `סיור של ${t.leadName || 'ליד'} מ-${dm(t.date)} לא סומן כבוצע או בוטל` });
    if (t.status === 'scheduled' && t.date >= today) { info.push({ date: t.date, time: t.time || '', lead: t.leadName || '', note: clip(t.note, 80) }); if (!t.time) out.push({ key: 'tour_time_' + t.id, area: 'tours', sev: 'low', to: ['by:' + (t.by || '')], text: `לסיור של ${t.leadName || 'ליד'} ${dayName(t.date, today)} אין שעה` }); }
  }
  return info.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
async function checkSpa(h, today, out) {
  const S = (await q('spa', ['date', '>=', C.addDays(today, -1)])).filter((b) => (b.hotel || '') === h && b.kind !== 'block' && b.date <= C.addDays(today, 1));
  const info = { today: 0, tomorrow: 0, noTher: 0, requests: 0 };
  for (const b of S) {
    if (b.status === 'canceled') continue;
    if (b.date === today) info.today++; if (b.date === C.addDays(today, 1)) info.tomorrow++;
    if (b.status === 'request' && b.date >= today) { info.requests++; out.push({ key: 'spa_req_' + b.id, area: 'spa', sev: 'high', to: ['spa'], text: `בקשת הזמנה לספא ${dayName(b.date, today)} ${b.time || ''} (${b.name || b.treatment || ''}) עוד לא אושרה` }); }
    const n = +b.people || 1; let miss = 0; for (let i = 0; i < n; i++) if (!(b.tid || [])[i] || !(b.tok || [])[i]) miss++;
    if (miss && b.date === today && b.status !== 'done') info.noTher++;
    if (b.date < today && b.status === 'booked') out.push({ key: 'spa_done_' + b.id, area: 'spa', sev: 'low', to: ['spa'], text: `טיפול ספא מאתמול (${b.time || ''} ${b.name || b.treatment || ''}) לא סומן כבוצע` });
  }
  if (info.noTher) out.push({ key: 'spa_ther_' + today, area: 'spa', sev: 'high', to: ['spa', 'duty'], text: `${info.noTher} טיפולי ספא היום בלי מטפל מתואם` });
  return info;
}
async function checkFaults(h, today, cfg, out, arrivals) {
  const F = await q('faults', ['hotel', '==', h], ['status', '==', 'open']), now = Date.now();
  let old = 0;
  for (const f of F) {
    const hrs = (now - (+f.openedAt || now)) / 36e5, room = String(f.room || '').trim();
    if (room && arrivals.includes(room)) out.push({ key: 'fault_arr_' + f.id, area: 'maint', sev: 'high', to: ['dept:maintenance', 'duty'], text: `תקלה פתוחה בחדר ${room} שיש בו הגעה היום: ${clip(f.desc, 60)}` });
    else if (hrs >= cfg.faultHours) { old++; out.push({ key: 'fault_old_' + f.id, area: 'maint', sev: hrs >= cfg.faultHighDays * 24 ? 'high' : 'medium', to: ['dept:maintenance', ...(hrs >= cfg.faultHighDays * 24 ? ['gm'] : [])], text: `תקלה פתוחה ${Math.round(hrs / 24) || 1} ימים${room ? ' בחדר ' + room : ''}: ${clip(f.desc, 60)}` }); }
  }
  return { open: F.length, old };
}
async function checkHk(h, today, cfg, out, hkStaff, kind) {
  const day = ((await docData('hkday/' + h)) || {}).date || today, D = (await docData('hk/' + h + '__' + day)) || {};
  const clean = D.clean || {}, occ = D.occ || {}, asg = D.asg || {}, trt = D.trt || {}, done = D.done || {};
  const rooms = new Set([...Object.keys(clean), ...Object.keys(occ)]);
  const arrivals = [...rooms].filter((r) => occL(occ[r]).includes('res'));
  const dirty = [...rooms].filter((r) => clean[r] === 'vd' || clean[r] === 'od' || occL(occ[r]).includes('co'));
  const work = new Set([...dirty, ...Object.keys(trt).filter((r) => trt[r])]);
  const notReady = arrivals.filter((r) => !['vc', 'vi', 'oc'].includes(clean[r]) && !done[r]);
  const unassigned = [...work].filter((r) => !asg[r]);
  const offShift = [...new Set(Object.values(asg).filter((u) => u && hkStaff.length && !hkStaff.includes(u)))];
  const info = { day, rooms: rooms.size, arrivals: arrivals.length, toClean: work.size, notReady: notReady.length, unassigned: unassigned.length, attendants: hkStaff.length, perAttendant: hkStaff.length ? Math.round((work.size / hkStaff.length) * 10) / 10 : null };
  if (!rooms.size) { out.push({ key: 'hk_empty_' + today, area: 'hk', sev: kind === 'checkin' ? 'high' : 'low', to: ['reception', 'dept:housekeeping'], text: 'לוח המשק של היום ריק: הקבלה עוד לא סימנה הגעות ועזיבות (RES / C/O)' }); return { ...info, arrivalsList: [] }; }
  if (kind === 'checkin') {
    if (notReady.length) out.push({ key: 'hk_notready_' + today, area: 'hk', sev: 'high', to: ['dept:housekeeping', 'duty', 'reception'], text: `${notReady.length} חדרי הגעה עוד לא מוכנים: ${notReady.slice(0, 10).join(', ')}` });
    if (unassigned.length) out.push({ key: 'hk_unasg_ci_' + today, area: 'hk', sev: 'high', to: ['dept:housekeeping', 'duty'], text: `${unassigned.length} חדרים לניקוי בלי עובד משובץ: ${unassigned.slice(0, 10).join(', ')}` });
  } else {
    if (work.size && !hkStaff.length) out.push({ key: 'hk_nostaff_' + today, area: 'hk', sev: 'high', to: ['dept:housekeeping', 'gm', 'duty'], text: `${work.size} חדרים לניקוי היום ואין אף עובד משק משובץ בסידור` });
    else if (hkStaff.length && work.size / hkStaff.length > cfg.hkTarget * 1.15) out.push({ key: 'hk_load_' + today, area: 'hk', sev: 'medium', to: ['dept:housekeeping', 'gm'], text: `עומס במשק: ${work.size} חדרים ל-${hkStaff.length} עובדים (${info.perAttendant} לעובד, היעד ${cfg.hkTarget})` });
    if (offShift.length) out.push({ key: 'hk_off_' + today, area: 'hk', sev: 'low', to: ['dept:housekeeping'], text: `${offShift.length} עובדים משובצים לחדרים אבל לא במשמרת משק היום` });
  }
  const calls = (await q('hkCalls', ['hotel', '==', h], ['status', '==', 'open'])).filter((c) => Date.now() - (+c.openedAt || Date.now()) > cfg.callMins * 60e3);
  if (calls.length) out.push({ key: 'calls_' + today + '_' + calls.map((c) => c.id).sort().join('').slice(0, 40), area: 'hk', sev: 'medium', to: ['dept:housekeeping', 'duty'], text: `${calls.length} קריאות מהקבלה למשק פתוחות יותר מ-${cfg.callMins} דקות (${calls.slice(0, 4).map((c) => 'חדר ' + (c.room || '?') + ' · ' + (c.toName || '')).join(', ')})` });
  return { ...info, arrivalsList: arrivals, openCalls: calls.length };
}
async function checkGroups(h, today, out) {
  const G = (await q('groups', ['hotel', '==', h])).filter((g) => ['confirmed', 'option'].includes(g.status) && g.ci && g.ci <= C.addDays(today, 1) && (g.co || g.ci) >= today);
  const info = [];
  for (const g of G) {
    const arr = g.ci >= today, when = dayName(g.ci, today), M = g.meals || {}, board = String(g.board || '');
    info.push({ name: clip(g.name, 40), ci: g.ci, co: g.co || '', pax: +g.pax || 0, rooms: +g.rooms || 0, arriving: arr });
    if (!arr) continue;
    if (!g.guideRooms) out.push({ key: 'grp_rooms_' + g.id, area: 'groups', sev: 'high', to: ['reception', 'gm'], text: `קבוצת ${clip(g.name, 30)} מגיעה ${when} ועוד לא שובצו לה חדרים (הם לא יופיעו בלוח המשק)` });
    if (['hb', 'fb'].includes(board) && !((M.dn || {}).f || (M.dn || {}).t)) out.push({ key: 'grp_meals_' + g.id, area: 'groups', sev: 'medium', to: ['reception', 'dept:kitchen', 'dept:dining'], text: `לקבוצת ${clip(g.name, 30)} (${board.toUpperCase()}) שמגיעה ${when} אין שעת ארוחת ערב` });
    if (!g.guidePhone) out.push({ key: 'grp_phone_' + g.id, area: 'groups', sev: 'low', to: ['reception'], text: `לקבוצת ${clip(g.name, 30)} שמגיעה ${when} אין טלפון של המדריך` });
  }
  return info;
}
async function checkEvents(h, today, st, out) {
  const venues = (((await docData('settings/' + h)) || {}).venues) || []; if (!venues.length) return [];
  const Q = (await q('quotes', ['event.date', 'in', [today, C.addDays(today, 1)]])).filter((x) => x.status === 'approved' || x.kind === 'group');
  const ev = Q.filter((x) => venues.includes((x.event || {}).venue)).map((x) => ({ date: x.event.date, start: x.event.start || '', end: x.event.end || '', guests: +x.event.guests || 0, type: clip(x.event.type, 30), client: clip((x.client || {}).name, 40) }));
  for (const d of [...new Set(ev.map((e) => e.date))]) {
    const g = ev.filter((e) => e.date === d).reduce((a, e) => a + e.guests, 0);
    for (const dept of ['dining', 'kitchen']) if (g >= 20 && st.some((s) => s.dept === dept) && !st.some((s) => s.date === d && s.dept === dept && s.who.length))
      out.push({ key: 'ev_staff_' + d + '_' + dept, area: 'events', dept, sev: d === today ? 'high' : 'medium', to: ['dept:' + dept, 'gm'], text: `${dayName(d, today)} יש אירועים ל-${g} אורחים ואין אף עובד ${DEPT[dept]} משובץ` });
  }
  return ev.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
async function checkBackOffice(h, today, cfg, st, out) {
  const y = C.addDays(today, -1), recShifts = st.filter((s) => s.date === y && s.dept === 'reception' && s.who.length && s.published);
  if (recShifts.length) {
    const reps = await q('shiftReports', ['hotel', '==', h], ['date', '==', y]), need = recShifts.reduce((a, s) => a + s.who.length, 0);
    const missing = recShifts.flatMap((s) => s.who).filter((u) => !reps.some((r) => r.empUid === u));
    if (reps.length < recShifts.length && missing.length) out.push({ key: 'sr_' + y, area: 'reports', sev: 'medium', to: ['gm'], text: `אתמול הוגשו ${reps.length} דוחות סוף משמרת בקבלה מתוך ${recShifts.length} משמרות (${need} שיבוצים)` });
  }
  const pr = !(cfg.prDays > 0) ? [] : (await q('purchaseReqs', ['hotel', '==', h], ['status', '==', 'pending'])).filter((r) => Date.now() - (+r.createdAt || Date.now()) > cfg.prDays * 864e5);
  if (pr.length) out.push({ key: 'pr_' + today, area: 'stock', sev: 'low', to: ['gm'], text: `${pr.length} דרישות רכש מחכות לאישור יותר מ-${cfg.prDays} ימים` });
  const cm = (await q('hkComplaints', ['hotel', '==', h])).filter((c) => (!c.status || c.status === 'open') && Date.now() - (+c.createdAt || +c.at || Date.now()) > cfg.cmpDays * 864e5);
  if (cm.length) out.push({ key: 'cmp_' + today, area: 'guests', sev: 'medium', to: ['gm'], text: `${cm.length} תלונות אורחים לא טופלו יותר מ-${cfg.cmpDays} ימים` });
}

async function hotelChecks(hotel, today, cfg, kind) {
  const h = hotel.id, out = [], dates = [C.addDays(today, -1), today, C.addDays(today, 1)];
  const st = await staffing(h, dates), on = (d, dept) => [...new Set(st.filter((s) => s.date === d && s.dept === dept).flatMap((s) => s.who))];
  const duty = on(today, 'ops'), hkStaff = on(today, 'housekeeping');
  checkStaff(st, today, cfg, out, kind);
  const hk = await checkHk(h, today, cfg, out, hkStaff, kind);
  const faults = await checkFaults(h, today, cfg, out, hk.arrivalsList || []);
  const m = { hotel: h, name: hotel.name, today, duty: duty.length, hk: (({ arrivalsList, ...x }) => x)(hk), faults };
  if (kind !== 'checkin') {
    await checkNextWeek(h, today, out);
    const hostel = /הוסטל|hostel/i.test(hotel.name);
    const td = await checkTenDays(h, today, cfg, out, hostel);
    m.tenDays = Object.fromEntries(Object.entries(td.days).slice(0, 7).map(([d, x]) => [d, x])); m.tenDaysStaleDays = td.staleDays;
    m.tours = await checkTours(h, today, out); m.spa = await checkSpa(h, today, out); m.groups = await checkGroups(h, today, out);
    m.events = await checkEvents(h, today, st, out); await checkBackOffice(h, today, cfg, st, out);
    m.staffToday = Object.fromEntries(Object.keys(DEPT).map((k) => [k, st.filter((s) => s.date === today && s.dept === k).reduce((a, s) => ({ need: a.need + s.need, have: a.have + s.who.length }), { need: 0, have: 0 })]).filter(([, v]) => v.need));
  }
  out.sort((a, b) => SEV[b.sev] - SEV[a.sev]);
  return { m, items: out, duty };
}

// ---------- push (same channel as the app: pushTokens/{uid}.tokens) ----------
async function sendPush(uids, msg) {
  uids = [...new Set(uids.filter(Boolean))]; if (!uids.length) return 0;
  const docs = await Promise.all(uids.map((u) => db.doc('pushTokens/' + u).get()));
  const tokens = []; docs.forEach((d) => { if (d.exists) Object.keys(d.data().tokens || {}).forEach((t) => tokens.push(t)); });
  if (!tokens.length) return 0;
  const o = (await docData('orgcfg/main')) || {}, url = (o.appUrl || 'https://app.sevencollection.co.il/') + (msg.hash || '');
  const data = { title: msg.title, body: msg.body, url, tag: msg.tag || '' };
  for (let i = 0; i < tokens.length; i += 500) {
    try { await admin.messaging().sendEachForMulticast({ tokens: tokens.slice(i, i + 500), data, webpush: { headers: { Urgency: 'high', TTL: '86400' }, notification: { title: data.title, body: data.body, dir: 'rtl', lang: 'he', tag: data.tag }, fcmOptions: { link: url } } }); } catch (e) { console.error('ops push', e.message); }
  }
  return tokens.length;
}
const HASH = { staff: '#sched', tendays: '#front', tours: '#brief', spa: '#spa', maint: '#maint', hk: '#hk', groups: '#grp', events: '#brief', reports: '#gm', stock: '#stock', guests: '#cmp' };
// one bundled push per person; an item key is sent to a person once a day; at most maxPushPerDay pushes per person per day; nothing at night
async function notify(hotel, items, P, duty, cfg, today, kind, force) {
  if (!cfg.push || !items.length) return {};
  const hr = ilHour(Date.now()); if (!force && (hr >= cfg.quietFrom || hr < cfg.quietTo)) return { quiet: true };
  const per = {};
  for (const it of items) for (const u of route(it.to, P, duty)) (per[u] = per[u] || []).push(it);
  const sent = {};
  for (const [u, L] of Object.entries(per)) {
    const ref = db.doc('opsSent/' + today + '__' + u), s = (await ref.get()).data() || {}, keys = s.keys || [];
    if ((+s.n || 0) >= cfg.maxPushPerDay) continue;
    const fresh = L.filter((it) => !keys.includes(it.key)); if (!fresh.length) continue;
    const top = fresh.slice(0, 3), title = `${kind === 'checkin' ? '⏰ ' : ''}${hotel.name} · ${fresh.length === 1 ? 'דבר אחד לטפל בו' : fresh.length + ' דברים לטפל בהם'}`;
    const body = top.map((it) => (it.sev === 'high' ? '❗ ' : '• ') + it.text).join('\n') + (fresh.length > 3 ? `\nועוד ${fresh.length - 3} בדוח התפעול` : '');
    await sendPush([u], { title, body: clip(body, 400), hash: HASH[top[0].area] || '#', tag: 'ops-' + hotel.id + '-' + kind + '-' + today });
    await ref.set({ n: (+s.n || 0) + 1, keys: keys.concat(fresh.map((it) => it.key)).slice(-200), at: Date.now() });
    sent[u] = fresh.length;
  }
  return sent;
}

// ---------- the model ----------
const OPS_KNOW = `HOW A HOTEL OPERATIONS MANAGER THINKS: every morning, walk the day before it happens: who is on shift in each department and where the holes are; arrivals, departures and which rooms must be ready by check-in; groups and events in house and what they need (rooms, meals, halls, staff); open maintenance faults, especially in rooms that are sold tonight; spa and tours on the diary; what was promised yesterday and not closed (reports, purchase requests, guest complaints). Rank by impact on the guest today, then on cost. Name the owner of each action (department) and when it must be done.`;
function systemOps(kb, scopeName, kind) {
  const rules = `Your name is Aliana (אליאנה, a woman). You are the operations manager agent of the Seven Collection hotels (Israel), writing the ${kind === 'weekly' ? 'weekly staffing-draft note' : 'morning operations report'} for ${scopeName}.
${OPS_KNOW}
RULES
- The checks and numbers are computed by the system. Use only them; never invent a number, a name or a room.
- You change nothing and publish nothing. Write what to do and who should do it (department / hotel manager / duty manager / reception).
- Hebrew, short and concrete: a headline (the single most important thing today), a 3-5 sentence summary, and up to 5 priorities, ordered.
- When everything is in order, say so in one line; do not invent work.
- Missing data is itself a finding (10days not entered, empty housekeeping board): say who must enter it.
- Finish by calling save_report ONCE.`;
  const k = kb.trim() ? '\n\nTHE OWNER\'S OPERATING RULES AND CONTEXT:\n' + kb : '\n\nNo operating rules from the owner yet (staffing ratios, check-in time, duty manager duties): say so once when it matters.';
  return [{ type: 'text', text: rules + k, cache_control: { type: 'ephemeral' } }];
}
const SAVE = { name: 'save_report', description: 'Save the report. Call it ONCE, at the end.', input_schema: { type: 'object', properties: {
  headline: { type: 'string' }, summary: { type: 'string' },
  priorities: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, who: { type: 'string' }, when: { type: 'string' } }, required: ['what', 'who'] } } }, required: ['headline', 'summary'] } };
const DIRECT = { name: 'direct_agent', description: 'Give ONE short direction to another agent for the coming days (it reads it on its next run). Only when the data clearly calls for it.', input_schema: { type: 'object', properties: {
  agent: { type: 'string', enum: ['ads', 'yield'] }, hotel: { type: 'string', description: 'hotel id, or empty for the whole chain' }, text: { type: 'string', description: 'Hebrew, one or two sentences, what to focus on and why (with the numbers)' } }, required: ['agent', 'text'] } };
const cleanRep = (a) => ({ headline: clip(a.headline, 200), summary: clip(a.summary, 1500), priorities: (Array.isArray(a.priorities) ? a.priorities : []).slice(0, 5).map((p) => ({ what: clip(p.what, 240), who: clip(p.who, 60), when: clip(p.when, 40) })) });
function codeReport(items, name) { // when Claude is unavailable, or nothing needs words
  const hi = items.filter((i) => i.sev === 'high');
  return { headline: items.length ? (hi[0] || items[0]).text : `${name}: הכול נראה תקין הבוקר`, summary: items.length ? `${items.length} דברים לבדוק${hi.length ? `, ${hi.length} מהם דחופים` : ''}.` : 'לא נמצאו חורים בסידור, תקלות ישנות או חוסרים בנתונים.', priorities: items.slice(0, 5).map((i) => ({ what: i.text, who: i.dept ? DEPT[i.dept] || i.dept : i.to[0] === 'reception' ? 'קבלה' : 'מנהל המלון', when: i.sev === 'high' ? 'היום' : '' })) };
}
async function writeWithModel(model, system, content, tools, fallback) {
  let saved = null;
  try {
    // max_tokens 12000: the newer models think before writing; a small limit is used up by thinking and leaves no report (Nov 8 / Nov 12 bugs)
    const out = await C.runLoop({ model, system, tools: [...tools, { ...SAVE, run: async (a) => { saved = a || {}; return { saved: true }; } }], messages: [{ role: 'user', content }], maxTurns: 4, maxTokens: 12000 });
    return { rep: saved ? cleanRep(saved) : out.text ? cleanRep({ headline: out.text.split('\n')[0], summary: out.text }) : fallback, U: out.U, used: out.used, stop: out.stop };
  } catch (e) { console.error('ops model', e.message); return { rep: fallback, error: clip(e.message, 200) }; }
}

// ---------- agents supervision (chain) ----------
async function agentsHealth(cfg) {
  const since = Date.now() - 3 * 864e5, L = await q('agentLog', ['at', '>', since]), out = [];
  for (const a of cfg.agents) {
    const c = (await docData('agentcfg/' + a)) || {}, mine = L.filter((x) => x.agent === a).sort((x, y) => y.at - x.at);
    const errs = mine.filter((x) => x.error), last = mine[0];
    const row = { agent: a, name: AGENT_HE[a] || a, enabled: c.enabled === true, runs3d: mine.length, errors3d: errs.length, lastAt: last ? last.at : 0, lastError: errs[0] ? clip(errs[0].error, 120) : '' };
    if (row.enabled && !mine.length && a !== 'reply') row.problem = 'מופעל אבל לא רץ ב-3 הימים האחרונים';
    else if (errs.length && errs.length >= Math.max(2, mine.length / 2)) row.problem = 'רוב הריצות האחרונות נכשלו: ' + row.lastError;
    if (a === 'reply' && row.enabled) {
      const ch = (await q('waChats', ['lastDir', '==', 'in'])).filter((x) => x.aiAgent && x.aiAgent.handoff && Date.now() - (+x.aiAgent.at || 0) > 2 * 36e5 && (+x.lastInAt || 0) >= (+x.aiAgent.at || 0) - 60e3);
      if (ch.length) { row.handoffsWaiting = ch.length; row.problem = (row.problem ? row.problem + '. ' : '') + `${ch.length} שיחות שאדם העביר לאדם אמיתי מחכות לתשובה יותר משעתיים`; }
    }
    if (a === 'ads' || a === 'yield') { const r = (await q(a === 'ads' ? 'adReports' : 'yieldReports', ['at', '>', since])).sort((x, y) => y.at - x.at)[0]; if (r) row.lastHeadline = clip(r.headline, 160); }
    out.push(row);
  }
  return out;
}
async function writeDirection(a, hotels, today) {
  const text = clip(String(a.text || '').trim(), 400), hotel = hotels.some((h) => h.id === a.hotel) ? a.hotel : '';
  if (!text) return { error: 'empty' };
  const id = 'ops_' + today + '_' + a.agent + '_' + (hotel || 'chain');
  if (a.agent === 'ads') await db.doc('adNotes/' + id).set({ hotel, text: 'אליאנה (מנהלת האופרציה): ' + text, by: 'ops', byName: 'אליאנה · מנהלת האופרציה', at: Date.now() });
  else if (a.agent === 'yield') await db.doc('agentTasks/' + id).set({ to: 'yield', hotel, text, status: 'open', by: 'ops', byName: 'אליאנה · מנהלת האופרציה', at: Date.now(), until: C.addDays(today, 7) });
  else return { error: 'agent' };
  return { saved: id };
}

// ---------- the runs ----------
async function runMorning(cfg, today, only, force) {
  const hotels = (await loadHotels()).filter((h) => !only || h.id === only), done = [], chain = [], kb = await C.loadKB('ops');
  for (const hotel of hotels) {
    try {
      const { m, items, duty } = await hotelChecks(hotel, today, cfg, 'morning'), P = await people(hotel.id);
      const content = `Morning report for ${today} (${DOW[dowOf(today)]}).\nCHECKS (ranked, computed by the system):\n${JSON.stringify(items.map(({ key, ...x }) => x))}\n\nTHE DAY IN NUMBERS:\n${JSON.stringify(m)}`;
      const fb = codeReport(items, hotel.name);
      const w = items.length ? await writeWithModel(cfg.model || cfg.fastModel, systemOps(kb, hotel.name, 'morning'), content, [], fb) : { rep: fb };
      const pushed = await notify(hotel, items, P, duty, cfg, today, 'morning', force);
      await db.doc('opsReports/morning_' + hotel.id + '_' + today).set({ kind: 'morning', hotel: hotel.id, hotelName: hotel.name, date: today, ...w.rep, items: items.map(({ to, ...x }) => ({ ...x, to })), metrics: m, pushed, at: Date.now(), model: w.U ? cfg.model || cfg.fastModel : '', by: 'ai' });
      await log({ kind: 'morning', hotel: hotel.id, items: items.length, usage: w.U, stop: w.stop || '', error: w.error });
      chain.push({ hotel: hotel.id, name: hotel.name, high: items.filter((i) => i.sev === 'high').length, items: items.length, headline: w.rep.headline, tenDays: m.tenDays, events: (m.events || []).length, groups: (m.groups || []).length });
      done.push({ hotel: hotel.id, items: items.length });
    } catch (e) { console.error('ops morning', hotel.id, e); await log({ kind: 'morning', hotel: hotel.id, error: clip(e.message || e, 300) }); done.push({ hotel: hotel.id, error: true }); }
  }
  if (only) return done;
  // the chain: every hotel's status + the other agents' health; the only place directions to agents are given
  const health = cfg.supervise ? await agentsHealth(cfg) : [];
  let directions = 0; const given = [];
  const tools = cfg.supervise && cfg.maxDirections > 0 ? [{ ...DIRECT, run: async (a) => { if (directions >= cfg.maxDirections) return { error: 'limit reached' }; const r = await writeDirection(a, hotels, today); if (r.saved) { directions++; given.push({ agent: a.agent, hotel: a.hotel || '', text: clip(a.text, 400) }); } return r; } }] : [];
  const fb = { headline: chain.filter((c) => c.high).map((c) => `${c.name}: ${c.high} דחופים`).join(' · ') || 'כל המלונות נראים תקינים הבוקר', summary: chain.map((c) => `${c.name}: ${c.headline}`).join('\n'), priorities: [] };
  const content = `Chain morning summary for ${today}. HOTELS:\n${JSON.stringify(chain)}\n\nOTHER AGENTS (health, last 3 days):\n${JSON.stringify(health)}\n\n` + (tools.length ? `Give a direction to the ads agent or the yield agent ONLY when the 10days numbers or events clearly call for it (e.g. a hotel with very few check-ins next week → ads focus there; a date that fills up → yield should look at it). At most ${cfg.maxDirections}.` : 'Do not give directions to the other agents (turned off by the owner while they learn); only report their health.');
  const w = await writeWithModel(cfg.model || cfg.smartModel, systemOps(kb, 'the whole chain (owner)', 'morning'), content, tools, fb);
  const problems = health.filter((x) => x.problem);
  await db.doc('opsReports/morning_chain_' + today).set({ kind: 'morning', hotel: '', hotelName: 'כל הרשת', date: today, ...w.rep, hotels: chain, agents: health, directions: given, at: Date.now(), model: w.U ? cfg.model || cfg.smartModel : '', by: 'ai' });
  if (cfg.push && problems.length) { const own = await db.collection('pushTokens').where('owner', '==', true).get(); await sendPush(own.docs.map((d) => d.id), { title: 'אליאנה · בעיה בסוכן', body: clip(problems.map((p) => p.name + ': ' + p.problem).join('\n'), 400), hash: '#', tag: 'ops-agents-' + today }); }
  await log({ kind: 'morning', hotel: 'chain', directions: given.length, usage: w.U, stop: w.stop || '', error: w.error });
  return done;
}
async function runCheckin(cfg, today, only, force) {
  const done = [];
  for (const hotel of (await loadHotels()).filter((h) => !only || h.id === only)) {
    try {
      const { m, items, duty } = await hotelChecks(hotel, today, cfg, 'checkin');
      const pushed = await notify(hotel, items, await people(hotel.id), duty, cfg, today, 'checkin', force);
      await db.doc('opsReports/checkin_' + hotel.id + '_' + today).set({ kind: 'checkin', hotel: hotel.id, hotelName: hotel.name, date: today, ...codeReport(items, hotel.name), items, metrics: m, pushed, at: Date.now(), by: 'ai' });
      done.push({ hotel: hotel.id, items: items.length });
    } catch (e) { console.error('ops checkin', hotel.id, e); await log({ kind: 'checkin', hotel: hotel.id, error: clip(e.message || e, 300) }); done.push({ hotel: hotel.id, error: true }); }
  }
  return done;
}

// staffing draft for next week, from the 10days numbers (until a PMS is connected). Writes opsDrafts only; a person turns it into shifts.
// housekeeping is compared with the SUM of the day's shifts (one attendant cleans one share of the rooms); the other departments work per meal /
// per shift, so they are compared with the busiest single shift of the day.
// grp = {rooms, n}: group rooms arriving that day. Owner, Nov 12: at reception a group's check-in counts as ONE, however many rooms.
const PER_SHIFT = ['dining', 'kitchen', 'dishwash', 'reception'];
function suggest(day, ratio, cfg, grp) {
  const x = day || {}, ci = (+x.ci || 0) + (+x.cid || 0), co = +x.co || 0, bf = +x.bf || 0, dn = +x.dn || 0, rf = +x.rf || 0, out = {};
  const g = grp || { rooms: 0, n: 0 }, ciDesk = Math.max(0, ci - Math.min(ci, g.rooms)) + (g.rooms ? g.n : 0);
  const hkRooms = co + rf;
  if (day) out.housekeeping = { suggest: hkRooms ? Math.ceil(hkRooms / cfg.hkTarget) : 0, why: `${co} עזיבות + ${rf} רפרש = ${hkRooms} חדרים, ${cfg.hkTarget} לעובד` };
  const r = ratio || {};
  if (day && r.dining && (r.dining.bf || r.dining.dn)) out.dining = { suggest: Math.max(r.dining.bf ? Math.ceil(bf / r.dining.bf) : 0, r.dining.dn ? Math.ceil(dn / r.dining.dn) : 0), why: `${bf} ארוחות בוקר, ${dn} ארוחות ערב, ${r.dining.bf || r.dining.dn} סועדים למלצר` };
  if (day && r.kitchen && r.kitchen.covers) out.kitchen = { suggest: Math.ceil(Math.max(bf, dn) / r.kitchen.covers), why: `עד ${Math.max(bf, dn)} סועדים בארוחה, ${r.kitchen.covers} לטבח` };
  if (day && r.dishwash && r.dishwash.perMeal && (bf || dn)) out.dishwash = { suggest: +r.dishwash.perMeal, why: `${r.dishwash.perMeal} לכל ארוחה` };
  if (day && r.reception && r.reception.upTo) out.reception = { suggest: ciDesk > r.reception.upTo ? +r.reception.high || 2 : +r.reception.low || 1, why: `${ciDesk} צ׳ק אין לדלפק${g.n && g.rooms ? ` (${g.n} קבוצות נספרות כאחד)` : ''}, עד ${r.reception.upTo}: ${+r.reception.low || 1}, מעל: ${+r.reception.high || 2}` };
  return { demand: { ci, ciDesk, co, bf, dn, rf, groupRooms: g.rooms }, depts: out };
}
async function runWeekly(cfg, today, only) {
  const nw = C.addDays(C.weekOf(today), 7), dates = Array.from({ length: 7 }, (_, i) => C.addDays(nw, i)), done = [], kb = await C.loadKB('ops');
  for (const hotel of (await loadHotels()).filter((h) => !only || h.id === only)) {
    try {
      const h = hotel.id, TD = await tenDays(h, nw, 7), st = await staffing(h, dates), ratio = (cfg.ratios || {})[h] || (cfg.ratios || {}).default || null;
      const days = {}, changes = [], missing = dates.filter((d) => !TD[d]);
      const ev = await q('quotes', ['event.date', 'in', dates]), venues = (((await docData('settings/' + h)) || {}).venues) || [];
      const G = (await q('groups', ['hotel', '==', h])).filter((g) => ['confirmed', 'option'].includes(g.status) && dates.includes(g.ci));
      for (const d of dates) {
        const gd = G.filter((g) => g.ci === d), grp = { n: gd.length, rooms: gd.reduce((a, g) => a + (+g.rooms || Math.ceil((+g.pax || 0) / (+g.ppr || 2))), 0) };
        const s = suggest(TD[d], ratio, cfg, grp), opened = {};
        for (const x of st.filter((y) => y.date === d)) opened[x.dept] = PER_SHIFT.includes(x.dept) ? Math.max(opened[x.dept] || 0, x.need) : (opened[x.dept] || 0) + x.need;
        const evG = ev.filter((x) => (x.status === 'approved' || x.kind === 'group') && venues.includes((x.event || {}).venue) && x.event.date === d).reduce((a, x) => a + (+x.event.guests || 0), 0);
        for (const [dept, v] of Object.entries(s.depts)) { v.opened = opened[dept] || 0; v.diff = v.suggest - v.opened; if (v.diff !== 0 && (v.suggest || v.opened)) changes.push({ date: d, dept, ...v }); }
        days[d] = { ...s, events: evG, opened };
      }
      const draft = { hotel: h, hotelName: hotel.name, week: nw, status: 'draft', basis: '10days', days, changes, missingTenDays: missing, ratiosSet: !!ratio, hkTarget: cfg.hkTarget, at: Date.now(), by: 'ai' };
      const fb = { headline: missing.length === 7 ? 'אין מספרי 10days לשבוע הבא, ולכן אין טיוטה' : changes.length ? `${changes.length} שינויים מוצעים במשמרות של השבוע הבא` : 'המשמרות שנפתחו לשבוע הבא מתאימות למספרים', summary: '', priorities: [] };
      const w = missing.length === 7 ? { rep: fb } : await writeWithModel(cfg.model || cfg.smartModel, systemOps(kb, hotel.name, 'weekly'), `Staffing draft for the week starting ${nw}. It is a DRAFT: managers decide. Basis: the 10days numbers reception entered (no PMS yet).\n${JSON.stringify({ changes, missingTenDays: missing, ratiosSet: !!ratio, days })}`, [], fb);
      await db.doc('opsDrafts/' + h + '_' + nw).set({ ...draft, ...w.rep });
      if (cfg.push && changes.length) {
        const P = await people(h), depts = [...new Set(changes.map((c) => c.dept))];
        await sendPush(route(['gm', 'sched', ...depts.map((d) => 'dept:' + d)], P, []), { title: `${hotel.name} · טיוטת משמרות לשבוע הבא`, body: clip(depts.map((d) => `${DEPT[d]}: ${changes.filter((c) => c.dept === d).map((c) => `${DOW[dowOf(c.date)]} ${c.diff > 0 ? '+' : ''}${c.diff}`).join(', ')}`).join('\n') + '\nזו הצעה בלבד. ההחלטה שלכם.', 400), hash: '#shifts', tag: 'opsdraft-' + h + '-' + nw });
      } else if (cfg.push && missing.length) await sendPush(route(['reception', 'gm'], await people(h), []), { title: `${hotel.name} · חסרים מספרי 10days לשבוע הבא`, body: `בלי צ׳ק אין, צ׳ק אאוט וארוחות ל-${missing.length} ימים אי אפשר לתכנן את המשמרות. לעדכן בעמוד הקבלה.`, hash: '#front', tag: 'opsdraft-miss-' + h + '-' + nw });
      await log({ kind: 'weekly', hotel: h, changes: changes.length, usage: w.U, stop: w.stop || '', error: w.error });
      done.push({ hotel: h, changes: changes.length, missing: missing.length });
    } catch (e) { console.error('ops weekly', hotel.id, e); await log({ kind: 'weekly', hotel: hotel.id, error: clip(e.message || e, 300) }); done.push({ hotel: hotel.id, error: true }); }
  }
  return done;
}
// every 5 minutes, code only (owner, Nov 12): a housekeeping call open > callMins; a fault in a room with a check-in today open > arrivalFaultHours;
// a chat Adam handed to a person and nobody answered (1 h in working hours, 2 h after the day starts when it came at night). Once per item.
const ilEpoch = (date, hh) => { const g = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), hh), off = ilHour(g) - hh; return g - (((off + 36) % 24) - 12) * 36e5; };
function handoffDue(at, cfg) {
  const hr = ilHour(at), d = C.ilDate(new Date(at));
  if (hr >= cfg.quietTo && hr < cfg.quietFrom) return at + cfg.handoffMins * 60e3;
  const start = ilEpoch(hr >= cfg.quietFrom ? C.addDays(d, 1) : d, cfg.quietTo); // the next working day starts at quietTo
  return start + cfg.handoffMorningMins * 60e3;
}
async function runWatch(cfg) {
  const now = Date.now(), hr = ilHour(now); if (!cfg.push || cfg.watch === false || hr >= cfg.quietFrom || hr < cfg.quietTo) return { quiet: true };
  const today = C.ilDate(new Date(now)), sref = db.doc('opsWatch/' + today), sent = new Set(((await sref.get()).data() || {}).keys || []), fresh = [];
  const H = {}, ctx = async (h) => { if (!H[h]) { const st = await staffing(h, [today]); H[h] = { P: await people(h), duty: [...new Set(st.filter((s) => s.dept === 'ops').flatMap((s) => s.who))], name: (((await docData('hotels/' + h)) || {}).name) || h, hk: null }; } return H[h]; };
  const hkOf = async (h) => { const c = await ctx(h); if (!c.hk) { const day = ((await docData('hkday/' + h)) || {}).date || today; c.hk = (await docData('hk/' + h + '__' + day)) || {}; } return c.hk; };
  const fire = async (key, h, to, title, body, hash, extra) => { if (sent.has(key)) return; const c = await ctx(h); await sendPush([...route(to, c.P, c.duty), ...(extra || [])], { title: c.name + ' · ' + title, body: clip(body, 300), hash, tag: 'opsw-' + key }); sent.add(key); fresh.push(key); };
  for (const c of await q('hkCalls', ['status', '==', 'open'])) {
    const mins = Math.round((now - (+c.openedAt || now)) / 60e3); if (mins < cfg.callMins || !c.hotel) continue;
    await fire('call_' + c.id, c.hotel, ['dept:housekeeping', 'duty'], `⏱ קריאה למשק פתוחה ${mins} דקות`, `חדר ${c.room || '?'}${c.toName ? ' · ' + c.toName : ''}. צריך לסגור תוך 30 דקות.`, '#hk', [c.to]);
  }
  for (const f of await q('faults', ['status', '==', 'open'])) {
    const room = String(f.room || '').trim(), hrs = (now - (+f.openedAt || now)) / 36e5; if (!room || !f.hotel || hrs < cfg.arrivalFaultHours) continue;
    if (!occL(((await hkOf(f.hotel)).occ || {})[room]).includes('res')) continue;
    await fire('fault_' + f.id, f.hotel, ['dept:maintenance', 'duty', 'gm'], `🔧 תקלה בחדר ${room} עם צ׳ק אין היום`, `פתוחה ${Math.floor(hrs)} שעות: ${clip(f.desc, 80)}. חייב להיות מוכן לפני 16:00.`, '#maint');
  }
  if ((cfg.agents || []).includes('reply') && ((await docData('agentcfg/reply')) || {}).enabled === true) {
    for (const ch of await q('waChats', ['lastDir', '==', 'in'])) {
      const a = ch.aiAgent || {}; if (!a.handoff || !a.at || (+ch.lastInAt || 0) < a.at - 60e3 || now < handoffDue(a.at, cfg)) continue;
      const key = 'handoff_' + ch.id + '_' + a.at; if (sent.has(key)) continue;
      let to = ch.agent ? [ch.agent] : [];
      if (!to.length) (await db.collection('roles').get()).forEach((d) => { const r = d.data() || {}; if (!r.station && r.apps && r.apps.events) to.push(d.id); });
      await sendPush(to, { title: '💬 לקוח מחכה לתשובה', body: clip(`${ch.name || ch.phone || ''}: אדם העביר את השיחה לנציג ואף אחד עוד לא ענה.${a.reason ? ' ' + a.reason : ''}`, 300), hash: '#leads?wa=' + ch.id, tag: 'opsw-' + key });
      sent.add(key); fresh.push(key);
    }
  }
  if (fresh.length) await sref.set({ keys: [...sent].slice(-500), at: now });
  return { sent: fresh.length };
}
async function runAll(kind, opt = {}) {
  const cfg = { ...DEFAULTS, ...(await C.cfg('ops')) };
  if (cfg.enabled !== true || (!opt.force && cfg[kind] === false)) return [];
  if (opt.push === false) cfg.push = false;
  const today = C.ilDate(new Date());
  if (kind === 'watch') return runWatch(cfg);
  if (kind === 'checkin') return runCheckin(cfg, today, opt.hotel, opt.force);
  if (kind === 'weekly') return runWeekly(cfg, today, opt.hotel);
  return runMorning(cfg, today, opt.hotel, opt.force);
}
const sched = (cron, kind) => functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '512MB' }).pubsub.schedule(cron).timeZone('Asia/Jerusalem').onRun(async () => { await runAll(kind); return null; });
exports.opsMorning = sched('15 7 * * *', 'morning');
exports.opsCheckin = sched('0 14 * * *', 'checkin'); // check-in is at 16:00 (owner, Nov 12): two hours to fix what is not ready
exports.opsWeekly = sched('0 8 * * 0', 'weekly'); // Sunday: availability for next week opens today, so the draft must be ready (owner, Nov 12)
exports.opsWatch = functions.region(REGION).runWith({ timeoutSeconds: 120 }).pubsub.schedule('every 5 minutes').timeZone('Asia/Jerusalem').onRun(async () => { await runAll('watch'); return null; });
// owner only: run now. POST {kind, hotel?, push?:false}. Needs public invoker like adsRunNow (the owner's token is checked inside).
exports.opsRunNow = functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '512MB' }).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  const who = await C.ownerOnly(req); if (!who) { res.status(403).json({ error: 'owner only' }); return; }
  let b = {}; try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) { }
  const kind = ['checkin', 'weekly'].includes(b.kind) ? b.kind : 'morning';
  try { res.json({ ok: true, done: await runAll(kind, { force: true, hotel: String(b.hotel || ''), push: b.push !== false }) }); } catch (e) { console.error('opsRunNow', e); res.status(500).json({ error: 'failed' }); }
});
// admin-started run: opsJobs/{id} {kind, push?} created by functions/ops-run.js (clients cannot write opsJobs: no rules match)
exports.opsJob = functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '512MB' }).firestore.document('opsJobs/{id}').onCreate(async (snap) => {
  const j = snap.data() || {}, kind = ['checkin', 'weekly'].includes(j.kind) ? j.kind : 'morning';
  try { const done = await runAll(kind, { force: true, hotel: String(j.hotel || ''), push: j.push === true }); await snap.ref.set({ status: 'done', done, doneAt: Date.now() }, { merge: true }); }
  catch (e) { console.error('opsJob', e); await snap.ref.set({ status: 'error', error: clip(e.message || e, 300) }, { merge: true }); }
  return null;
});

exports._t = { handoffDue, ilEpoch, runWatch, staffing, tenDays, people, route, hotelChecks, notify, suggest, codeReport, agentsHealth, writeDirection, runAll, DEFAULTS };
