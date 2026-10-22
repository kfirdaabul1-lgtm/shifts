// Seven Collection: push notifications to phones (Firebase Cloud Messaging).
// Each trigger finds who should know about a change and sends to the devices saved in pushTokens/{uid}.
// 1st-gen Firestore triggers: they work whatever region the database is in.
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const REGION = 'europe-west1';
const APP = 'https://kfirdaabul1-lgtm.github.io/shifts/';
const DEPT = { ops: 'תפעול', reception: 'קבלה', housekeeping: 'משק', public: 'שטחים ציבוריים', maintenance: 'אחזקה', kitchen: 'מטבח', dining: 'חדר אוכל', bar: 'בר', dishwash: 'שוטף כלים', laundry: 'מכבסה' };
const trig = (path) => functions.region(REGION).firestore.document(path);

// ---------- who gets it ----------
async function hotelName(h) { try { const d = await db.doc('hotels/' + h).get(); return (d.exists && d.data().name) || ''; } catch (e) { return ''; } }
// people whose role covers this hotel with one of the given apps (hotels empty = all hotels); the owner always
async function roleHolders(hotel, apps, dept) {
  const out = new Set();
  const rs = await db.collection('roles').get();
  rs.forEach((d) => {
    const r = d.data() || {}; if (r.station) return;
    const a = r.apps || { shifts: true }, hs = r.hotels || [];
    if (hs.length && !hs.includes(hotel)) return;
    if (apps.some((k) => a[k])) out.add(d.id);
    else if (dept && a.dept && (r.depts || []).includes(dept)) out.add(d.id);
  });
  const own = await db.collection('pushTokens').where('owner', '==', true).get();
  own.forEach((d) => out.add(d.id));
  return [...out];
}
const managersOf = (hotel, dept) => roleHolders(hotel, ['shifts'], dept);

// ---------- sending ----------
async function sendTo(uids, msg) {
  uids = [...new Set(uids.filter(Boolean))]; if (!uids.length) return;
  const docs = await Promise.all(uids.map((u) => db.doc('pushTokens/' + u).get()));
  const tokens = [], owner = {};
  docs.forEach((d) => { if (!d.exists) return; Object.keys(d.data().tokens || {}).forEach((t) => { tokens.push(t); owner[t] = d.id; }); });
  if (!tokens.length) return;
  const data = { title: msg.title || 'Seven Collection', body: msg.body || '', url: APP + (msg.hash || ''), tag: msg.tag || '' };
  for (let i = 0; i < tokens.length; i += 500) {
    const part = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({ tokens: part, data, webpush: { headers: { Urgency: 'high', TTL: '86400' } } });
    // forget devices that unsubscribed or reinstalled
    const dead = [];
    res.responses.forEach((r, j) => { const c = r.error && r.error.code; if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-registration-token' || c === 'messaging/invalid-argument') dead.push(part[j]); });
    await Promise.all(dead.map((t) => db.doc('pushTokens/' + owner[t]).update({ ['tokens.' + t]: admin.firestore.FieldValue.delete() }).catch(() => {})));
  }
}

// ---------- requests: manager ↔ employee, and swaps between employees ----------
const ename = async (u) => { try { const d = await db.doc('employees/' + u).get(); return (d.exists && d.data().name) || 'עובד'; } catch (e) { return 'עובד'; } };
exports.onRequest = trig('requests/{id}').onWrite(async (ch) => {
  const b = ch.before.exists ? ch.before.data() : null, a = ch.after.exists ? ch.after.data() : null;
  if (!a) return;
  const was = b ? b.status : null, now = a.status;
  if (was === now) return;
  if (a.type === 'swap') {
    if (now === 'peer') return sendTo([a.peer], { title: 'בקשת החלפה', body: `${await ename(a.uid)} מבקש/ת להתחלף איתך: ${a.fromDesc || ''}`, hash: '#mine', tag: 'sw-' + ch.after.id });
    if (now === 'mgr') return sendTo(await managersOf(a.hotel), { title: 'החלפה מחכה לאישורך', body: `${await ename(a.uid)} ↔ ${await ename(a.peer)} · ${a.fromDesc || ''}`, hash: '', tag: 'sw-' + ch.after.id });
    if (now === 'approved') return sendTo([a.uid, a.peer], { title: 'ההחלפה אושרה ✓', body: a.fromDesc || '', hash: '#mine', tag: 'sw-' + ch.after.id });
    if (now === 'declined') return sendTo([was === 'peer' ? a.uid : a.uid, a.peer].filter((u, i) => was === 'peer' ? i === 0 : true), { title: 'בקשת ההחלפה נדחתה', body: a.fromDesc || '', hash: '#mine', tag: 'sw-' + ch.after.id });
    return;
  }
  if (now === 'pending' && !b) return sendTo([a.uid], { title: 'בקשה מהמנהל', body: 'יש לך בקשה לשינוי משמרת. נא לאשר או לדחות.', hash: '#mine', tag: 'rq-' + ch.after.id });
  if (was === 'pending' && (now === 'approved' || now === 'declined'))
    return sendTo(await managersOf(a.hotel), { title: now === 'approved' ? 'העובד אישר את השינוי' : 'העובד דחה את השינוי', body: `${await ename(a.uid)} · ${a.fromDesc || a.toDesc || ''}`, tag: 'rq-' + ch.after.id });
});

// ---------- schedule published → every employee of the hotel ----------
exports.onSchedule = trig('schedule/{id}').onWrite(async (ch, ctx) => {
  const b = ch.before.exists ? ch.before.data() : {}, a = ch.after.exists ? ch.after.data() : null;
  if (!a || !a.published || b.published) return;
  const id = ctx.params.id, parts = id.split('_'), week = parts[0], hotel = parts[1] || 'main';
  const emps = await db.collection('employees').where('hotel', '==', hotel).get();
  const [y, m, d] = week.split('-');
  return sendTo(emps.docs.map((x) => x.id), { title: 'הסידור פורסם', body: `הסידור של ${await hotelName(hotel)} לשבוע ${+d}.${+m} פורסם. אפשר לראות את המשמרות שלך.`, hash: '#mine', tag: 'pub-' + id });
});

// ---------- shift report → finance + hotel managers ----------
exports.onShiftReport = trig('shiftReports/{id}').onCreate(async (snap) => {
  const r = snap.data() || {};
  const to = await roleHolders(r.hotel, ['fin', 'gm']);
  const gap = r.gap ? ` · פער ${r.gap}₪` : '';
  return sendTo(to, { title: 'דוח סוף משמרת חדש', body: `${await hotelName(r.hotel)} · ${r.name || ''}${r.unusual ? ' · ⚠ אירוע חריג' : ''}${gap}`, hash: '#fin', tag: 'sr-' + snap.id });
});

// ---------- purchase request → hotel managers ----------
exports.onPurchaseReq = trig('purchaseReqs/{id}').onCreate(async (snap) => {
  const r = snap.data() || {}; if (r.status !== 'pending') return;
  return sendTo(await roleHolders(r.hotel, ['gm', 'shifts']), { title: 'דרישת רכש חדשה', body: `${r.itemName || ''} · ${r.qty || ''} ${r.unit || ''} · ${DEPT[r.dept] || ''}`, hash: '#stock', tag: 'pr-' + snap.id });
});

// ---------- new fault → maintenance + hotel managers ----------
// reception desk accounts (roles with station: true) of a hotel
async function stationsOf(hotel) {
  const rs = await db.collection('roles').where('station', '==', true).get();
  return rs.docs.filter((d) => (d.data().hotels || []).includes(hotel)).map((d) => d.id);
}
exports.onFault = trig('faults/{id}').onCreate(async (snap) => {
  const f = snap.data() || {};
  const st = (await stationsOf(f.hotel)).filter((u) => u !== f.openedBy);
  if (st.length) await sendTo(st, { title: 'נפתחה תקלה', body: `${f.room ? 'חדר ' + f.room + ' · ' : ''}${f.desc || ''}${f.openedByName ? ' · ' + f.openedByName : ''}`, hash: '#front', tag: 'ft-' + snap.id });
  return sendTo(await roleHolders(f.hotel, ['maint', 'gm', 'shifts'], 'maintenance'), { title: 'תקלה חדשה', body: `${f.room ? 'חדר ' + f.room + ' · ' : ''}${f.desc || ''} · ${await hotelName(f.hotel)}`, hash: '#maint', tag: 'ft-' + snap.id });
});

// ---------- stock item reached its minimum → hotel managers ----------
exports.onStock = trig('inventory/{id}').onWrite(async (ch) => {
  const b = ch.before.exists ? ch.before.data() : null, a = ch.after.exists ? ch.after.data() : null;
  if (!a) return;
  const low = (x) => x && +x.min > 0 && (+x.qty || 0) <= +x.min;
  if (!low(a) || low(b)) return;
  return sendTo(await roleHolders(a.hotel, ['gm', 'shifts'], a.dept), { title: 'פריט הגיע למינימום', body: `${a.name || ''} · נשארו ${+a.qty || 0}${a.unit ? ' ' + a.unit : ''} (מינימום ${+a.min})`, hash: '#stock', tag: 'st-' + ch.after.id });
});

// ---------- daily backup to the owner's Google Drive ----------
// A small Google Apps Script in the owner's own Drive calls this once a day with the key stored in backupcfg/main
// (only the owner can read or change it) and saves the JSON it gets into a Drive folder. Same format as the
// "גיבוי" button on the Permissions page, so the Import card can restore it. Invoice images are left out (size).
const BACKUP_COLLS = ['jobRoles', 'vchCodes', 'hkday', 'faultsAck', 'srDrafts', 'vchcfg', 'hotels', 'settings', 'employees', 'mgr', 'avail', 'shifts', 'schedule', 'requests', 'roles', 'joinCodes', 'config', 'menus', 'contracts', 'quotes', 'campaigns', 'suppliers', 'invoices', 'expcfg', 'inventory', 'purchaseReqs', 'shiftReports', 'faults', 'hk', 'hkcfg', 'hkLog', 'hkComplaints', 'leads', 'tasks', 'clients', 'hkCalls', 'spa', 'spacfg', 'vouchers'];
const plain = (v) => {
  if (v instanceof admin.firestore.Timestamp) return { seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = plain(v[k]); return o; }
  return v;
};
exports.driveBackup = functions.region(REGION).runWith({ timeoutSeconds: 300, memory: '512MB' }).https.onRequest(async (req, res) => {
  try {
    const cfg = await db.doc('backupcfg/main').get(), key = cfg.exists ? String(cfg.data().key || '') : '';
    const got = String(req.query.key || req.get('x-backup-key') || '');
    if (!key || key.length < 24 || got !== key) { res.status(403).send('forbidden'); return; }
    const out = { exportedAt: new Date().toISOString(), by: 'auto-drive', collections: {} };
    let n = 0;
    for (const c of BACKUP_COLLS) {
      const q = await db.collection(c).get();
      out.collections[c] = q.docs.map((d) => ({ id: d.id, data: plain(d.data()) })); n += q.size;
      if (c === 'quotes') for (const d of q.docs) {
        const v = await d.ref.collection('versions').get();
        if (v.size) { out.collections['quotes/' + d.id + '/versions'] = v.docs.map((x) => ({ id: x.id, data: plain(x.data()) })); n += v.size; }
      }
    }
    await db.doc('backupcfg/main').set({ lastAt: Date.now(), lastCount: n }, { merge: true });
    res.set('Content-Type', 'application/json; charset=utf-8').status(200).send(JSON.stringify(out));
  } catch (e) { console.error('backup', e); res.status(500).send('error'); }
});

// ---------- shift reports without money, for the reception desk ----------
// Reception sees earlier shift reports of its hotel (handover), but not the amounts. Firestore rules can't hide fields,
// so every report is mirrored to shiftReportsPub/{id} without the cash/credit fields; deleting the report deletes the copy.
const PUB_KEYS = ['hotel', 'month', 'date', 'shift', 'name', 'empUid', 'ooo', 'faults', 'notes', 'lost', 'cmp', 'booking', 'arsona', 'ciLeft', 'coLeft', 'ci', 'co', 'cid', 'unusual', 'details', 'createdAt', 'by'];
exports.mirrorShiftReport = trig('shiftReports/{id}').onWrite(async (ch, ctx) => {
  const ref = db.doc('shiftReportsPub/' + ctx.params.id);
  if (!ch.after.exists) { await ref.delete().catch(() => {}); return; }
  const r = ch.after.data() || {}, out = {};
  for (const k of PUB_KEYS) if (r[k] !== undefined) out[k] = r[k];
  await ref.set(out);
});

// ---------- housekeeping: a worker assigned to rooms gets a push ----------
exports.onHkAssign = trig('hk/{id}').onWrite(async (ch) => {
  if (!ch.after.exists) return;
  const b = (ch.before.exists && ch.before.data().asg) || {}, a = ch.after.data() || {}, asg = a.asg || {};
  const grp = a.grp || {}, vip = a.vip || {}, bk = a.bk || {}, clean = a.clean || {}, pax = a.pax || {}, twin = a.twin || {}, cot = a.cot || {}, wine = a.wine || {}, bal = a.bal || {}, trt = a.trt || {}, pri = a.pri || {};
  const per = {};
  for (const [room, uid] of Object.entries(asg)) if (uid && b[room] !== uid) (per[uid] = per[uid] || []).push(room);
  // a refresh / full refresh added to a room that was already assigned → tell its worker too
  const bt = (ch.before.exists && ch.before.data().trt) || {}, trtNew = {};
  for (const [room, v] of Object.entries(a.trt || {})) if (v && bt[room] !== v && asg[room] && b[room] === asg[room]) (trtNew[asg[room]] = trtNew[asg[room]] || []).push(room);
  if (Object.keys(trtNew).length) {
    const hn0 = await hotelName(a.hotel);
    await Promise.all(Object.entries(trtNew).map(([u, rooms]) => sendTo([u], { title: 'Refresh לחדר', body: `${hn0 ? hn0 + ': ' : ''}` + rooms.map((r) => `חדר ${r}: ${a.trt[r] === 'full' ? 'Full refresh' : 'Refresh'}`).join(', '), hash: '#hk', tag: 'hktrt-' + u + '-' + rooms.join('-') })));
  }
  // a room marked "handle first" (pri) that is already assigned → tell its worker right away
  const bp = (ch.before.exists && ch.before.data().pri) || {}, priNew = {};
  for (const [room, v] of Object.entries(pri)) if (v && !bp[room] && asg[room] && b[room] === asg[room]) (priNew[asg[room]] = priNew[asg[room]] || []).push(room);
  if (Object.keys(priNew).length) {
    const hn1 = await hotelName(a.hotel);
    await Promise.all(Object.entries(priNew).map(([u, rooms]) => sendTo([u], { title: '❗ חדר דחוף · לטפל בו קודם', body: `${hn1 ? hn1 + ': ' : ''}` + rooms.map((r) => 'חדר ' + r).join(', ') + ' – חשוב לטפל לפני שאר החדרים', hash: '#hk', tag: 'hkpri-' + u + '-' + rooms.join('-') })));
  }
  const uids = Object.keys(per); if (!uids.length) return;
  const hn = await hotelName(a.hotel);
  await Promise.all(uids.map((u) => {
    const rooms = per[u].sort((x, y) => (!!pri[y] - !!pri[x]) || String(x).localeCompare(String(y), 'he', { numeric: true }));
    const txt = rooms.map((r) => r + (pri[r] ? ' ❗לטפל קודם' : '') + (vip[r] ? ' VIP' : '') + (bk[r] ? ' Booking' : '') + (grp[r] ? ' Group' : '') + (pax[r] ? ' ' + pax[r] + ' אורחים' : '') + (twin[r] ? ' Split bed' : '') + (trt[r] ? (trt[r] === 'full' ? ' Full refresh' : ' Refresh') : '') + (cot[r] ? ' Baby cot' : '') + (wine[r] ? ' יין' : '') + (bal[r] ? ' בלונים' : '') + (clean[r] === 'vd' ? ' (VD)' : '')).join(', ');
    return sendTo([u], { title: rooms.length > 1 ? `יש לך ${rooms.length} חדרים לסדר` : 'יש לך חדר לסדר', body: `${hn ? hn + ': ' : ''}חדר ${txt}`, hash: '#hk', tag: 'hk-' + u + '-' + a.date });
  }));
});

// ---------- housekeeping: clean rooms with no booking become VI the next day ----------
// Every night just after midnight (Israel time): a room that ended the day VC (or VI) and was not occupied / reserved
// (occ not oc or res) starts the new day as VI. The client does the same if this didn't run (flag `carried`).
const ilDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
async function hkCarry(h, today, yday) {
  const ys = await db.doc('hk/' + h + '__' + yday).get(); if (!ys.exists) return 0;
  const ref = db.doc('hk/' + h + '__' + today), ts = await ref.get(), td = ts.exists ? ts.data() : {};
  if (td.carried) return 0;
  const y = ys.data() || {}, yc = y.clean || {}, cur = td.clean || {}, now = Date.now();
  const o = { hotel: h, date: today, carried: true, updatedAt: now, clean: {}, cleanBy: {}, cleanAt: {} };
  let n = 0;
  for (const [r, c] of Object.entries(yc)) {
    // every room keeps yesterday's status; only VC (clean) becomes VI (clean since yesterday)
    if (c && !cur[r]) { o.clean[r] = c === 'vc' ? 'vi' : c === 'oc' ? 'od' : c; o.cleanBy[r] = 'אוטומטי'; o.cleanAt[r] = now; n++; }
  }
  // OD is a clean status now, so it is carried above with the others; occupancy marks reset
  await ref.set(o, { merge: true });
  return n;
}
// every day at 05:00 Israel time the housekeeping day changes automatically (owner's wish): carry the clean statuses
// (VC → VI, OD and the rest stay) from the board's current day to today and move hkday/{hotel} to today
exports.hkNightly = functions.region(REGION).pubsub.schedule('0 5 * * *').timeZone('Asia/Jerusalem').onRun(async () => {
  const today = ilDate(new Date());
  const hs = await db.collection('hotels').get();
  for (const d of hs.docs) {
    try {
      const ref = db.doc('hkday/' + d.id), cur = await ref.get(), from = (cur.exists && cur.data().date) || ilDate(new Date(Date.now() - 24 * 3600e3));
      if (from >= today) continue;
      const n = await hkCarry(d.id, today, from);
      await ref.set({ hotel: d.id, date: today, from, by: 'auto', byName: 'אוטומטי 05:00', at: Date.now() });
      console.log('hk day', d.id, from, '->', today, n);
    } catch (e) { console.error('hk day', d.id, e); }
  }
  return null;
});

// maintenance: a fault fixed → the hotel's reception desk
exports.onFaultDone = trig('faults/{id}').onUpdate(async (ch) => {
  const b = ch.before.data() || {}, a = ch.after.data() || {};
  if (a.status !== 'done' || b.status === 'done') return;
  const st = await stationsOf(a.hotel); if (!st.length) return;
  return sendTo(st, { title: 'תקלה תוקנה ✓', body: `${a.room ? 'חדר ' + a.room + ' · ' : ''}${a.desc || ''}`, hash: '#front', tag: 'ft-' + ch.after.id });
});

// housekeeping: every cleaning update (status or "started cleaning") → the hotel's reception desk, except its own changes
const HK_TXT = { vc: 'VC · חדר נקי', vi: 'VI · נקי מאתמול', vd: 'VD · חדר מלוכלך', od: 'OD · תפוס מלוכלך', oc: 'OC · תפוס נקי', ooo: 'OOO · תקלה תחזוקתית' };
exports.onHkUpdate = trig('hk/{id}').onWrite(async (ch) => {
  if (!ch.after.exists) return;
  const b = ch.before.exists ? ch.before.data() : {}, a = ch.after.data() || {};
  const st = (await stationsOf(a.hotel)).filter((u) => u !== a.lastBy); if (!st.length) return;
  const lines = [], bc = b.clean || {}, ac = a.clean || {}, bs = b.start || {}, as = a.start || {}, who = a.cleanBy || {};
  for (const [r, v] of Object.entries(ac)) if (bc[r] !== v && (who[r] || '') !== 'אוטומטי') lines.push(`חדר ${r}: ${HK_TXT[v] || v}${who[r] ? ' · ' + who[r] : ''}`);
  for (const [r, v] of Object.entries(as)) if (bs[r] !== v && !(ac[r] && bc[r] !== ac[r])) lines.push(`חדר ${r}: התחיל ניקיון${(a.asgName || {})[r] ? ' · ' + a.asgName[r] : ''}`);
  if (!lines.length) return;
  return sendTo(st, { title: 'עדכון משק', body: lines.slice(0, 6).join('\n'), hash: '#hk', tag: 'hku-' + a.hotel + '-' + (lines.length === 1 ? lines[0].split(':')[0] : Date.now()) });
});

// ---------- CRM: tasks and follow-ups ----------
// a task given to someone else → push now; every morning 08:30 (Israel) each person gets their tasks + leads to call back today
exports.onTask = trig('tasks/{id}').onCreate(async (snap) => {
  const t = snap.data() || {};
  if (!t.owner || t.owner === t.createdBy) return;
  return sendTo([t.owner], { title: 'משימה חדשה', body: `${t.title || ''}${t.due ? ' · עד ' + t.due.slice(8, 10) + '.' + t.due.slice(5, 7) : ''}${t.createdByName ? ' · מ' + t.createdByName : ''}`, hash: '#leads', tag: 'task-' + snap.id });
});
exports.crmMorning = functions.region(REGION).pubsub.schedule('30 8 * * *').timeZone('Asia/Jerusalem').onRun(async () => {
  const today = ilDate(new Date()), per = {};
  const add = (u, k) => { if (!u) return; (per[u] = per[u] || { tasks: 0, leads: 0, late: 0 })[k]++; };
  const ts = await db.collection('tasks').where('done', '==', false).get();
  ts.forEach((d) => { const t = d.data(); if (t.due && t.due <= today) { add(t.owner, 'tasks'); if (t.due < today) add(t.owner, 'late'); } });
  const ls = await db.collection('leads').get();
  ls.forEach((d) => { const l = d.data(); if (l.stage !== 'won' && l.stage !== 'lost' && l.nextAt && l.nextAt <= today) add(l.owner, 'leads'); });
  await Promise.all(Object.entries(per).map(([u, x]) => {
    const parts = [];
    if (x.tasks) parts.push(`${x.tasks} משימות${x.late ? ` (${x.late} באיחור)` : ''}`);
    if (x.leads) parts.push(`${x.leads} לידים לחזור אליהם`);
    return sendTo([u], { title: 'בוקר טוב · מה מחכה לך היום', body: parts.join(' · '), hash: '#leads', tag: 'crm-' + today });
  }));
});

// ---------- Meta (Facebook / Instagram): ad numbers → campaigns, lead-form leads → leads ----------
// metacfg/main {token (system-user token, owner only), adAccount, syncReq, leadsAt (unix secs), insAt, status:{...}}
// every 15 min: new leads from the pages' lead forms; every 3 h (and on "סנכרון עכשיו"): last 35 days of campaign numbers by week
const GRAPH = 'https://graph.facebook.com/v23.0/';
async function graph(path, token, params = {}) {
  const u = new URL(path.startsWith('http') ? path : GRAPH + path);
  if (!path.startsWith('http')) { for (const [k, v] of Object.entries(params)) u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v)); u.searchParams.set('access_token', token); }
  const r = await fetch(u.toString()); const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  return j;
}
async function graphAll(path, token, params, max = 20) {
  let j = await graph(path, token, params), out = j.data || [];
  for (let i = 0; i < max && j.paging && j.paging.next; i++) { j = await graph(j.paging.next, token); out = out.concat(j.data || []); }
  return out;
}
const isoAdd = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekOfISO = (iso) => isoAdd(iso, -new Date(iso + 'T12:00:00Z').getUTCDay());
const actVal = (acts, types) => { for (const t of types) { const a = (acts || []).find((x) => x.action_type === t); if (a) return Math.round(+a.value || 0); } return 0; };
async function metaInsights(cfg) {
  // one or more ad accounts (one per hotel's business portfolio), comma separated
  const accs = String(cfg.adAccount || '').split(/[^0-9]+/).filter(Boolean); if (!accs.length) return { campaigns: 0 };
  const until = ilDate(new Date()), since = weekOfISO(isoAdd(until, -35)), rows = [];
  for (const acc of accs) rows.push(...await graphAll('act_' + acc + '/insights', cfg.token, { level: 'campaign', time_increment: '1', time_range: { since, until }, fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions', limit: '500' }));
  const by = {};
  rows.forEach((r) => {
    const w = weekOfISO(r.date_start), k = r.campaign_id + '_' + w;
    const x = by[k] = by[k] || { name: r.campaign_name, metaId: r.campaign_id, week: w, spend: 0, impressions: 0, clicks: 0, leads: 0, msgs: 0 };
    x.name = r.campaign_name || x.name; x.spend += +r.spend || 0; x.impressions += +r.impressions || 0; x.clicks += +r.clicks || 0;
    x.leads += actVal(r.actions, ['lead', 'onsite_conversion.lead_grouped']);
    x.msgs += actVal(r.actions, ['onsite_conversion.messaging_conversation_started_7d']);
  });
  const b = db.batch(); let n = 0;
  for (const [k, x] of Object.entries(by)) {
    if (!x.spend && !x.leads && !x.impressions) continue;
    b.set(db.doc('campaigns/meta_' + k), { name: x.name, platform: 'meta', target: 'Meta Ads', week: x.week, start: x.week, end: isoAdd(x.week, 6), spend: Math.round(x.spend * 100) / 100, leads: x.leads, msgs: x.msgs, impressions: x.impressions, clicks: x.clicks, auto: 'meta', metaId: x.metaId, updatedAt: Date.now() }, { merge: true });
    n++;
  }
  if (n) await b.commit();
  return { campaigns: new Set(Object.values(by).map((x) => x.metaId)).size, reports: n };
}
// lead form answers → our lead fields; anything we don't recognise goes to notes
function metaLeadDoc(m, form, pageName) {
  const f = {}; (m.field_data || []).forEach((x) => { f[x.name] = (x.values || []).join(', '); });
  const pick = (re) => { const k = Object.keys(f).find((n) => re.test(n)); if (!k) return ''; const v = f[k]; delete f[k]; return v; };
  let name = pick(/^(full_?name|name|שם מלא|שם)$/i);
  if (!name) { const a = pick(/^first_?name$/i), z = pick(/^last_?name$/i); name = (a + ' ' + z).trim(); }
  const type = pick(/^(event_?type|type)$|סוג/i);
  let phone = pick(/phone|טלפון|נייד/i); phone = phone.replace(/[\s-]/g, '').replace(/^\+?972/, '0');
  const email = pick(/e-?mail|מייל|דוא/i), company = pick(/company|חברה|ארגון/i);
  let date = pick(/date|תאריך/i), guests = pick(/guest|people|attend|אורח|משתתפ|כמות|מספר/i);
  const notes = [];
  const di = date.match(/(\d{4})-(\d{1,2})-(\d{1,2})/) || null, dl = date.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/) || null;
  let dISO = '';
  if (di) dISO = `${di[1]}-${di[2].padStart(2, '0')}-${di[3].padStart(2, '0')}`;
  else if (dl) dISO = `${dl[3].length === 2 ? '20' + dl[3] : dl[3]}-${dl[2].padStart(2, '0')}-${dl[1].padStart(2, '0')}`;
  if (date && !dISO) notes.push('תאריך: ' + date);
  const g = parseInt(String(guests).replace(/[^\d]/g, ''), 10); if (guests && !g) notes.push('אורחים: ' + guests);
  Object.entries(f).forEach(([k, v]) => notes.push(k.replace(/_/g, ' ') + ': ' + v));
  const now = Date.now(), plat = String(m.platform || '').toLowerCase() === 'ig' ? 'instagram' : 'facebook';
  return {
    name: name || 'ליד מ-' + (plat === 'instagram' ? 'אינסטגרם' : 'פייסבוק'), phone, email, company, type, date: dISO, guests: g || 0, venue: '',
    source: plat, campaign: m.campaign_name || '', stage: 'new', owner: '', ownerName: '', nextAt: ilDate(new Date()), value: 0, notes: notes.join('\n'), lostReason: '',
    acts: [{ at: now, by: 'meta', byName: 'Meta', kind: 'note', text: `נכנס אוטומטית מטופס "${form.name || ''}"${pageName ? ' · ' + pageName : ''}${m.ad_name ? ' · מודעה: ' + m.ad_name : ''}` }],
    metaLeadId: m.id, metaForm: form.id, createdAt: m.created_time ? Date.parse(m.created_time) || now : now, createdBy: 'meta', updatedAt: now,
  };
}
// quote validity: createdAt + validDays. Two days before it ends, remind everyone with the events app (09:00 Israel).
exports.quoteExpiry = functions.region(REGION).pubsub.schedule('0 9 * * *').timeZone('Asia/Jerusalem').onRun(async () => {
  const today = ilDate(new Date()), target = isoAdd(today, 2);
  const qs = await db.collection('quotes').get(), due = [];
  qs.forEach((d) => {
    const q = d.data() || {};
    if (q.kind === 'group' || q.status === 'approved' || q.status === 'declined') return;
    const c = String(q.createdAt || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(c)) return;
    const vd = Number(q.validDays) || 14;
    if (isoAdd(c, vd) === target) due.push({ id: d.id, ...q });
  });
  if (!due.length) return null;
  const people = await eventsPeople();
  const dm = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');
  await Promise.all(due.map((q) => sendTo(people, {
    title: `הצעה #${q.num || ''} פגה בעוד יומיים`,
    body: `${(q.client && q.client.name) || 'ללא שם'}${q.event && q.event.date ? ' · אירוע ' + dm(q.event.date) : ''} · ההצעה בתוקף עד ${dm(target)}. כדאי לחזור ללקוח.`,
    hash: 'events.html#q=' + q.id, tag: 'qexp-' + q.id,
  })));
  return null;
});
async function eventsPeople() {
  const out = new Set(), rs = await db.collection('roles').get();
  rs.forEach((d) => { const r = d.data() || {}; if (!r.station && r.apps && r.apps.events) out.add(d.id); });
  const own = await db.collection('pushTokens').where('owner', '==', true).get(); own.forEach((d) => out.add(d.id));
  return [...out];
}
async function metaLeads(cfg) {
  const since = cfg.leadsAt || Math.floor(Date.now() / 1000) - 30 * 86400, started = Math.floor(Date.now() / 1000);
  const pages = await graphAll('me/accounts', cfg.token, { fields: 'id,name,access_token', limit: '100' });
  let forms = 0; const fresh = [];
  for (const p of pages) {
    const pt = p.access_token || cfg.token;
    let fl = []; try { fl = await graphAll(p.id + '/leadgen_forms', pt, { fields: 'id,name', limit: '100' }); } catch (e) { continue; }
    forms += fl.length;
    for (const form of fl) {
      const ls = await graphAll(form.id + '/leads', pt, { fields: 'id,created_time,field_data,campaign_name,ad_name,platform', filtering: [{ field: 'time_created', operator: 'GREATER_THAN', value: since - 600 }], limit: '100' });
      for (const m of ls) {
        const ref = db.doc('leads/meta_' + m.id);
        try { const doc = metaLeadDoc(m, form, p.name); await ref.create(doc); fresh.push(doc); } catch (e) { /* already in */ }
      }
    }
  }
  if (fresh.length) {
    const who = await eventsPeople();
    await sendTo(who, { title: fresh.length === 1 ? 'ליד חדש מ-Meta' : `${fresh.length} לידים חדשים מ-Meta`, body: fresh.slice(0, 3).map((l) => l.name + (l.campaign ? ' · ' + l.campaign : '')).join(' | '), hash: '#leads', tag: 'meta-leads' });
  }
  return { pages: pages.map((p) => p.name), forms, newLeads: fresh.length, leadsAt: started };
}
// every connection (one per hotel's business portfolio) runs on its own; legacy single token = connection 'main'
function metaConnList(cfg) {
  const out = { ...(cfg.conns || {}) };
  if (cfg.token && !out.main) out.main = { name: 'חיבור 1', token: cfg.token, adAccount: cfg.adAccount || '' };
  return Object.entries(out).filter(([, x]) => x && x.token);
}
async function metaRunOne(cfg, id, conn, full) {
  const rt = (cfg.cst && cfg.cst[id]) || (id === 'main' ? { status: cfg.status, leadsAt: cfg.leadsAt, insAt: cfg.insAt } : {}) || {};
  const prev = rt.status || {}, st = { ...prev, at: Date.now(), ok: true, err: '', leadErr: '', insErr: '' }, out = { leadsAt: rt.leadsAt || 0, insAt: rt.insAt || 0 };
  const c = { token: conn.token, adAccount: conn.adAccount, leadsAt: rt.leadsAt };
  try { const me = await graph('me', c.token, { fields: 'id,name' }); st.user = me.name || me.id; }
  catch (e) { st.ok = false; st.err = String(e.message || e); return { ...out, status: st }; }
  try { const r = await metaLeads(c); st.pages = r.pages; st.forms = r.forms; st.newLeads = r.newLeads; st.leadsTotal = (prev.leadsTotal || 0) + r.newLeads; out.leadsAt = r.leadsAt; }
  catch (e) { st.leadErr = String(e.message || e); }
  if (full || !rt.insAt || Date.now() - rt.insAt > 3 * 3600e3) {
    try { const r = await metaInsights(c); st.campaigns = r.campaigns; st.reports = r.reports; }
    catch (e) { st.insErr = String(e.message || e); }
    out.insAt = Date.now();
  }
  st.ok = !st.leadErr && !st.insErr;
  return { ...out, status: st };
}
async function metaRun(full) {
  const ref = db.doc('metacfg/main'), s = await ref.get(); if (!s.exists) return;
  const cfg = s.data() || {}, list = metaConnList(cfg); if (!list.length) return;
  const cst = {};
  for (const [id, conn] of list) { try { cst[id] = await metaRunOne(cfg, id, conn, full); } catch (e) { cst[id] = { status: { at: Date.now(), ok: false, err: String(e.message || e) } }; } }
  await ref.set({ cst }, { merge: true });
}
exports.metaPoll = functions.region(REGION).runWith({ timeoutSeconds: 540 }).pubsub.schedule('every 15 minutes').onRun(() => metaRun(false));
exports.onMetaCfg = functions.region(REGION).runWith({ timeoutSeconds: 540 }).firestore.document('metacfg/main').onWrite(async (ch) => {
  const a = ch.before.exists ? ch.before.data() : {}, b = ch.after.exists ? ch.after.data() : null;
  if (!b) return;
  const key = (x) => JSON.stringify([x.token || '', x.adAccount || '', x.syncReq || 0, Object.entries(x.conns || {}).map(([k, v]) => [k, v && v.token, v && v.adAccount]).sort()]);
  if (key(a) === key(b)) return; // our own status writes
  return metaRun(true);
});

// ---------- watch the daily Drive backup: if it hasn't run for 30 hours, tell the owner (09:15 Israel) ----------
exports.backupWatch = functions.region(REGION).pubsub.schedule('15 9 * * *').timeZone('Asia/Jerusalem').onRun(async () => {
  const d = await db.doc('backupcfg/main').get(); if (!d.exists) return;
  const c = d.data() || {}; if (!c.key) return;
  const since = Math.max(c.lastAt || 0, c.createdAt || 0);
  if (Date.now() - since < 30 * 3600e3) return;
  const own = await db.collection('pushTokens').where('owner', '==', true).get();
  return sendTo(own.docs.map((x) => x.id), { title: 'הגיבוי האוטומטי לא רץ', body: c.lastAt ? 'הגיבוי האחרון לדרייב היה לפני יותר מיום. כדאי לבדוק ב-script.google.com ← Executions.' : 'עוד לא נשמר אף גיבוי אוטומטי לדרייב. כדאי לבדוק את ההגדרה בעמוד הגדרות מלון.', hash: '#cfg', tag: 'backup-watch' });
});

// ---------- reception → housekeeping calls ----------
// new call → push to the worker it was sent to; done → push to the hotel's reception desks + whoever opened it
exports.onHkCall = trig('hkCalls/{id}').onWrite(async (ch, ctx) => {
  const a = ch.before.exists ? ch.before.data() : null, b = ch.after.exists ? ch.after.data() : null;
  if (!b) return;
  const what = HK_CALL_TXT(b), where = b.kind === 'pub' ? (b.area || 'שטח ציבורי') : 'חדר ' + (b.room || '');
  if (!a && b.status === 'open' && b.to) {
    return sendTo([b.to], { title: b.kind === 'pub' ? `קריאת שטחים ציבוריים · ${where}` : `קריאה למשק · ${where}`, body: what + (b.openedByName ? ` · מ${b.openedByName}` : ''), hash: '', tag: 'call-' + ctx.params.id });
  }
  if (a && a.status !== 'done' && b.status === 'done') {
    const st = await stationsOf(b.hotel);
    return sendTo([...st, b.openedBy].filter((u) => u && u !== b.to), { title: `${where} · הקריאה טופלה`, body: `${b.toName || 'העובד'} · ${what}${b.mins != null ? ` · אחרי ${b.mins} דק׳` : ''}`, hash: '#front', tag: 'calldone-' + ctx.params.id });
  }
});
const HK_CALL_N = { towels: 'מגבות לחדר', sheets: 'החלפת מצעים', wc: 'לנקות שירותים', bins: 'להחליף פחים', floor: 'לנקות רצפה', full: 'ניקוי מלא לחדר', spill: 'ניקוי שפיכה / לכלוך', glass: 'ניקוי זכוכית / חלונות', area: 'ניקוי כללי של השטח' };
function HK_CALL_TXT(c) { return (c.tasks || []).filter((k) => k !== 'other').map((k) => HK_CALL_N[k] || k).concat(c.note ? [c.note] : []).join(' · '); }

// ---------- invoice paid from the till (shift report) → push to whoever approves expenses for that hotel ----------
exports.onSrInvoice = trig('invoices/{id}').onCreate(async (snap) => {
  const v = snap.data() || {}; if (v.source !== 'sr') return;
  const out = new Set(), rs = await db.collection('roles').get();
  rs.forEach((d) => { const r = d.data() || {}; if (r.station || !(r.apps && r.apps.exp)) return; const hs = r.expHotels || r.hotels || []; if (!hs.length || hs.includes(v.hotel)) out.add(d.id); });
  const own = await db.collection('pushTokens').where('owner', '==', true).get(); own.forEach((d) => out.add(d.id));
  const hn = await hotelName(v.hotel);
  return sendTo([...out], { title: 'חשבונית מהקופה ממתינה לאישור', body: `${hn ? hn + ' · ' : ''}₪${v.total || 0}${v.supplierName ? ' · ' + v.supplierName : ''} · ${v.notes || ''}`.slice(0, 180), hash: '#exp', tag: 'srinv-' + snap.id });
});

// ---------- a new employee registered (no department yet) → push to whoever holds the employees (hr) app for that hotel ----------
exports.onEmpNew = trig('employees/{uid}').onCreate(async (snap) => {
  const e = snap.data() || {}; if (e.manual) return;
  const h = e.hotel || 'main', out = new Set(), rs = await db.collection('roles').get();
  rs.forEach((d) => { const r = d.data() || {}; if (r.station || !(r.apps && r.apps.hr)) return; const hs = r.hotels || []; if (!hs.length || hs.includes(h)) out.add(d.id); });
  const own = await db.collection('pushTokens').where('owner', '==', true).get(); own.forEach((d) => out.add(d.id));
  const hn = h === 'chain' ? 'עובדי רשת' : await hotelName(h);
  return sendTo([...out], { title: 'עובד חדש נרשם', body: `${e.name || ''}${hn ? ' · ' + hn : ''}${h === 'chain' ? '' : ' · צריך לשייך מחלקה'}`, hash: '#hr', tag: 'empnew-' + snap.id });
});

// ---------- spa: every new treatment pops up for everyone with the spa permission ----------
exports.onSpaNew = trig('spa/{id}').onCreate(async (snap) => {
  const b = snap.data() || {}, out = new Set(), rs = await db.collection('roles').get();
  rs.forEach((d) => { const r = d.data() || {}; if (!r.station && r.apps && r.apps.spa) out.add(d.id); });
  const own = await db.collection('pushTokens').where('owner', '==', true).get(); own.forEach((d) => out.add(d.id));
  out.delete(b.createdBy);
  const t = b.ther || [], m = t.filter((x) => x === 'm').length, f = t.filter((x) => x === 'f').length;
  const th = [m ? `${m} מטפל` : '', f ? `${f} מטפלת` : ''].filter(Boolean).join(' + ');
  const dd = String(b.date || ''), dm = dd ? dd.slice(8, 10) + '.' + dd.slice(5, 7) : '';
  return sendTo([...out], { title: 'טיפול ספא חדש', body: `${dm} ${b.time || ''} · ${b.treatment || ''} · ${b.mins || 60} דק׳ · ${b.people || 1} אנשים${th ? ' · ' + th : ''}${b.amount ? ' · ₪' + b.amount : ''}`, hash: '#spa', tag: 'spa-' + snap.id });
});

// ---------- a room stopped being OD (occupied) → tell the housekeeping worker assigned to it that it's empty and can be cleaned ----------
exports.onHkVacant = trig('hk/{id}').onWrite(async (ch) => {
  if (!ch.after.exists || !ch.before.exists) return;
  const bo = ch.before.data().occ || {}, a = ch.after.data() || {}, ao = a.occ || {}, asg = a.asg || {}, per = {};
  const has = (x) => String(x || '').split(',').includes('oc');
  for (const [r, v] of Object.entries(bo)) if (has(v) && !has(ao[r]) && asg[r]) (per[asg[r]] = per[asg[r]] || []).push(r);
  // OD is now a clean status: OD → anything else (not by the assigned worker themself) = the room is free to clean
  const bc = ch.before.data().clean || {}, ac = a.clean || {};
  for (const [r, v] of Object.entries(bc)) if ((v === 'od' || v === 'oc') && ac[r] !== 'od' && ac[r] !== 'oc' && asg[r] && a.lastBy !== asg[r] && !(per[asg[r]] || []).includes(r)) (per[asg[r]] = per[asg[r]] || []).push(r);
  const uids = Object.keys(per); if (!uids.length) return;
  const hn = await hotelName(a.hotel);
  return Promise.all(uids.map((u) => sendTo([u], { title: per[u].length > 1 ? 'חדרים התפנו' : 'החדר התפנה', body: `${hn ? hn + ': ' : ''}חדר ${per[u].join(', ')} ריק עכשיו, אפשר לנקות`, hash: '#hk', tag: 'hkv-' + u + '-' + per[u].join('-') })));
});

// ---------- guest complaint from a shift report → push to everyone with the complaints (cmp) app for that hotel ----------
// ---------- room inspector: a cleaner finished a room → push the hotel's inspectors (hkchk); sent back to cleaning → push the cleaner ----------
exports.onHkCheck = trig('hk/{id}').onWrite(async (ch) => {
  if (!ch.after.exists) return;
  const b = ch.before.exists ? ch.before.data() : {}, a = ch.after.data() || {}, bd = b.done || {}, ad = a.done || {}, bb = b.back || {}, ab = a.back || {};
  const fin = Object.keys(ad).filter((r) => ad[r] && ad[r] !== bd[r]);
  const back = Object.keys(ab).filter((r) => ab[r] && ab[r] !== bb[r]);
  const hn = await hotelName(a.hotel), jobs = [];
  if (fin.length) {
    const rs = await db.collection('roles').get(), out = [];
    rs.forEach((d) => { const r = d.data() || {}; if (r.station || !(r.apps && r.apps.hkchk)) return; const hs = r.hotels || []; if ((!hs.length || hs.includes(a.hotel)) && d.id !== a.lastBy) out.push(d.id); });
    if (out.length) jobs.push(sendTo(out, { title: fin.length > 1 ? 'חדרים לבדיקה' : 'חדר לבדיקה', body: `${hn ? hn + ': ' : ''}חדר ${fin.join(', ')} נוקה וממתין לבדיקה`, hash: '#hk', tag: 'hkchk-' + a.hotel + '-' + fin.join('-') }));
  }
  const per = {}; for (const r of back) { const u = (b.doneBy || {})[r] || (a.asg || {})[r]; if (u && u !== a.lastBy) (per[u] = per[u] || []).push(r); }
  for (const [u, rooms] of Object.entries(per)) jobs.push(sendTo([u], { title: 'חדר הוחזר לניקוי', body: `${hn ? hn + ': ' : ''}חדר ${rooms.join(', ')} לא עבר בדיקה, צריך לנקות שוב`, hash: '#hk', tag: 'hkback-' + rooms.join('-') }));
  return Promise.all(jobs);
});
exports.onCmpNew = trig('hkComplaints/{id}').onCreate(async (snap) => {
  const c = snap.data() || {}, h = c.hotel || 'main', out = new Set(), rs = await db.collection('roles').get();
  rs.forEach((d) => { const r = d.data() || {}; if (r.station || !(r.apps && r.apps.cmp)) return; const hs = r.hotels || []; if (!hs.length || hs.includes(h)) out.add(d.id); });
  const own = await db.collection('pushTokens').where('owner', '==', true).get(); own.forEach((d) => out.add(d.id));
  const hn = await hotelName(h);
  return sendTo([...out], { title: `תלונת אורח · חדר ${c.room || ''}`, body: `${hn ? hn + ' · ' : ''}${c.note || ''}${c.cleanerName ? ' · ניקה: ' + c.cleanerName : ''}`.slice(0, 180), hash: '#cmp', tag: 'cmp-' + snap.id });
});
