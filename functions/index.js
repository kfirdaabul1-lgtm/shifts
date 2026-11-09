// Seven Collection: push notifications to phones (Firebase Cloud Messaging).
// Each trigger finds who should know about a change and sends to the devices saved in pushTokens/{uid}.
// 1st-gen Firestore triggers: they work whatever region the database is in.
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const REGION = 'europe-west1';
const APP = 'https://app.sevencollection.co.il/';
// chain name + site address from orgcfg/main (set on the hotel settings page); cached for 10 minutes
let orgC = null, orgAt = 0;
async function org() {
  if (orgC && Date.now() - orgAt < 600000) return orgC;
  let o = {}; try { const d = await db.doc('orgcfg/main').get(); if (d.exists) o = d.data() || {}; } catch (e) { }
  orgC = { name: o.name || 'Seven Collection', url: o.appUrl || APP }; orgAt = Date.now(); return orgC;
}
const DEPT = { ops: 'תפעול', reception: 'קבלה', housekeeping: 'משק', public: 'שטחים ציבוריים', maintenance: 'אחזקה', kitchen: 'מטבח', dining: 'חדר אוכל', bar: 'בר', dishwash: 'שוטף כלים', laundry: 'מכבסה' };
// owner devices: pushTokens docs flagged owner:true, double-checked against the account e-mail (a flag alone is not trusted)
let ownU = {}, ownAt = 0;
async function ownTok() {
  const q = await db.collection('pushTokens').where('owner', '==', true).get();
  if (Date.now() - ownAt > 600e3) { ownU = {}; ownAt = Date.now(); }
  const docs = [];
  for (const d of q.docs) {
    // the system owner (platform e-mail) gets notifications only from his home chain (Seven, project hotel-shifts) (owner, Nov 5)
    if (ownU[d.id] === undefined) { try { const u = await admin.auth().getUser(d.id), em = String(u.email || '').toLowerCase(); ownU[d.id] = !u.emailVerified ? false : (em === 'kfirdaabul1@gmail.com' && (process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'hotel-shifts') !== 'hotel-shifts') ? false : await pwIsOwnerMail(em); } catch (e) { ownU[d.id] = false; } }
    if (ownU[d.id]) docs.push(d);
  }
  return { docs, empty: !docs.length, size: docs.length, forEach: (f) => docs.forEach(f) };
}
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
  const own = await ownTok();
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
  const O = await org();
  const data = { title: msg.title || O.name, body: msg.body || '', url: O.url + (msg.hash || ''), tag: msg.tag || '' };
  for (let i = 0; i < tokens.length; i += 500) {
    const part = tokens.slice(i, i + 500);
    // a "notification" block makes the phone show it itself (iPhone ignored data-only messages when the app was closed)
    const res = await admin.messaging().sendEachForMulticast({ tokens: part, data, webpush: { headers: { Urgency: 'high', TTL: '86400' },
      notification: { title: data.title, body: data.body, icon: O.url.replace(/[^/]*$/, '') + 'icon-192.png', badge: O.url.replace(/[^/]*$/, '') + 'icon-192.png', dir: 'rtl', lang: 'he', ...(data.tag ? { tag: data.tag, renotify: true } : {}) },
      fcmOptions: { link: data.url } } });
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
    if (now === 'mgr') return sendTo(await managersOf(a.hotel), { title: 'החלפה מחכה לאישורך', body: `${await ename(a.uid)} ↔ ${await ename(a.peer)} · ${a.fromDesc || ''}`, hash: '#sched?swap=1', tag: 'sw-' + ch.after.id });
    if (now === 'approved') return sendTo([a.uid, a.peer], { title: 'ההחלפה אושרה ✓', body: a.fromDesc || '', hash: '#mine', tag: 'sw-' + ch.after.id });
    if (now === 'declined') return sendTo([was === 'peer' ? a.uid : a.uid, a.peer].filter((u, i) => was === 'peer' ? i === 0 : true), { title: 'בקשת ההחלפה נדחתה', body: a.fromDesc || '', hash: '#mine', tag: 'sw-' + ch.after.id });
    return;
  }
  if (now === 'pending' && !b) return sendTo([a.uid], { title: 'בקשה מהמנהל', body: 'יש לך בקשה לשינוי משמרת. נא לאשר או לדחות.', hash: '#mine', tag: 'rq-' + ch.after.id });
  if (was === 'pending' && (now === 'approved' || now === 'declined'))
    return sendTo(await managersOf(a.hotel), { title: now === 'approved' ? 'העובד אישר את השינוי' : 'העובד דחה את השינוי', body: `${await ename(a.uid)} · ${a.fromDesc || a.toDesc || ''}`, hash: '#sched', tag: 'rq-' + ch.after.id });
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
  return sendTo(to, { title: 'דוח סוף משמרת חדש', body: `${await hotelName(r.hotel)} · ${r.name || ''}${r.unusual ? ' · ⚠ אירוע חריג' : ''}${gap}`, hash: '#fin?sr=' + snap.id, tag: 'sr-' + snap.id });
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
const BACKUP_COLLS = ['broadcasts', 'waauto', 'waChats', 'srImgs', 'shiftKinds', 'signs', 'receipts', 'orgcfg', 'groups', 'agents', 'priceLists', 'jobRoles', 'vchCodes', 'hkday', 'faultsAck', 'srDrafts', 'vchcfg', 'hotels', 'settings', 'employees', 'mgr', 'avail', 'shifts', 'schedule', 'requests', 'roles', 'joinCodes', 'config', 'menus', 'contracts', 'quotes', 'campaigns', 'suppliers', 'invoices', 'expcfg', 'inventory', 'purchaseReqs', 'shiftReports', 'faults', 'hk', 'hkcfg', 'hkLog', 'hkComplaints', 'leads', 'tasks', 'clients', 'hkCalls', 'spa', 'spacfg', 'vouchers'];
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
    if (!key || key.length < 24 || !((a, b) => a.length === b.length && require('crypto').timingSafeEqual(a, b))(Buffer.from(got), Buffer.from(key))) { res.status(403).send('forbidden'); return; }
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
const PUB_KEYS = ['hotel', 'month', 'date', 'shift', 'name', 'empUid', 'clean', 'cleanImg', 'cleanNote', 'ooo', 'faults', 'notes', 'lost', 'cmp', 'booking', 'arsona', 'ciLeft', 'coLeft', 'ci', 'co', 'cid', 'unusual', 'details', 'createdAt', 'by'];
exports.mirrorShiftReport = trig('shiftReports/{id}').onWrite(async (ch, ctx) => {
  const ref = db.doc('shiftReportsPub/' + ctx.params.id);
  if (!ch.after.exists) { await ref.delete().catch(() => {}); return; }
  const r = ch.after.data() || {}, out = {};
  for (const k of PUB_KEYS) if (r[k] !== undefined) out[k] = r[k];
  await ref.set(out);
});

// ---------- housekeeping: a worker assigned to rooms gets a push ----------
// a doc of a future day = the next day being planned (owner, Nov 1): no pushes until that day starts (onHkDayStart)
const hkFuture = (a) => a && a.date && a.date > ilDate(new Date());
exports.onHkAssign = trig('hk/{id}').onWrite(async (ch) => {
  if (!ch.after.exists || hkFuture(ch.after.data())) return;
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
      // OOS blocks whose end date has passed are released → VD on today's board (reception gets the onHkBlock push)
      try {
        const bl = await db.collection('hkBlocks').where('hotel', '==', d.id).get();
        for (const b of bl.docs) { const x = b.data() || {}; if (x.until && x.until < today) { await b.ref.delete(); await db.doc('hk/' + d.id + '__' + today).set({ hotel: d.id, date: today, clean: { [x.room]: 'vd' }, cleanBy: { [x.room]: 'שחרור OOS אוטומטי' }, cleanAt: { [x.room]: Date.now() }, updatedAt: Date.now() }, { merge: true }); } }
      } catch (e) { console.error('hk oos release', d.id, e); }
      if (from >= today) continue;
      const n = await hkCarry(d.id, today, from);
      await ref.set({ hotel: d.id, date: today, from, by: 'auto', byName: 'אוטומטי 05:00', at: Date.now() });
      try { await grpHkAll(d.id, today); } catch (e) { console.error('grp hk', d.id, e); }
      console.log('hk day', d.id, from, '->', today, n);
    } catch (e) { console.error('hk day', d.id, e); }
  }
  return null;
});

// maintenance: a fault fixed → the hotel's reception desk
// a fixed fault releases its room from OOO on today's housekeeping board → VD (needs cleaning),
// unless another fault of the same room is still open (owner, Nov 1)
async function oooRelease(a, id) {
  const room = String(a.room || '').trim(); if (!a.hotel || !room) return;
  const open = await db.collection('faults').where('hotel', '==', a.hotel).where('status', '==', 'open').get();
  if (open.docs.some((d) => d.id !== id && String(d.data().room || '').trim() === room)) return;
  const dd = await db.doc('hkday/' + a.hotel).get(), date = (dd.exists && dd.data().date) || ilDate(new Date());
  const ref = db.doc('hk/' + a.hotel + '__' + date), cur = await ref.get();
  if (!cur.exists || ((cur.data().clean || {})[room]) !== 'ooo') return;
  let nm = 'אחזקה';
  if (a.doneBy) { const e = await db.doc('employees/' + a.doneBy).get(); if (e.exists && e.data().name) nm = 'אחזקה · ' + e.data().name; }
  await ref.set({ clean: { [room]: 'vd' }, cleanBy: { [room]: nm }, cleanAt: { [room]: Date.now() }, lastBy: a.doneBy || 'server', updatedAt: Date.now() }, { merge: true });
}
exports.onFaultDone = trig('faults/{id}').onUpdate(async (ch) => {
  const b = ch.before.data() || {}, a = ch.after.data() || {};
  const nb = (b.upd || []).length, na = (a.upd || []).length;
  if (na > nb && a.status !== 'done') { // an update was added to an open fault → maintenance / managers (not the writer)
    const u = a.upd[na - 1] || {};
    const to = (await roleHolders(a.hotel, ['maint', 'gm', 'shifts'], 'maintenance')).filter((x) => x !== u.by);
    return sendTo(to, { title: 'עדכון לתקלה', body: `${a.room ? 'חדר ' + a.room + ' · ' : ''}${a.desc || ''}: ${u.text || ''}${u.byName ? ' · ' + u.byName : ''}`, hash: '#maint', tag: 'ft-' + ch.after.id });
  }
  if (a.status !== 'done' || b.status === 'done') return;
  await oooRelease(a, ch.after.id).catch((e) => console.error('oooRelease', e));
  const st = await stationsOf(a.hotel); if (!st.length) return;
  return sendTo(st, { title: 'תקלה תוקנה ✓', body: `${a.room ? 'חדר ' + a.room + ' · ' : ''}${a.desc || ''}`, hash: '#front', tag: 'ft-' + ch.after.id });
});

// housekeeping: every cleaning update (status or "started cleaning") → the hotel's reception desk, except its own changes
const HK_TXT = { vc: 'VC · חדר נקי', vi: 'VI · נקי מאתמול', vd: 'VD · חדר מלוכלך', od: 'OD · תפוס מלוכלך', oc: 'OC · תפוס נקי', ooo: 'OOO · תקלה תחזוקתית' };
exports.onHkUpdate = trig('hk/{id}').onWrite(async (ch) => {
  if (!ch.after.exists || hkFuture(ch.after.data())) return;
  const b = ch.before.exists ? ch.before.data() : {}, a = ch.after.data() || {};
  const st = (await stationsOf(a.hotel)).filter((u) => u !== a.lastBy); if (!st.length) return;
  const lines = [], bc = b.clean || {}, ac = a.clean || {}, bs = b.start || {}, as = a.start || {}, who = a.cleanBy || {};
  // refresh finished (worker "✓ סיימתי Full refresh/Refresh") → one line instead of the OC status change of the same write
  const btd = b.trtDone || {}, atd = a.trtDone || {}, trtN = { full: 'Full refresh', ref: 'Refresh' }, refd = new Set();
  for (const [r, v] of Object.entries(atd)) if (v && btd[r] !== v) { refd.add(r); lines.push(`חדר ${r}: ✓ סיים ${trtN[(a.trt || {})[r]] || 'רפרש'}${(a.trtByName || {})[r] ? ' · ' + a.trtByName[r] : ''}`); }
  for (const [r, v] of Object.entries(ac)) if (bc[r] !== v && !refd.has(r) && (who[r] || '') !== 'אוטומטי') lines.push(`חדר ${r}: ${HK_TXT[v] || v}${who[r] ? ' · ' + who[r] : ''}`);
  for (const [r, v] of Object.entries(as)) if (bs[r] !== v && !(ac[r] && bc[r] !== ac[r])) lines.push(`חדר ${r}: התחיל ניקיון${(a.asgName || {})[r] ? ' · ' + a.asgName[r] : ''}`);
  const bd = b.dnd || {}, ad = a.dnd || {};
  for (const [r, v] of Object.entries(ad)) if (v && bd[r] !== v) lines.push(`חדר ${r}: 🚫 שלט DND על הדלת${(a.dndBy || {})[r] ? ' · ' + a.dndBy[r] : ''}`);
  for (const r of Object.keys(bd)) if (bd[r] && !ad[r]) lines.push(`חדר ${r}: שלט ה-DND הוסר`);
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

// ---------- bar end-of-shift report (Nov 4) → hotel manager, shifts managers and bar dept managers (+owner) ----------
exports.onBarReport = trig('barReports/{id}').onCreate(async (snap) => {
  const r = snap.data() || {}, ils = (n) => '₪' + Math.round(+n || 0).toLocaleString('he-IL');
  const sh = { morning: 'בוקר', evening: 'ערב', night: 'לילה' }[r.shift] || '';
  const to = (await roleHolders(r.hotel, ['gm', 'shifts'], 'bar')).filter((u) => u !== r.by);
  const body = `${r.name || ''}${sh ? ' · ' + sh : ''} · מזומן ${ils(r.cash)} · אשראי ${ils(r.credit)} · טיפים מזומן ${ils(r.tipsCash)} · טיפים אשראי ${ils(r.tipsCredit)}${r.missing === 'yes' ? ' · ⚠️ חסר: ' + (r.missingNote || '') : ''}`;
  return sendTo(to, { title: (r.missing === 'yes' ? '⚠️ ' : '') + 'דוח בר · ' + (await hotelName(r.hotel)), body, hash: '#bar', tag: 'bar-' + snap.id });
});

// ---------- site tours (Nov 4): tours/{id} scheduled from a lead → on the day: the person who scheduled it, the reception (desks + front) and the hotel manager ----------
async function tourHotel(venue) {
  if (!venue) return '';
  const qs = await db.collection('settings').where('venues', 'array-contains', venue).get();
  return qs.empty ? '' : qs.docs[0].id;
}
async function tourPeople(t) {
  const out = new Set([t.by]);
  if (t.hotel) {
    (await stationsOf(t.hotel)).forEach((u) => out.add(u));
    (await roleHolders(t.hotel, ['front', 'gm'])).forEach((u) => out.add(u));
  }
  return [...out].filter(Boolean);
}
function tourMsg(t, title) {
  const ty = String(t.type || '').replace(/_+/g, ' ').trim();
  return { title, body: [t.time, t.leadName, ty, t.guests ? t.guests + ' אורחים' : '', t.note].filter(Boolean).join(' · '), hash: '#brief', tag: 'tour-' + (t.id || '') };
}
exports.onTourWrite = trig('tours/{id}').onWrite(async (ch, ctx) => {
  if (!ch.after.exists) return null;
  const t = { ...ch.after.data(), id: ctx.params.id }, b = ch.before.exists ? ch.before.data() : null;
  if (!t.hotel && t.venue) { const h = await tourHotel(t.venue); if (h) { await ch.after.ref.update({ hotel: h }); return null; } }
  // a tour for today scheduled (or moved to today) after the morning reminder → remind now
  const today = ilDate(new Date());
  if (t.status !== 'scheduled' || t.date !== today) return null;
  if (b && b.date === t.date && b.status === 'scheduled' && (b.hotel || '') === (t.hotel || '')) return null;
  return sendTo(await tourPeople(t), tourMsg(t, '🗓 יש היום סיור · ' + (t.hotel ? await hotelName(t.hotel) : '')));
});
exports.tourMorning = functions.region(REGION).pubsub.schedule('0 8 * * *').timeZone('Asia/Jerusalem').onRun(async () => {
  const today = ilDate(new Date()), qs = await db.collection('tours').where('date', '==', today).get();
  for (const d of qs.docs) {
    const t = { ...d.data(), id: d.id }; if (t.status !== 'scheduled') continue;
    await sendTo(await tourPeople(t), tourMsg(t, '🗓 תזכורת: סיור היום · ' + (t.hotel ? await hotelName(t.hotel) : '')));
  }
  return null;
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
  const until = ilDate(new Date()), since = (cfg.since && /^\d{4}-\d{2}-\d{2}$/.test(cfg.since)) ? weekOfISO(cfg.since) : weekOfISO(isoAdd(until, -35)), rows = [];
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
    b.set(db.doc('campaigns/meta_' + k), { name: x.name, platform: 'meta', target: 'Meta Ads', week: x.week, start: x.week, end: isoAdd(x.week, 6), spend: Math.round(x.spend * 100) / 100, leads: x.leads, msgs: x.msgs, impressions: x.impressions, clicks: x.clicks, auto: 'meta', metaId: x.metaId, metaConn: (cfg.conn && cfg.conn.id) || '', metaConnName: (cfg.conn && cfg.conn.name) || '', venue: (cfg.conn && cfg.conn.venue) || '', updatedAt: Date.now() }, { merge: true });
    n++;
  }
  if (n) await b.commit();
  return { campaigns: new Set(Object.values(by).map((x) => x.metaId)).size, reports: n };
}
// lead form answers → our lead fields; anything we don't recognise goes to notes
function metaLeadDoc(m, form, pageName, conn) {
  conn = conn || {};
  const f = {}; (m.field_data || []).forEach((x) => { f[x.name] = (x.values || []).join(', '); });
  const pick = (re) => { const k = Object.keys(f).find((n) => re.test(n)); if (!k) return ''; const v = f[k]; delete f[k]; return v; };
  let name = pick(/^(full_?name|name|שם מלא|שם)$/i);
  if (!name) { const a = pick(/^first_?name$/i), z = pick(/^last_?name$/i); name = (a + ' ' + z).trim(); }
  const type = pick(/^(event_?type|type)$|סוג/i).replace(/_+/g, ' ').trim();
  let phone = pick(/phone|טלפון|נייד/i); phone = phone.replace(/[\s-]/g, '').replace(/^\+?972/, '0');
  const email = pick(/e-?mail|מייל|דוא/i), company = pick(/company|חברה|ארגון/i);
  let date = pick(/date|תאריך/i), guests = pick(/guest|people|attend|אורח|משתתפ|כמות|מספר/i);
  const notes = [];
  const di = date.match(/(\d{4})-(\d{1,2})-(\d{1,2})/) || null, dl = date.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/) || null;
  let dISO = '';
  if (di) dISO = `${di[1]}-${di[2].padStart(2, '0')}-${di[3].padStart(2, '0')}`;
  else if (dl) dISO = `${dl[3].length === 2 ? '20' + dl[3] : dl[3]}-${dl[2].padStart(2, '0')}-${dl[1].padStart(2, '0')}`;
  if (date && !dISO) notes.push('תאריך: ' + date);
  // ranges like "50-100" or "50_100" keep their text (guestsTxt); guests = the first number
  const gt = String(guests || '').replace(/_/g, ' ').trim(), gm = gt.match(/\d+/g) || [], g = gm.length ? parseInt(gm[0], 10) : 0;
  const guestsTxt = gm.length > 1 ? gm.slice(0, 2).join('–') : ''; if (guests && !g) notes.push('אורחים: ' + guests);
  Object.entries(f).forEach(([k, v]) => notes.push(k.replace(/_/g, ' ') + ': ' + v));
  const now = Date.now(), plat = String(m.platform || '').toLowerCase() === 'ig' ? 'instagram' : 'facebook';
  return {
    name: name || 'ליד מ-' + (plat === 'instagram' ? 'אינסטגרם' : 'פייסבוק'), phone, email, company, type, date: dISO, guests: g || 0, guestsTxt, venue: conn.venue || '', metaConn: conn.id || '', metaConnName: conn.name || '', page: pageName || '',
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
// events users; with a venue, only those who may see that venue's leads (owner, Nov 1: leads separated per hotel):
// roles with no hotels = all, otherwise one of their hotels' settings.venues must include it (a lead with no venue goes to everyone)
async function eventsPeople(venue, lead) {
  const out = new Set(), rs = await db.collection('roles').get(), vc = {};
  const vOf = async (h) => { if (!(h in vc)) { try { const d = await db.doc('settings/' + h).get(); vc[h] = (d.exists && d.data().venues) || []; } catch (e) { vc[h] = []; } } return vc[h]; };
  for (const d of rs.docs) {
    const r = d.data() || {}; if (r.station || !(r.apps && r.apps.events)) continue;
    const hs = r.hotels || []; if (!hs.length) { out.add(d.id); continue; } if (!venue) { if (!lead) out.add(d.id); continue; } // lead with no place → chain staff only
    for (const h of hs) if ((await vOf(h)).includes(venue)) { out.add(d.id); break; }
  }
  const own = await ownTok(); own.forEach((d) => out.add(d.id));
  return [...out];
}
// cost-per-lead alert: a weekly campaign report over its limit (campaigns.cplMax or mktcfg/main.cplMax) → push social media holders, once a day per campaign
async function mktPeople() {
  const out = new Set(), rs = await db.collection('roles').get();
  rs.forEach((d) => { const r = d.data() || {}; if (!r.station && r.apps && r.apps.mkt) out.add(d.id); });
  const own = await ownTok(); own.forEach((d) => out.add(d.id));
  return [...out];
}
exports.onCampaignCpl = trig('campaigns/{id}').onWrite(async (ch) => {
  if (!ch.after.exists) return;
  const c = ch.after.data() || {}, today = ilDate(new Date());
  if (c.cplAlerted === today) return;
  if (String(c.end || isoAdd(c.week || '1970-01-01', 6)) < isoAdd(today, -1)) return; // only campaigns of the current week
  let lim = +c.cplMax || 0;
  if (!lim) { try { const m = await db.doc('mktcfg/main').get(); lim = +((m.exists && m.data().cplMax) || 0); } catch (e) { } }
  if (!lim) return;
  const l = +c.leads || 0, m = +c.msgs || 0, leads = m && l === m ? l : l + m, sp = +c.spend || 0;
  if (!(sp > 0 && (leads ? sp / leads > lim : sp > lim))) return;
  await ch.after.ref.set({ cplAlerted: today }, { merge: true });
  const body = leads ? `${c.name || 'קמפיין'}: ₪${Math.round(sp / leads)} לליד (התקרה ₪${lim}) · הושקעו ₪${Math.round(sp)}, ${leads} לידים` : `${c.name || 'קמפיין'}: הושקעו ₪${Math.round(sp)} בלי אף ליד (התקרה ₪${lim} לליד)`;
  await sendTo(await mktPeople(), { title: 'עלות לליד גבוהה', body, hash: '#mkt', tag: 'cpl-' + ch.after.id });
});
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
        try { const doc = metaLeadDoc(m, form, p.name, cfg.conn); await ref.create(doc); fresh.push(doc); } catch (e) { /* already in */ }
      }
    }
  }
  const byV = {}; for (const l of fresh) (byV[l.venue || ''] = byV[l.venue || ''] || []).push(l);
  for (const [v, fl] of Object.entries(byV)) {
    const who = await eventsPeople(v, true);
    await sendTo(who, { title: fl.length === 1 ? 'ליד חדש מ-Meta' : `${fl.length} לידים חדשים מ-Meta`, body: fl.slice(0, 3).map((l) => l.name + (l.campaign ? ' · ' + l.campaign : '')).join(' | '), hash: '#leads', tag: 'meta-leads-' + v });
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
  const prev = rt.status || {}, st = { ...prev, at: Date.now(), ok: true, err: '', leadErr: '', insErr: prev.insErr || '' }, out = { leadsAt: rt.leadsAt || 0, insAt: rt.insAt || 0 };
  const c = { token: conn.token, adAccount: conn.adAccount, leadsAt: rt.leadsAt, conn: { id, name: conn.name || '', venue: conn.venue || '' } };
  try { const me = await graph('me', c.token, { fields: 'id,name' }); st.user = me.name || me.id; }
  catch (e) { st.ok = false; st.err = String(e.message || e); return { ...out, status: st }; }
  try { const r = await metaLeads(c); st.pages = r.pages; st.forms = r.forms; st.newLeads = r.newLeads; st.leadsTotal = (prev.leadsTotal || 0) + r.newLeads; out.leadsAt = r.leadsAt; }
  catch (e) { st.leadErr = String(e.message || e); }
  if (full || !rt.insAt || Date.now() - rt.insAt > 3 * 3600e3) {
    try { const r = await metaInsights(c); st.campaigns = r.campaigns; st.reports = r.reports; st.insErr = ''; }
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
exports.metaPoll = functions.region(REGION).runWith({ timeoutSeconds: 540 }).pubsub.schedule('every 5 minutes').onRun(() => metaRun(false));
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
  const own = await ownTok();
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
  const own = await ownTok(); own.forEach((d) => out.add(d.id));
  const hn = await hotelName(v.hotel);
  return sendTo([...out], { title: 'חשבונית מהקופה ממתינה לאישור', body: `${hn ? hn + ' · ' : ''}₪${v.total || 0}${v.supplierName ? ' · ' + v.supplierName : ''} · ${v.notes || ''}`.slice(0, 180), hash: '#exp?inv=' + snap.id, tag: 'srinv-' + snap.id });
});

// ---------- a new employee registered (no department yet) → push to whoever holds the employees (hr) app for that hotel ----------
exports.onEmpNew = trig('employees/{uid}').onCreate(async (snap) => {
  const e = snap.data() || {}; if (e.manual) return;
  const h = e.hotel || 'main', out = new Set(), rs = await db.collection('roles').get();
  rs.forEach((d) => { const r = d.data() || {}; if (r.station || !(r.apps && r.apps.hr)) return; const hs = r.hotels || []; if (!hs.length || hs.includes(h)) out.add(d.id); });
  const own = await ownTok(); own.forEach((d) => out.add(d.id));
  const hn = h === 'chain' ? 'עובדי רשת' : await hotelName(h);
  return sendTo([...out], { title: 'עובד חדש נרשם', body: `${e.name || ''}${hn ? ' · ' + hn : ''}${h === 'chain' ? '' : ' · צריך לשייך מחלקה'}`, hash: '#hr', tag: 'empnew-' + snap.id });
});

// ---------- spa: every new treatment pops up for everyone with the spa permission ----------
// ---------- spa health declaration (owner, Nov 3): spaHealth/{key} signed by the guest → mark the booking (hl.<idx>) + push spa people ----------
function spaHealthKey() { return 'h' + require('crypto').randomBytes(16).toString('hex'); }
function spaHealthExp(date) { return Date.parse(date + 'T23:59:59+02:00') + 86400000; }
exports.onSpaHealth = trig('spaHealth/{id}').onUpdate(async (ch, ctx) => {
  const a = ch.before.data() || {}, b = ch.after.data() || {};
  if (a.status === 'signed' || b.status !== 'signed' || !b.bookingId) return null;
  const ref = db.doc('spa/' + b.bookingId), bs = await ref.get(); if (!bs.exists) return null;
  await ref.update({ ['hl.' + (+b.idx || 0)]: { k: ctx.params.id, ok: true, name: b.signName || '', at: b.signedAt || Date.now(), flag: !!b.flag }, updatedAt: Date.now() });
  const bk = bs.data() || {}, out = new Set(), rs = await db.collection('roles').get();
  rs.forEach((d) => { const r = d.data() || {}; if (!r.station && r.apps && r.apps.spa) out.add(d.id); });
  const own = await ownTok(); own.forEach((d) => out.add(d.id));
  const dd = String(bk.date || ''), dm = dd ? dd.slice(8, 10) + '.' + dd.slice(5, 7) : '';
  return sendTo([...out], { title: b.flag ? '⚕️ הצהרת בריאות נחתמה · יש סימון רפואי' : '✅ הצהרת בריאות נחתמה', body: `${b.signName || ''} · ${dm} ${bk.time || ''} · ${bk.treatment || ''}${b.flag ? ' · כדאי לעבור על התשובות לפני הטיפול' : ''}`, hash: '#spa', tag: 'spah-' + ctx.params.id });
});
exports.onSpaNew = trig('spa/{id}').onCreate(async (snap) => {
  const b = snap.data() || {}; if (b.kind === 'block') return null;
  const out = new Set(), rs = await db.collection('roles').get();
  rs.forEach((d) => { const r = d.data() || {}; if (!r.station && r.apps && r.apps.spa) out.add(d.id); });
  const own = await ownTok(); own.forEach((d) => out.add(d.id));
  out.delete(b.createdBy);
  const t = b.ther || [], m = t.filter((x) => x === 'm').length, f = t.filter((x) => x === 'f').length;
  const th = [m ? `${m} מטפל` : '', f ? `${f} מטפלת` : ''].filter(Boolean).join(' + ');
  const dd = String(b.date || ''), dm = dd ? dd.slice(8, 10) + '.' + dd.slice(5, 7) : '';
  const adds = (b.adds || []).filter((x) => +x.q > 0), tot = (+b.amount || 0) + adds.reduce((a, x) => a + (+x.p || 0) * (+x.q || 0), 0);
  const at = adds.map((x) => (+x.q > 1 ? x.q + '× ' : '') + x.n).join(', ');
  return sendTo([...out], { title: b.status === 'request' ? '⏳ בקשת הזמנה לספא · צריך לאשר זמינות' : b.source === 'online' ? '🌐 הזמנה אונליין לספא' : 'טיפול ספא חדש', body: `${dm} ${b.time || ''} · ${b.name ? b.name + ' · ' : ''}${b.treatment || ''} · ${b.mins || 60} דק׳ · ${b.people || 1} אנשים${th ? ' · ' + th : ''}${at ? ' · + ' + at : ''}${tot ? ' · ₪' + tot : ''}`, hash: '#spa', tag: 'spa-' + snap.id });
});

// ---------- every morning: spa treatments (today and later) whose therapist is not set / not confirmed → push the spa managers (spa app + owner) ----------
exports.spaPending = functions.region(REGION).pubsub.schedule('0 9 * * *').timeZone('Asia/Jerusalem').onRun(async () => {
  const today = ilDate(new Date()), qs = await db.collection('spa').where('date', '>=', today).get(), due = [];
  qs.forEach((d) => {
    const b = d.data() || {}; if (b.kind === 'block' || b.status === 'done' || b.status === 'canceled') return;
    const n = +b.people || 1; let miss = 0;
    for (let i = 0; i < n; i++) if (!(b.tid || [])[i] || !(b.tok || [])[i]) miss++;
    if (miss) due.push({ ...b, miss });
  });
  if (!due.length) return null;
  due.sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
  const out = new Set(), rs = await db.collection('roles').get();
  rs.forEach((d) => { const r = d.data() || {}; if (!r.station && r.apps && r.apps.spa) out.add(d.id); });
  const own = await ownTok(); own.forEach((d) => out.add(d.id));
  const dm = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7);
  const list = due.slice(0, 4).map((b) => `${b.date === today ? 'היום' : dm(b.date)} ${b.time || ''} ${b.name || b.treatment || ''}`).join(' · ');
  return sendTo([...out], { title: `${due.length} טיפולי ספא בלי מטפל מתואם`, body: list + (due.length > 4 ? ` ועוד ${due.length - 4}` : '') + '. צריך לקבוע ולתאם מטפל.', hash: '#spa', tag: 'spapend-' + today });
});

// ---------- the housekeeping day moved (05:00 or the manual button) → each worker gets the rooms planned for them that day ----------
exports.onHkDayStart = trig('hkday/{h}').onWrite(async (ch, ctx) => {
  if (!ch.after.exists) return;
  const a = ch.after.data() || {}, b = ch.before.exists ? ch.before.data() || {} : {};
  if (!a.date || a.date === b.date || a.date < ilDate(new Date(Date.now() - 24 * 3600e3))) return;
  const ds = await db.doc('hk/' + ctx.params.h + '__' + a.date).get(); if (!ds.exists) return;
  const D = ds.data() || {}, asg = D.asg || {}, pri = D.pri || {}, per = {};
  for (const [room, uid] of Object.entries(asg)) if (uid) (per[uid] = per[uid] || []).push(room);
  const uids = Object.keys(per); if (!uids.length) return;
  const hn = await hotelName(ctx.params.h);
  return Promise.all(uids.map((u) => {
    const rooms = per[u].sort((x, y) => (!!pri[y] - !!pri[x]) || String(x).localeCompare(String(y), 'he', { numeric: true }));
    return sendTo([u], { title: `החדרים שלך להיום · ${rooms.length}`, body: `${hn ? hn + ': ' : ''}חדר ${rooms.map((r) => r + (pri[r] ? ' ❗' : '')).join(', ')}`, hash: '#hk', tag: 'hk-' + u + '-' + a.date });
  }));
});

// ---------- a room stopped being OD (occupied) → tell the housekeeping worker assigned to it that it's empty and can be cleaned ----------
exports.onHkVacant = trig('hk/{id}').onWrite(async (ch) => {
  if (!ch.after.exists || !ch.before.exists || hkFuture(ch.after.data())) return;
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
  if (!ch.after.exists || hkFuture(ch.after.data())) return;
  const b = ch.before.exists ? ch.before.data() : {}, a = ch.after.data() || {}, bd = b.done || {}, ad = a.done || {}, bb = b.back || {}, ab = a.back || {};
  // rooms the cleaner approved themselves (cleaner is an inspector → chk set in the same write) are not waiting for inspection
  const fin = Object.keys(ad).filter((r) => ad[r] && ad[r] !== bd[r] && !(a.chk || {})[r]);
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
  const own = await ownTok(); own.forEach((d) => out.add(d.id));
  const hn = await hotelName(h);
  return sendTo([...out], { title: `תלונת אורח · חדר ${c.room || ''}`, body: `${hn ? hn + ' · ' : ''}${c.note || ''}${c.cleanerName ? ' · ניקה: ' + c.cleanerName : ''}`.slice(0, 180), hash: '#cmp', tag: 'cmp-' + snap.id });
});

// ---------- invoice scan: the app writes invoiceScans/{id} {data: JPEG data URL, by}; Gemini (Vertex AI) reads it and writes back {status, result} ----------
const AI_MODELS = ['gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-flash-latest'];
let aiModelOk = null;
async function aiToken() { const { access_token: t } = await admin.credential.applicationDefault().getAccessToken(); return t; }
async function aiGenerate(body) {
  const pid = process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId, t = await aiToken(), errs = [];
  for (const m of aiModelOk ? [aiModelOk, ...AI_MODELS.filter((x) => x !== aiModelOk)] : AI_MODELS) {
    const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/${pid}/locations/global/publishers/google/models/${m}:generateContent`, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { aiModelOk = m; return { model: m, j }; }
    errs.push(m + ': ' + (j.error && j.error.message || r.status));
    if (r.status !== 404 && r.status !== 400) break;
  }
  throw new Error(errs.join(' | ').slice(0, 600));
}
const INV_SCHEMA = { type: 'OBJECT', properties: {
  supplierName: { type: 'STRING' }, companyId: { type: 'STRING' }, number: { type: 'STRING' }, date: { type: 'STRING', description: 'YYYY-MM-DD' },
  vatIncluded: { type: 'BOOLEAN', description: 'true if the unit prices include VAT' },
  items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING' }, price: { type: 'NUMBER', description: 'price per unit after line discount' } }, required: ['name', 'qty', 'price'] } },
  net: { type: 'NUMBER' }, vat: { type: 'NUMBER' }, total: { type: 'NUMBER' } }, required: ['items'] };
exports.onInvoiceScan = functions.region('europe-west1').runWith({ timeoutSeconds: 120, memory: '512MB' }).firestore.document('invoiceScans/{id}').onCreate(async (snap) => {
  const v = snap.data() || {};
  if (v.part) return null; // extra page of a multi-page invoice: read by the main scan doc
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(v.data || '');
  if (!m) return snap.ref.update({ status: 'error', error: 'no image' });
  // multi-page invoices (Nov 9): pages 2+ are separate invoiceScans docs listed in v.parts (same uid)
  const imgs = [{ inlineData: { mimeType: m[1], data: m[2] } }], partRefs = [];
  for (const pid of (Array.isArray(v.parts) ? v.parts.slice(0, 9) : [])) {
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(String(pid))) continue;
    const ref = db.doc('invoiceScans/' + pid);partRefs.push(ref);
    const ps = await ref.get().catch(() => null), pv = ps && ps.exists ? ps.data() : null;
    const pm = pv && pv.by === v.by && /^data:(image\/[a-z]+);base64,(.+)$/.exec(pv.data || '');
    if (pm) imgs.push({ inlineData: { mimeType: pm[1], data: pm[2] } });
  }
  const dropParts = () => Promise.all(partRefs.map((r) => r.delete().catch(() => {})));
  const known = Array.isArray(v.sups) ? v.sups.slice(0, 200).join(' | ') : '';
  const prompt = 'This is a photo of a supplier invoice / delivery note from Israel (usually Hebrew). Extract: supplier business name, company id (ח.פ / ע.מ), invoice number, invoice date (YYYY-MM-DD), and every product line with quantity, unit (as written, e.g. ק"ג, יח\', ארגז) and the price PER UNIT after any line discount. Keep product names exactly as written (Hebrew). Do not include totals, VAT, deposits or delivery lines as products unless they are charged as a line. Say whether the unit prices include VAT (מע"מ). If a value is missing leave it empty.' + (known ? ' Known suppliers (use the exact name if it matches): ' + known : '');
  try {
    const { model, j } = await aiGenerate({ contents: [{ role: 'user', parts: [...imgs, { text: imgs.length > 1 ? 'The ' + imgs.length + ' images are consecutive pages of ONE invoice; combine all product lines from every page (do not repeat lines). ' + prompt : prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: INV_SCHEMA } });
    const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('') || '';
    const res = JSON.parse(txt);
    await dropParts();
    return snap.ref.update({ status: 'done', result: res, model, data: admin.firestore.FieldValue.delete(), doneAt: Date.now() });
  } catch (e) {
    console.error('invoice scan', e);
    await dropParts();
    return snap.ref.update({ status: 'error', error: String(e.message || e).slice(0, 500), data: admin.firestore.FieldValue.delete() });
  }
});

// ---------- remote contract signing: sign.html updates signs/{key} pending → signed; copy the signature into the quote and notify the events team ----------
exports.onSignDone = trig('signs/{id}').onUpdate(async (ch) => {
  const b = ch.before.data() || {}, a = ch.after.data() || {};
  if (b.status !== 'pending' || a.status !== 'signed' || !a.quoteId) return null;
  const at = new Date(a.signedAt || Date.now()).toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
  const qref = db.doc('quotes/' + a.quoteId), qs = await qref.get();
  if (!qs.exists) return null;
  const q = qs.data() || {};
  // the sign doc must be the one the quote points at, and the signature a plain PNG data URL
  if (q.signKey !== ch.after.id || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(a.sig || ''))) { console.warn('onSignDone: rejected', ch.after.id); return null; }
  await qref.update({ signature: { name: a.signName || '', at, img: a.sig || '', remote: true, signId: ch.after.id }, status: 'approved', updatedAt: new Date().toISOString() });
  await ch.after.ref.update({ signedAtTxt: at }).catch(() => {});
  await db.collection('quotes/' + a.quoteId + '/versions').doc(Date.now().toString(36) + '-sign').set({ at: new Date().toISOString(), by: null, action: 'signed', total: a.total || 0, status: 'approved', data: { remoteSign: true, name: a.signName || '' } }).catch(() => {});
  return sendTo(await eventsPeople(), { title: `הצעה #${a.num || q.num || ''} נחתמה ✍️`, body: `${a.signName || ''}${q.client && q.client.name && q.client.name !== a.signName ? ' (' + q.client.name + ')' : ''} חתם/ה על ההצעה בקישור. ההצעה סומנה כמאושרת.`, hash: 'events.html#q=' + a.quoteId, tag: 'sign-' + a.quoteId });
});

// ================= WhatsApp (owner, Oct 26): one chain number, conversations inside "לידים ומכירות" + events =================
// wacfg/main (owner only) {provider 'meta'|'360dialog', token, phoneId, wabaId, verify, appSecret, syncReq, status}
// wapub/main (events users read) {on, phone, name, templates:[{name, lang, body, n}]}
// waChats/{waId} {waId, phone, name, leadId, lastAt, lastText, lastDir, lastInAt, unread}; msgs/{id} {dir in|out, type, text, at, status, by, byName, src system|app|history, wamid, error}
// waIds/{wamid} {chat, msg} maps delivery statuses to our message docs
const WA_GRAPH = 'https://graph.facebook.com/v23.0/', WA_360 = 'https://waba-v2.360dialog.io/';
// WhatsApp templates: positional {{1}} and named {{customer_name}} variables (Nov 8)
const TPL_NAMED = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const tplNames = (txt) => [...new Set([...String(txt || '').matchAll(TPL_NAMED)].map((m) => m[1]))];
const tplText = (t, params) => String(t.body || '').replace(/\{\{(\w+)\}\}/g, (m0, k) => { const i = /^\d+$/.test(k) ? +k - 1 : (t.names || []).indexOf(k); return i >= 0 && params[i] != null && params[i] !== '' ? params[i] : m0; });
const tplRef = (t, params) => ({ name: t.name, lang: t.lang, params, ...(t.names && t.names.length ? { names: t.names } : {}) });
const waLocal = (id) => { const d = String(id || '').replace(/\D/g, ''); return d.startsWith('972') ? '0' + d.slice(3) : d; };
const waTail = (p) => String(p || '').replace(/\D/g, '').replace(/^972/, '0').slice(-9);
async function waCfg() { const d = await db.doc('wacfg/main').get(); return d.exists ? d.data() : {}; }
async function waApi(c, method, path, body) {
  const is360 = c.provider === '360dialog', url = (is360 ? WA_360 : WA_GRAPH) + path;
  const headers = { 'Content-Type': 'application/json', ...(is360 ? { 'D360-API-KEY': c.token } : { Authorization: 'Bearer ' + c.token }) };
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = j.error || {}; const err = new Error(e.error_user_msg || e.message || ('HTTP ' + r.status)); err.code = e.code; throw err; }
  return j;
}
function waText(m) {
  const t = m.type;
  if (t === 'text') return (m.text && m.text.body) || '';
  const cap = (x) => (m[x] && m[x].caption) || '';
  if (t === 'image') return '📷 תמונה' + (cap('image') ? ': ' + cap('image') : '');
  if (t === 'video') return '🎬 וידאו' + (cap('video') ? ': ' + cap('video') : '');
  if (t === 'document') return '📄 ' + ((m.document && m.document.filename) || 'מסמך') + (cap('document') ? ': ' + cap('document') : '');
  if (t === 'audio') return '🎤 הודעה קולית';
  if (t === 'sticker') return '🙂 מדבקה';
  if (t === 'location') return '📍 מיקום' + (m.location && m.location.name ? ': ' + m.location.name : '');
  if (t === 'contacts') return '👤 איש קשר';
  if (t === 'button') return (m.button && m.button.text) || '';
  if (t === 'interactive') { const i = m.interactive || {}; return (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || ''; }
  if (t === 'reaction') return 'תגובה ' + ((m.reaction && m.reaction.emoji) || '');
  if (t === 'template') return '📋 תבנית';
  return '[הודעה מסוג שלא נתמך]';
}
// the lead of this phone: an existing lead with the same number, else a new lead (source WhatsApp)
async function waLead(waId, name) {
  const t = waTail(waId), ls = await db.collection('leads').get(); let hit = null;
  ls.forEach((d) => { if (!hit && t.length >= 9 && waTail(d.data().phone) === t) hit = d; });
  if (hit) return { id: hit.id, owner: hit.data().owner || '', venue: hit.data().venue || '', isNew: false };
  const id = 'wa_' + waId, now = Date.now();
  await db.doc('leads/' + id).set({ name: name || waLocal(waId), phone: waLocal(waId), email: '', company: '', type: '', date: '', guests: 0, venue: '', source: 'whatsapp', campaign: '', stage: 'new', owner: '', ownerName: '', nextAt: new Date(now + 3 * 3600e3).toISOString().slice(0, 10), value: 0, notes: '', acts: [], createdAt: now, createdBy: 'whatsapp', updatedAt: now }, { merge: true });
  return { id, owner: '', isNew: true };
}
async function waSave(chatId, msgId, data, chatUp) {
  const cref = db.doc('waChats/' + chatId), mref = cref.collection('msgs').doc(msgId);
  try { await mref.create(data); } catch (e) { return false; } // already saved (webhooks can repeat)
  await cref.set({ waId: chatId, phone: waLocal(chatId), ...chatUp }, { merge: true });
  return true;
}
async function waIncoming(m, name, push) {
  const chat = m.from, at = (+m.timestamp || Date.now() / 1000) * 1000, text = waText(m);
  const cref = db.doc('waChats/' + chat), cs = await cref.get(), c = cs.exists ? cs.data() : {};
  const up = { lastAt: at, lastText: text.slice(0, 200), lastDir: 'in', lastInAt: at, unread: admin.firestore.FieldValue.increment(1), status: 'open' };
  if (name && !c.name) up.name = name;
  if (!(await waSave(chat, m.id, { dir: 'in', type: m.type, text, at, src: 'customer', media: (m[m.type] && m[m.type].id) || '', mime: (m[m.type] && m[m.type].mime_type) || '', replyTo: (m.context && m.context.id) || '' }, up))) return;
  if (c.guide && c.groupId) { await guideReply(c, text, at); return; }
  let leadId = c.leadId, owner = '', venue = '';
  if (!leadId) { try { const L = await waLead(chat, name || c.name); leadId = L.id; owner = L.owner; venue = L.venue || ''; await cref.set({ leadId }, { merge: true }); } catch (e) { console.warn('wa lead', e.message); } }
  else { try { const l = await db.doc('leads/' + leadId).get(); owner = (l.exists && l.data().owner) || ''; venue = (l.exists && l.data().venue) || ''; } catch (e) { } }
  if (push) await sendTo(owner ? [owner] : await eventsPeople(venue, true), { title: '💬 ' + (name || c.name || waLocal(chat)), body: text.slice(0, 140), hash: '#leads?wa=' + chat, tag: 'wa-' + chat });
}
async function waOutgoing(chat, m, src) {
  const at = (+m.timestamp || Date.now() / 1000) * 1000, text = waText(m);
  await waSave(chat, m.id, { dir: 'out', type: m.type, text, at, src, status: 'sent', wamid: m.id, byName: src === 'app' ? 'מהטלפון' : '' }, { lastAt: at, lastText: text.slice(0, 200), lastDir: 'out' });
}
const WA_RANK = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
async function waStatus(s) {
  let ref = null; const mp = await db.doc('waIds/' + s.id).get();
  if (mp.exists) ref = db.doc('waChats/' + mp.data().chat + '/msgs/' + mp.data().msg);
  else if (s.recipient_id) ref = db.doc('waChats/' + s.recipient_id + '/msgs/' + s.id);
  if (!ref) return;
  const cur = await ref.get(); if (!cur.exists) return;
  if ((WA_RANK[s.status] || 0) <= (WA_RANK[cur.data().status] || 0) && s.status !== 'failed') return;
  const up = { status: s.status, ['at_' + s.status]: (+s.timestamp || 0) * 1000 };
  if (s.status === 'failed') up.error = waErr((s.errors && s.errors[0]) || {});
  await ref.update(up);
}
function waErr(e) {
  const c = +e.code;
  if (c === 131047) return 'עברו יותר מ-24 שעות מההודעה האחרונה של הלקוח. צריך לשלוח תבנית מאושרת.';
  if (c === 131026) return 'ההודעה לא נמסרה (המספר לא בוואטסאפ או חסם).';
  if (c === 132001 || c === 132000) return 'בעיה בתבנית: ' + (e.message || '');
  return (e.title || e.message || 'שגיאה') + (c ? ' (' + c + ')' : '');
}
const crypto = require('crypto');
const waIdOk = (x) => /^\d{6,20}$/.test(String(x || ''));
const waMsgIdOk = (x) => /^[A-Za-z0-9._=:+-]{4,200}$/.test(String(x || ''));
exports.waWebhook = functions.region(REGION).https.onRequest(async (req, res) => {
  try {
    const c = await waCfg();
    if (req.method === 'GET') {
      if (req.query['hub.mode'] === 'subscribe' && c.verify && req.query['hub.verify_token'] === c.verify) { res.status(200).send(String(req.query['hub.challenge'] || '')); return; }
      res.status(403).send('forbidden'); return;
    }
    if (req.method !== 'POST') { res.status(405).send('no'); return; }
    if (c.appSecret) {
      const sig = String(req.get('x-hub-signature-256') || ''), mine = 'sha256=' + crypto.createHmac('sha256', c.appSecret).update(req.rawBody || '').digest('hex');
      if (sig.length !== mine.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mine))) { res.status(403).send('bad signature'); return; }
    }
    const b = req.body || {}, biz = String((c.status && c.status.phoneDigits) || '');
    for (const en of b.entry || []) for (const ch of en.changes || []) {
      const v = ch.value || {}, f = ch.field;
      // Aliana's own number (owner, Nov 8): her messages go to aliana-wa.js, never to the leads inbox
      if (c.aliPhoneId && v.metadata && v.metadata.phone_number_id === c.aliPhoneId) { if (f === 'messages') await require('./aliana-wa.js').aliHook(v); continue; }
      // only events for OUR number (the phone id is not public); without the app secret this is what stops forged posts
      if (c.phoneId && (c.provider === '360dialog' ? (v.metadata && v.metadata.phone_number_id && v.metadata.phone_number_id !== c.phoneId) : (!v.metadata || v.metadata.phone_number_id !== c.phoneId))) continue;
      if (f === 'messages') {
        const names = {}; (v.contacts || []).forEach((x) => { names[x.wa_id] = (x.profile && x.profile.name) || ''; });
        for (const m of v.messages || []) if (waIdOk(m.from) && waMsgIdOk(m.id)) await waIncoming(m, String(names[m.from] || '').slice(0, 80), true);
        for (const s of v.statuses || []) if (waMsgIdOk(s.id)) await waStatus(s);
      } else if (f === 'smb_message_echoes') {
        for (const m of v.message_echoes || []) if (waIdOk(m.to) && waMsgIdOk(m.id)) await waOutgoing(m.to, m, 'app');
      } else if (f === 'history') {
        const me = String((v.metadata && v.metadata.display_phone_number) || biz).replace(/\D/g, '');
        for (const h of v.history || []) for (const t of h.threads || []) for (const m of t.messages || []) {
          if (!waIdOk(t.id) || !waMsgIdOk(m.id)) continue;
          if (String(m.from).replace(/\D/g, '') === me) await waOutgoing(t.id, m, 'history');
          else { const cref = db.doc('waChats/' + t.id), at = (+m.timestamp || 0) * 1000, text = waText(m); await waSave(t.id, m.id, { dir: 'in', type: m.type, text, at, src: 'history' }, { lastAt: at, lastText: text.slice(0, 200), lastDir: 'in', lastInAt: at }); }
        }
      }
    }
    res.status(200).send('ok');
  } catch (e) { console.error('waWebhook', e); res.status(200).send('ok'); }
});
// a message written in the system (queued) → send it through WhatsApp
exports.onWaOut = trig('waChats/{chat}/msgs/{id}').onCreate(async (snap, ctx) => {
  const m = snap.data() || {}; if (m.dir !== 'out' || m.status !== 'queued') return;
  const c = await waCfg(), chat = ctx.params.chat;
  if (!c.token || (c.provider !== '360dialog' && !c.phoneId)) return snap.ref.update({ status: 'failed', error: 'וואטסאפ עוד לא מחובר (הגדרות אצל הבעלים).' });
  let body;
  if (m.type === 'template' && m.tpl) {
    const nm = Array.isArray(m.tpl.names) ? m.tpl.names : [];
    const params = (m.tpl.params || []).map((t, i) => ({ type: 'text', ...(nm[i] ? { parameter_name: nm[i] } : {}), text: String(t || '-') }));
    body = { messaging_product: 'whatsapp', to: chat, type: 'template', template: { name: m.tpl.name, language: { code: m.tpl.lang || 'he' }, ...(params.length ? { components: [{ type: 'body', parameters: params }] } : {}) } };
  } else body = { messaging_product: 'whatsapp', recipient_type: 'individual', to: chat, type: 'text', text: { body: String(m.text || '').slice(0, 4096), preview_url: true } };
  try {
    const r = await waApi(c, 'POST', c.provider === '360dialog' ? 'messages' : c.phoneId + '/messages', body);
    const wamid = r.messages && r.messages[0] && r.messages[0].id;
    await snap.ref.update({ status: 'sent', wamid: wamid || '', sentAt: Date.now() });
    if (wamid) await db.doc('waIds/' + wamid).set({ chat, msg: snap.id });
    await db.doc('waChats/' + chat).set({ waId: chat, phone: waLocal(chat), lastAt: m.at || Date.now(), lastText: String(m.text || '').slice(0, 200), lastDir: 'out' }, { merge: true });
    await waClaim(chat, m).catch((e) => console.error('waClaim', e.message));
  } catch (e) { await snap.ref.update({ status: 'failed', error: waErr({ code: e.code, message: e.message }) }); }
});
// the first employee who writes to a customer takes the chat and the lead (owner, Nov 8): from then on only they (and the owner) see the chat.
// Not for automatic messages, guide chats or the owner (the owner sees every chat anyway).
async function waClaim(chat, m) {
  const by = String(m.by || '');
  if (!/^[A-Za-z0-9]{20,40}$/.test(by)) return;
  const role = await db.doc('roles/' + by).get();
  if (!role.exists) return;
  try { const u = await admin.auth().getUser(by); if (u.emailVerified && (await pwIsOwnerMail(u.email))) return; } catch (e) {}
  const ref = db.doc('waChats/' + chat);
  const res = await db.runTransaction(async (t) => {
    const d = await t.get(ref); if (!d.exists) return null;
    const c = d.data() || {}; if (c.guide || c.agent) return null;
    const name = String(m.byName || (role.data() || {}).name || '');
    t.update(ref, { agent: by, agentName: name, agentAt: Date.now() });
    return { leadId: c.leadId || '', name };
  });
  if (!res || !res.leadId) return;
  const lr = db.doc('leads/' + res.leadId), ld = await lr.get();
  if (!ld.exists) return;
  const l = ld.data() || {};
  if (l.owner === by) return;
  await lr.update({ owner: by, ownerName: res.name, updatedAt: Date.now(),
    acts: admin.firestore.FieldValue.arrayUnion({ at: Date.now(), by, byName: res.name, kind: 'note', text: 'לקח/ה אחריות על הליד (כתב/ה ללקוח בוואטסאפ)' }) });
}
// settings saved → check the connection, subscribe the app to the account, refresh the approved templates
async function waSync() {
  const ref = db.doc('wacfg/main'), c = await waCfg(), st = { at: Date.now() };
  try {
    if (!c.token) throw new Error('חסר מפתח (token)');
    let tpls = [];
    if (c.provider === '360dialog') {
      try { await waApi(c, 'POST', 'v1/configs/webhook', { url: 'https://' + REGION + '-hotel-shifts.cloudfunctions.net/waWebhook' }); st.webhook = 'הוגדר אוטומטית'; } catch (e) { st.webhook = 'לא הוגדר: ' + e.message; }
      const t = await waApi(c, 'GET', 'v1/configs/templates'); tpls = t.waba_templates || t.data || [];
    } else {
      if (!c.phoneId || !c.wabaId) throw new Error('חסרים Phone number ID או WhatsApp Business Account ID');
      const p = await waApi(c, 'GET', c.phoneId + '?fields=display_phone_number,verified_name,quality_rating');
      st.phone = p.display_phone_number || ''; st.name = p.verified_name || ''; st.quality = p.quality_rating || ''; st.phoneDigits = String(p.display_phone_number || '').replace(/\D/g, '');
      try { await waApi(c, 'POST', c.wabaId + '/subscribed_apps'); st.sub = true; } catch (e) { st.sub = false; st.subErr = e.message; }
      const t = await waApi(c, 'GET', c.wabaId + '/message_templates?fields=name,language,status,components&limit=200'); tpls = t.data || [];
    }
    const out = tpls.filter((x) => String(x.status || '').toUpperCase() === 'APPROVED').map((x) => {
      const bodyC = (x.components || []).find((k) => String(k.type).toUpperCase() === 'BODY') || {}, txt = bodyC.text || '';
      const names = tplNames(txt), n = names.length ? names.length : Math.max(0, ...(txt.match(/\{\{(\d+)\}\}/g) || []).map((s) => +s.replace(/\D/g, '')));
      return { name: x.name, lang: x.language || 'he', body: txt, n, ...(names.length ? { names } : {}) };
    });
    st.ok = true; st.msg = 'מחובר'; st.templates = out.length;
    await db.doc('wapub/main').set({ on: true, phone: st.phone || '', name: st.name || '', templates: out, at: Date.now() });
  } catch (e) { st.ok = false; st.msg = e.message; await db.doc('wapub/main').set({ on: false, at: Date.now() }, { merge: true }); }
  await ref.set({ status: st }, { merge: true });
}
exports.onWaCfg = trig('wacfg/main').onWrite(async (ch) => {
  if (!ch.after.exists) { await db.doc('wapub/main').set({ on: false, templates: [] }); return; }
  const a = ch.after.data() || {}, b = ch.before.exists ? ch.before.data() : {};
  const keys = ['provider', 'token', 'phoneId', 'wabaId', 'syncReq'];
  if (!keys.some((k) => a[k] !== b[k])) return;
  await waSync();
});

// ================= Reception: end-of-shift report reminder (owner, Oct 31) =================
// every 10 min: reception staff whose shift (per the PUBLISHED schedule, incl. approved requests/extensions) ends within
// the next 20 minutes (or ended in the last hour) and who haven't submitted a shift report since the shift began → one push.
// dedupe: srRemind/{shiftId__uid}
const ilOffsetMin = (ms) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)); const g = (t) => +p.find((x) => x.type === t).value; return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - ms) / 60000; };
const ilEpoch = (date, hm) => { const [y, m, d] = date.split('-').map(Number), [H, M] = String(hm || '00:00').split(':').map(Number); const guess = Date.UTC(y, m - 1, d, H, M); return guess - ilOffsetMin(guess) * 60000; };
const weekOfIso = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
exports.srRemind = functions.region(REGION).pubsub.schedule('every 5 minutes').timeZone('Asia/Jerusalem').onRun(async () => {
  const now = Date.now(), today = ilDate(new Date(now)), yday = ilDate(new Date(now - 864e5));
  const qs = await db.collection('shifts').where('date', 'in', [yday, today]).get();
  const list = qs.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.dept === 'reception' && +s.need > 0 && s.start && s.end);
  if (!list.length) return null;
  const scheds = {}, reqs = {};
  const sched = async (s) => { const h = s.hotel || 'main', w = weekOfIso(s.date), k = h === 'main' ? w : w + '_' + h; if (!(k in scheds)) { const d = await db.doc('schedule/' + k).get(); scheds[k] = d.exists ? d.data() : null; } return scheds[k]; };
  const hreqs = async (h) => { if (!(h in reqs)) { const q = await db.collection('requests').where('hotel', '==', h).where('status', '==', 'approved').get(); reqs[h] = q.docs.map((d) => d.data()); } return reqs[h]; };
  let sent = 0;
  for (const s of list) {
    const h = s.hotel || 'main', sd = await sched(s); if (!sd || !sd.published) continue;
    const R = await hreqs(h);
    let a = [...((sd.assign || {})[s.id] || [])];
    for (const r of R) {
      if (r.type === 'extend') continue;
      if (r.from === s.id) a = a.filter((u) => u !== r.uid); if (r.to === s.id && !a.includes(r.uid)) a.push(r.uid);
      if (r.type === 'swap' && r.peer) { if (r.from === s.id && !a.includes(r.peer)) a.push(r.peer); if (r.to === s.id) a = a.filter((u) => u !== r.peer); }
    }
    const startMs = ilEpoch(s.date, s.start);
    for (const u of a) {
      const ext = R.find((r) => r.type === 'extend' && r.shift === s.id && r.uid === u);
      const end = (ext && ext.newEnd) || ((sd.ext || {})[s.id] || {})[u] || s.end;
      let endMs = ilEpoch(s.date, end); if (endMs <= startMs) endMs += 864e5; // night shift ends the next day
      if (now < endMs - 5 * 60000 || now > endMs + 60 * 60000) continue;
      const key = 'srRemind/' + s.id + '__' + u, done = await db.doc(key).get(); if (done.exists) continue;
      const rep = await db.collection('shiftReports').where('empUid', '==', u).get();
      const filed = rep.docs.some((d) => (+d.data().createdAt || 0) >= startMs - 3600e3);
      await db.doc(key).set({ uid: u, shift: s.id, hotel: h, at: now, filed });
      if (filed) continue;
      const hn = await hotelName(h), hhmm = String(end).slice(0, 5);
      await sendTo([u], { title: '📝 לא לשכוח דוח סוף משמרת', body: `${hn ? hn + ' · ' : ''}המשמרת שלך מסתיימת ב-${hhmm}. לפני שיוצאים ממלאים "דוח סיכום משמרת" בעמוד הקבלה.`, hash: '#front', tag: 'srr-' + s.id + '-' + u });
      sent++;
    }
  }
  return sent;
});

// WhatsApp templates approved in Meta reach the system by themselves: re-read them every 30 minutes (owner, Nov 1:
// new templates only appeared after a manual "רענון תבניות")
exports.waTplSync = functions.region(REGION).pubsub.schedule('every 30 minutes').timeZone('Asia/Jerusalem').onRun(async () => {
  const c = await db.doc('wacfg/main').get(); if (!c.exists || !c.data().token) return;
  await waSync().catch((e) => console.error('waTplSync', e));
});

// automatic WhatsApp template to every new lead, chosen by the lead's place (waauto/main, owner card on the leads WhatsApp tab)
const waIdFrom = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '972' + d.slice(1); else if (d.length === 9 && d[0] === '5') d = '972' + d; return d.length >= 11 && d.length <= 15 ? d : ''; };
exports.onLeadAuto = trig('leads/{id}').onCreate(async (snap) => {
  const l = snap.data() || {}, id = snap.id;
  if (l.source === 'whatsapp' || l.waAutoAt || /^wa_/.test(id)) return;
  if (l.createdAt && Date.now() - l.createdAt > 2 * 864e5) return; // old leads that arrive late (backfills) are not messaged
  const a = (await db.doc('waauto/main').get()).data() || {}; if (!a.on) return;
  if (a.metaOnly && !/^meta_/.test(id)) return;
  // lead kind (events / rooms / spa), same as the client's leadCat: own cat, else the campaign's mapping, else words, else events
  let cat = l.cat || '';
  if (!cat) { try { const m = ((await db.doc('leadcats/main').get()).data() || {}).campCat || {}; cat = m[String(l.campaign || '').trim()] || ''; } catch (e) {} }
  if (!cat) { const g = (x) => /כלה|כלות|התארגנות|bride|bridal/i.test(x) ? 'bride' : /ספא|spa|עיסוי|massage|טיפולי|טיפול זוגי|wellness/i.test(x) ? 'spa' : /חדר|חדרים|room|לינה|נופש|חופש|stay|night|לילה|לילות|סוויט|suite|booking|הזמנת מלון/i.test(x) ? 'rooms' : ''; cat = g(String(l.campaign || '')) || g([l.type, l.notes].join(' ')) || 'events'; }
  const pre = cat === 'events' ? '' : cat + ':';
  const rules = a.rules || {}, r = rules[pre + (l.venue || '')] || rules[pre + '*']; if (!r || !r.tpl) return;
  const pub = (await db.doc('wapub/main').get()).data() || {}; if (!pub.on) return;
  const t = (pub.templates || []).find((x) => x.name === r.tpl && (!r.lang || x.lang === r.lang));
  const to = waIdFrom(l.phone), now = Date.now();
  const note = (txt) => snap.ref.update({ waAutoAt: now, acts: admin.firestore.FieldValue.arrayUnion({ at: now, by: 'auto', byName: 'אוטומטי', kind: 'whatsapp', text: txt }) });
  if (!t) return note('הודעת וואטסאפ אוטומטית לא נשלחה: התבנית ' + r.tpl + ' לא נמצאה ברשימת התבניות המאושרות');
  if (!to) return note('הודעת וואטסאפ אוטומטית לא נשלחה: אין מספר טלפון תקין');
  const first = String(l.name || '').trim().split(/\s+/)[0] || '';
  const O = await org(), spaLink = String(O.url || APP).replace(/[^/]*$/, '') + 'spa.html' + '?' + [l.name && 'n=' + encodeURIComponent(String(l.name).trim().slice(0, 80)), l.phone && 'p=' + encodeURIComponent(String(l.phone).trim().slice(0, 20))].filter(Boolean).join('&');
  const params = Array.from({ length: t.n || 0 }, (_, i) => { const p = (r.params || [])[i] || {}; const v = p.src === 'first' ? first : p.src === 'name' ? l.name : p.src === 'venue' ? (r.venueName || '') : p.src === 'spalink' ? spaLink.replace(/\?$/, '') : p.text; return String(v || '').trim() || '-'; });
  const text = tplText(t, params);
  const cref = db.doc('waChats/' + to), cs = await cref.get();
  if (!cs.exists) await cref.set({ waId: to, phone: waLocal(to), name: l.name || '', leadId: id, createdAt: now, createdBy: 'auto', unread: 0, status: 'open', cat });
  else if (!cs.data().leadId) await cref.set({ leadId: id }, { merge: true });
  await cref.collection('msgs').add({ dir: 'out', type: 'template', tpl: tplRef(t, params), text, status: 'queued', by: 'auto', byName: 'הודעה אוטומטית', at: now, src: 'auto' });
  await note('נשלחה הודעת וואטסאפ אוטומטית (' + t.name + ')');
});

// hotel manager's message to everyone on shift (broadcasts, gm page card) → push to each recipient
exports.onBroadcast = trig('broadcasts/{id}').onCreate(async (snap) => {
  const b = snap.data() || {}; let to = (b.to || []).filter((u) => typeof u === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(u)); if (!to.length) return;
  // owner, Nov 4: a hotel manager's message reaches only that hotel's staff; only the CEO (or the owner) sends to the whole chain
  let ceo = false;
  try { const r = await db.doc('roles/' + b.by).get(); ceo = !!(r.exists && (r.data().apps || {}).ceo); } catch (e) {}
  if (!ceo) { try { const u = await admin.auth().getUser(b.by); ceo = !!u.emailVerified && (await pwIsOwnerMail(u.email)); } catch (e) {} }
  if (!ceo) {
    if (b.hotel === 'chain' || !b.hotel) to = [];
    else {
      const docs = await db.getAll(...to.map((u) => db.doc('employees/' + u)));
      to = docs.filter((d) => d.exists && (d.data().hotel || 'main') === b.hotel).map((d) => d.id);
    }
    if (to.length !== (b.to || []).length) {
      const names = {}; for (const u of to) if (b.toNames && b.toNames[u]) names[u] = b.toNames[u];
      await snap.ref.update({ to, toNames: names, trimmed: true }).catch(() => {});
    }
    if (!to.length) return;
  }
  if (b.kind === 'hkupd') return sendTo(to, { title: '🧹 בקשה מהקבלה' + (b.byName ? ' · ' + b.byName : ''), body: 'נא לעדכן עכשיו במערכת את מצב החדרים שלך', hash: '#hk', tag: 'hkupd-' + b.hotel });
  return sendTo(to, { title: '📣 הודעה מ' + (b.byName || 'המנהל'), body: String(b.text || '').slice(0, 180), hash: '#', tag: 'bc-' + snap.id });
});

// ---------- spa online booking (owner, Nov 2): public page spa.html → GET free slots / POST a booking ----------
// settings spacfg/main.online {on, hotel, hours:{0..6:{o,c,off}}, step, rooms, lead (hours ahead), days, maxPpl, intro, policy}; treatments = spacfg/main.menu items with online !== false.
// Bookings are normal spa docs (source 'online'); blocked time = spa docs with kind 'block'. Each booking takes one treatment room for mins + the break.
const SPA_RATE_H = 6; // max bookings per IP per hour
const hmMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const minHm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
async function spaOnlineCfg() { const d = await db.doc('spacfg/main').get(); const c = d.exists ? d.data() : {}; return { c, o: c.online || {} }; }
// therapists (owner, Nov 2): the guest asks per person for 'any' | 'm' | 'f'; a slot is offered only when enough therapists of that kind are on shift that day
// (spaShifts/{date}.ther {tid:{o,c}}) for the whole treatment and not busy with another treatment (assigned tid, or an unassigned person counted by kind).
// When no therapists are defined at all (spacfg.ther empty) the therapist check is skipped and only rooms count.
function spaTherPick(c, roster, dayDocs, date, a, e, want) {
  const thers = (c.ther || []).filter((t) => t.active !== false), brk = Math.max(0, +c.brk || 0);
  if (!thers.length) return { ok: true, pick: want.map(() => '') };
  const on = thers.filter((t) => { const r = roster[t.id]; return r && hmMin(r.o) <= a && hmMin(r.c) >= e - brk; });
  const busy = new Set(), need = { m: 0, f: 0, any: 0 };
  for (const b of dayDocs) {
    if (b.status === 'canceled' || b.kind === 'block') continue;
    const ba = hmMin(b.time), be = ba + (+b.mins || 60) + brk; if (!(ba < e && a < be)) continue;
    const n = +b.people || 1;
    for (let i = 0; i < n; i++) { const tid = (b.tid || [])[i]; if (tid) busy.add(tid); else { const k = (b.ther || [])[i] || 'any'; need[k === 'm' || k === 'f' ? k : 'any']++; } }
  }
  const free = on.filter((t) => !busy.has(t.id)), fm = free.filter((t) => t.g === 'm'), ff = free.filter((t) => t.g !== 'm');
  const wm = want.filter((k) => k === 'm').length, wf = want.filter((k) => k === 'f').length, wa = want.length - wm - wf;
  const nm = need.m + wm, nf = need.f + wf, na = need.any + wa;
  if (fm.length < nm || ff.length < nf || (fm.length - nm) + (ff.length - nf) < na) return { ok: false };
  // pick therapists for the new booking, leaving the ones older unassigned bookings still need
  const poolM = fm.slice(need.m), poolF = ff.slice(need.f), pick = [];
  for (const k of want) pick.push(k === 'm' ? poolM.shift() : k === 'f' ? poolF.shift() : null);
  for (let i = 0; i < pick.length; i++) if (!pick[i]) pick[i] = (poolF.length >= poolM.length ? poolF.shift() : poolM.shift()) || poolM.shift() || poolF.shift();
  return { ok: true, pick: pick.map((t) => (t ? t.id : '')) };
}
function spaFree(o, c, date, mins, dayDocs, nowMs, roster, want) {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay(), h = (o.hours || {})[dow] || {};
  if (h.off || !h.o || !h.c) return [];
  const open = hmMin(h.o), close = hmMin(h.c), step = Math.max(10, +o.step || 30), rooms = Math.max(1, +o.rooms || 1), brk = Math.max(0, +c.brk || 0);
  const busy = dayDocs.filter((b) => b.status !== 'canceled').map((b) => ({ a: hmMin(b.time), e: hmMin(b.time) + (+b.mins || 60) + (b.kind === 'block' ? 0 : brk), all: b.kind === 'block' }));
  const minStart = nowMs + Math.max(0, +o.lead || 0) * 36e5, out = [];
  for (let t = open; t + mins <= close; t += step) {
    if (ilEpoch(date, minHm(t)) < minStart) continue;
    const e = t + mins + brk; let n = 0, blocked = false;
    for (const x of busy) { if (x.a < e && t < x.e) { if (x.all) { blocked = true; break; } n++; } }
    if (!blocked && n < rooms && (!want || h.req || spaTherPick(c, roster || {}, dayDocs, date, t, e, want).ok)) out.push(minHm(t));
  }
  return out;
}
const spaUrlOk = (u) => /^https:\/\/[^\s"'<>]+$/.test(String(u || ''));
const spaItems = (c) => (c.menu || []).filter((m) => m.online !== false && (m.pkg ? (spaUrlOk(m.url) || ((c.online || {}).resPhone)) : +m.mins > 0)).map((m) => ({ id: m.id, name: m.name, mins: +m.mins || 0, price: +m.price || 0, desc: m.desc || '', couple: m.ppl == 2, wk: +m.fri || +m.sat || 0, ...(m.pkg ? { pkg: true, url: spaUrlOk(m.url) ? m.url : '' } : {}) }));
const spaReqDay = (o, date) => !!((o.hours || {})[new Date(date + 'T12:00:00Z').getUTCDay()] || {}).req;
// price of an online item on a date: single = per person, couple = per pair; one weekend supplement (Fri + Sat) added per unit
const spaPrice = (it, date, ppl) => { const w = new Date(date + 'T12:00:00Z').getUTCDay(), u = it.price + (w === 5 || w === 6 ? it.wk : 0); return it.couple ? u : u * ppl; };
exports.spaPublic = functions.region(REGION).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.set('Access-Control-Allow-Methods', 'GET, POST');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const { c, o } = await spaOnlineCfg();
    if (!o.on) { res.status(200).json({ on: false }); return; }
    const today = ilDate(new Date()), days = Math.min(90, Math.max(1, +o.days || 30)), last = ilDate(new Date(Date.now() + days * 864e5));
    const items = spaItems(c), biz = { name: (c.qbiz && c.qbiz.name) || '', phone: (c.qbiz && c.qbiz.phone) || '' };
    if (req.method === 'GET') {
      const date = String(req.query.date || ''), item = items.find((x) => x.id === String(req.query.item || '') && !x.pkg);
      const base = { on: true, biz, items, thers: (c.ther || []).some((t) => t.active !== false), intro: o.intro || '', policy: o.policy || (c.qbiz && c.qbiz.terms) || '', maxPpl: Math.max(1, +o.maxPpl || 2), today, last, hours: o.hours || {}, resPhone: String(o.resPhone || ''), wa: String(o.waPhone || '') || await (async () => { try { const w = await db.doc('wapub/main').get(); return (w.exists && w.data().on && w.data().phone) || ''; } catch (e) { return ''; } })() || String(o.resPhone || '') };
      if (!date || !item) { res.json(base); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > last) { res.json({ ...base, slots: [] }); return; }
      const want = String(req.query.ther || 'any').split(',').slice(0, 6).map((k) => (k === 'm' || k === 'f' ? k : 'any'));
      const [qs, rs] = await Promise.all([db.collection('spa').where('date', '==', date).get(), db.doc('spaShifts/' + date).get()]);
      res.json({ ...base, date, slots: spaFree(o, c, date, item.mins, qs.docs.map((d) => d.data()), Date.now(), (rs.exists && rs.data().ther) || {}, want) });
      return;
    }
    if (req.method !== 'POST') { res.status(405).send('method'); return; }
    const b = req.body || {}, name = String(b.name || '').trim().slice(0, 80), phone = String(b.phone || '').replace(/[^\d+]/g, '').slice(0, 20), email = String(b.email || '').trim().slice(0, 120);
    const item = items.find((x) => x.id === String(b.item || '') && !x.pkg), date = String(b.date || ''), time = String(b.time || ''), ppl0 = Math.min(Math.max(1, +o.maxPpl || 2), Math.max(1, Math.round(+b.people || 1)));
    const ppl = item && item.couple ? 2 : ppl0;
    const want = Array.from({ length: ppl }, (_, i) => { const k = (Array.isArray(b.ther) ? b.ther : [])[i]; return k === 'm' || k === 'f' ? k : 'any'; });
    if (!item || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || date < today || date > last) { res.status(400).json({ error: 'פרטי ההזמנה לא תקינים' }); return; }
    if (name.length < 2 || phone.replace(/\D/g, '').length < 9) { res.status(400).json({ error: 'צריך שם וטלפון תקינים' }); return; }
    if (!b.privacy) { res.status(400).json({ error: 'צריך לאשר את מדיניות הפרטיות' }); return; }
    if (b.website) { res.json({ ok: true }); return; } // honeypot
    const ip = String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim(), ipKey = require('crypto').createHash('sha256').update(ip + ':' + today).digest('hex').slice(0, 32);
    const hour = new Date().toISOString().slice(0, 13), rateRef = db.doc('spaRate/' + ipKey), ref = db.collection('spa').doc('on' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const local = phone.replace(/^\+?972/, '0'), hkeys = [];
    let hname = ''; try { const hd = await db.doc('hotels/' + (o.hotel || '-')).get(); hname = (hd.exists && hd.data().name) || ''; } catch (e) {}
    await db.runTransaction(async (tx) => {
      hkeys.length = 0;
      const rs = await tx.get(rateRef), rd = rs.exists ? rs.data() : {}, n = rd.hour === hour ? (+rd.n || 0) : 0;
      if (n >= SPA_RATE_H) throw Object.assign(new Error('יותר מדי ניסיונות. נסו שוב מאוחר יותר או התקשרו אלינו.'), { code: 429 });
      const qs = await tx.get(db.collection('spa').where('date', '==', date)), shd = await tx.get(db.doc('spaShifts/' + date));
      const docs = qs.docs.map((d) => d.data()), roster = (shd.exists && shd.data().ther) || {};
      const free = spaFree(o, c, date, item.mins, docs, Date.now(), roster, want);
      const tp = spaTherPick(c, roster, docs, date, hmMin(time), hmMin(time) + item.mins + Math.max(0, +c.brk || 0), want), tn = (id) => ((c.ther || []).find((t) => t.id === id) || {}).name || '';
      const isReq = spaReqDay(o, date);
      if (!free.includes(time) || (!isReq && !tp.ok)) throw Object.assign(new Error('השעה הזו כבר נתפסה. בחרו שעה אחרת.'), { code: 409 });
      tx.set(rateRef, { hour, n: n + 1, at: Date.now() });
      const hl = {};
      for (let i = 0; i < ppl; i++) { const k = spaHealthKey(); hl[i] = { k, ok: false }; hkeys.push(k);
        tx.set(db.doc('spaHealth/' + k), { status: 'pending', bookingId: ref.id, idx: i, people: ppl, hotel: o.hotel || '', hotelName: hname, date, time, treatment: item.name, name: i ? '' : name, phone: i ? '' : local, expMs: spaHealthExp(date), createdAt: Date.now(), createdBy: 'online' }); }
      tx.set(ref, { hl, hotel: o.hotel || '', date, time, treatment: item.name, mins: item.mins, people: ppl, ther: want, tid: isReq ? Array(ppl).fill('') : tp.pick, tname: isReq ? Array(ppl).fill('') : tp.pick.map(tn), tok: Array(ppl).fill(false),
        amount: spaPrice(item, date, ppl), adds: [], name, phone: local, email, notes: String(b.notes || '').trim().slice(0, 300), status: isReq ? 'request' : 'booked', source: 'online', itemId: item.id,
        consent: { privacy: true, marketing: !!b.marketing, at: Date.now() }, createdAt: Date.now(), createdBy: 'online', createdByName: 'הזמנה אונליין', updatedAt: Date.now() });
    });
    // a spa lead with the same phone is now won (best effort)
    if (!spaReqDay(o, date)) try { const ls = await db.collection('leads').where('phone', '==', local).limit(5).get(); for (const d of ls.docs) { const l = d.data(); if (['won', 'junk'].includes(l.stage)) continue;
      await d.ref.update({ stage: 'won', wonAt: Date.now(), wonValue: Math.round(spaPrice(item, date, ppl)), updatedAt: Date.now(), acts: admin.firestore.FieldValue.arrayUnion({ at: Date.now(), by: 'online', byName: 'הזמנה אונליין', kind: 'note', text: `הזמין/ה טיפול ספא אונליין: ${item.name} · ${date.slice(8, 10)}.${date.slice(5, 7)} ${time}` }) }); } } catch (e) {}
    res.json({ ok: true, req: spaReqDay(o, date), id: ref.id, health: hkeys, date, time, item: item.name, mins: item.mins, people: ppl, total: spaPrice(item, date, ppl) });
  } catch (e) { res.status(e.code === 429 || e.code === 409 ? e.code : 500).json({ error: e.code === 429 || e.code === 409 ? e.message : 'משהו השתבש. נסו שוב או התקשרו אלינו.' }); if (!(e.code === 429 || e.code === 409)) console.error('spaPublic', e); }
});

// ---- Login lockout (Nov 4, owner): 3 wrong passwords in a row lock the account until the password is reset ----
// Username/password sign-in goes through pwGuard op 'login': the server resolves the username, checks the lock,
// verifies the password with the Auth REST API and counts real failures. On the 3rd failure the password is replaced
// with a random one (so the old one no longer works anywhere) and, for real e-mails, Firebase sends a reset mail.
// On success it returns the account e-mail and the app signs in with it. Unknown logins get the same answers
// (a counter keyed by a hash of the login), so the endpoint doesn't reveal who has an account.
// Accounts without a real e-mail (reception desks, old usernames) are reset by a manager (op 'set').
// Docs authLocks/{key} and authRate/{ip} are admin-only (no rules match); authLockPub/{uid} is a readable mirror.
const PW_MAX = 3, PW_WIN = 24 * 3600e3;
const PW_DOMAINS = ['users.seven-collection.app', 'front.seven-collection.app'];
const WEB_KEY = process.env.WEB_API_KEY || 'AIzaSyAvI0CfZXIiiNql51SYTdGJT7XdPbWUOaA'; // public web key (same as config.js)
const realMail = (e) => !!e && !PW_DOMAINS.some((d) => String(e).toLowerCase().endsWith('@' + d));
const pwNorm = (l) => String(l || '').trim().toLowerCase().slice(0, 120);
async function pwUser(login) {
  login = pwNorm(login);
  if (!login) return null;
  const tries = [];
  if (login.includes('@')) tries.push(login);
  else {
    if (!/^[a-z0-9._-]{1,60}$/.test(login)) return null;
    try { const d = await db.doc('usernames/' + login).get(); if (d.exists && d.data().email) tries.push(String(d.data().email).toLowerCase()); } catch (e) {}
    tries.push(login + '@' + PW_DOMAINS[0], login + '@' + PW_DOMAINS[1]);
  }
  for (const em of tries) { try { return await admin.auth().getUserByEmail(em); } catch (e) {} }
  return null;
}
async function pwCaller(req) {
  const m = String(req.get('authorization') || '').match(/^Bearer (.+)$/);
  if (!m) return null;
  try { return await admin.auth().verifyIdToken(m[1]); } catch (e) { return null; }
}
async function pwIsOwnerMail(em) {
  em = String(em || '').toLowerCase();
  if (!em) return false;
  if (em === 'kfirdaabul1@gmail.com') return true;
  try { const o = await db.doc('orgcfg/main').get(); return !!(o.exists && String(o.data().ownerEmail || '').toLowerCase() === em); } catch (e) { return false; }
}
const pwIp = (req) => { const x = String(req.get('x-forwarded-for') || '').split(',').map((v) => v.trim()).filter(Boolean); return x.length ? x[x.length - 1] : String(req.ip || ''); };
async function pwRate(req, max) {
  const ref = db.doc('authRate/' + crypto.createHash('sha256').update(pwIp(req) + ':' + new Date().toISOString().slice(0, 13)).digest('hex').slice(0, 32));
  const n = await db.runTransaction(async (tx) => { const s = await tx.get(ref); const k = ((s.exists && s.data().n) || 0) + 1; tx.set(ref, { n: k, at: Date.now() }); return k; });
  return n > max;
}
async function pwResetMail(email) {
  const x = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=' + WEB_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }) }).catch(() => null);
  return !!(x && x.ok);
}
exports.pwGuard = functions.region(REGION).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.set('Access-Control-Allow-Methods', 'POST');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).send('method'); return; }
  const b = req.body || {}, op = String(b.op || '');
  try {
    if (op === 'login') {
      const login = pwNorm(b.login), pw = String(b.password || '');
      if (!login || !pw || pw.length > 200) { res.json({ err: 'cred' }); return; }
      if (await pwRate(req, 40)) { res.json({ rate: true }); return; }
      const u0 = await pwUser(login), now = Date.now();
      // only accounts that really sign in with a password are counted / locked (never touch a Google-only account)
      const u = u0 && (u0.providerData || []).some((p) => p.providerId === 'password') ? u0 : null;
      const ref = db.doc('authLocks/' + (u ? u.uid : 'x' + crypto.createHash('sha256').update(login).digest('hex').slice(0, 30)));
      const cur = await ref.get(), d = cur.exists ? cur.data() : {};
      const mail = !!u && realMail(u.email);
      if (d.locked) {
        if (mail && now - (d.mailAt || 0) > 10 * 60e3 && (await pwResetMail(u.email))) await ref.set({ mailAt: now }, { merge: true });
        res.json({ locked: true, mail }); return;
      }
      let ok = false;
      if (u && u.email) {
        const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + WEB_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: pw, returnSecureToken: false }) }).catch(() => null);
        const j = r ? await r.json().catch(() => ({})) : {};
        if (r && r.ok) ok = true;
        else {
          const m = String((j.error && j.error.message) || '');
          if (/TOO_MANY_ATTEMPTS/.test(m)) { res.json({ rate: true }); return; }
          if (/USER_DISABLED/.test(m)) { res.json({ err: 'disabled' }); return; }
          if (!r || !/INVALID|PASSWORD|NOT_FOUND|CREDENTIAL/.test(m)) { console.error('pwGuard verify', m || (r && r.status)); res.status(503).json({ err: 'verify' }); return; }
        }
      }
      if (ok) { if (cur.exists) await ref.delete().catch(() => {}); res.json({ ok: true, email: u.email }); return; }
      const fails = (d.lastAt && now - d.lastAt < PW_WIN ? d.fails || 0 : 0) + 1;
      const owner = !!u && (await pwIsOwnerMail(u.email));
      const locked = fails >= PW_MAX && !owner; // the owner is never locked out (only Firebase's own throttling)
      await ref.set({ uid: u ? u.uid : '', fails, lastAt: now, locked, lockedAt: locked ? now : null });
      if (locked && u) {
        await admin.auth().updateUser(u.uid, { password: crypto.randomBytes(24).toString('base64') });
        await admin.auth().revokeRefreshTokens(u.uid).catch(() => {});
        if (mail && (await pwResetMail(u.email))) await ref.set({ mailAt: now }, { merge: true });
      }
      res.json(locked ? { locked: true, mail } : { err: 'cred', left: Math.max(1, PW_MAX - fails) });
      return;
    }
    if (op === 'reset') {
      // "forgot password": resolve a username on the server (the username → e-mail map is not public)
      if (await pwRate(req, 40)) { res.json({ rate: true }); return; }
      const u = await pwUser(b.login);
      if (u && realMail(u.email)) await pwResetMail(u.email);
      res.json({ ok: true, mail: !!u && realMail(u.email), none: !u || !realMail(u.email) });
      return;
    }
    if (op === 'free') {
      const n = pwNorm(b.u);
      if (!/^[a-z0-9._-]{3,30}$/.test(n)) { res.json({ free: false }); return; }
      if (await pwRate(req, 60)) { res.json({ rate: true }); return; }
      const x = await db.doc('usernames/' + n).get();
      res.json({ free: !x.exists });
      return;
    }
    const tok = await pwCaller(req);
    if (!tok) { res.status(401).json({ error: 'auth' }); return; }
    // a manager sees how an employee signs in (owner, Nov 5: after the move to the new address everyone had to sign in again):
    // e-mail, username, sign-in methods, last sign-in. Never a password (Firebase keeps only a hash). 'sendreset' mails a reset link to a real e-mail.
    if (op === 'info' || op === 'sendreset') {
      const uid = String(b.uid || '');
      if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) { res.status(400).json({ error: 'bad' }); return; }
      const owner = tok.email_verified === true && (await pwIsOwnerMail(tok.email));
      let ok = owner;
      if (!ok && uid !== tok.uid) {
        const [cr, te] = await Promise.all([db.doc('roles/' + tok.uid).get(), db.doc('employees/' + uid).get()]);
        const c = cr.exists ? cr.data() : {}, hs = Array.isArray(c.hotels) ? c.hotels : [];
        ok = !!(c.apps || {}).hr && !c.station && te.exists && (hs.length === 0 || hs.includes(te.data().hotel || '') || te.data().hotel === 'chain');
      }
      if (!ok) { res.status(403).json({ error: 'forbidden' }); return; }
      let u = null; try { u = await admin.auth().getUser(uid); } catch (e) {}
      if (!u) { res.json({ none: true }); return; }
      const em = String(u.email || ''), real = realMail(em);
      if (op === 'sendreset') {
        if (!real) { res.status(400).json({ error: 'nomail' }); return; }
        if (!owner && (await pwIsOwnerMail(em))) { res.status(403).json({ error: 'forbidden' }); return; }
        res.json({ ok: await pwResetMail(em) }); return;
      }
      let username = '';
      try { const q = await db.collection('usernames').where('uid', '==', uid).limit(1).get(); if (!q.empty) username = q.docs[0].id; } catch (e) {}
      if (!username && /@(users|front)\.seven-collection\.app$/.test(em)) username = em.split('@')[0];
      res.json({ email: real ? em : '', username, providers: (u.providerData || []).map((p) => p.providerId), phone: u.phoneNumber || '', last: u.metadata && u.metadata.lastSignInTime || '', created: u.metadata && u.metadata.creationTime || '', locked: false });
      return;
    }
    if (op === 'set') {
      // a manager sets a new password for a reception desk or a username account (no real e-mail to reset with)
      const uid = String(b.uid || ''), pw = String(b.password || '');
      if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid) || pw.length < 6 || pw.length > 128) { res.status(400).json({ error: 'bad' }); return; }
      let target = null; try { target = await admin.auth().getUser(uid); } catch (e) {}
      if (!target || !(target.providerData || []).some((p) => p.providerId === 'password')) { res.status(404).json({ error: 'nouser' }); return; }
      const owner = tok.email_verified === true && (await pwIsOwnerMail(tok.email));
      let ok = owner;
      if (!ok) {
        if (realMail(target.email) || (await pwIsOwnerMail(target.email)) || uid === tok.uid) { res.status(403).json({ error: 'realmail' }); return; }
        const [cr, tr, te] = await Promise.all([db.doc('roles/' + tok.uid).get(), db.doc('roles/' + uid).get(), db.doc('employees/' + uid).get()]);
        const c = cr.exists ? cr.data() : {}, apps = c.apps || {}, hs = Array.isArray(c.hotels) ? c.hotels : [];
        const inH = (h) => hs.length === 0 || hs.includes(h);
        const t = tr.exists ? tr.data() : null;
        // never a target that holds pages the caller doesn't have
        const within = !t || Object.entries(t.apps || {}).every(([k, v]) => !v || apps[k] === true || (t.station && k === 'front'));
        if (t && t.station) ok = !!apps.perms && !c.station && inH((t.hotels || [])[0]);
        else if (te.exists) ok = !!apps.hr && !c.station && inH(te.data().hotel || '') && within;
      }
      if (!ok) { res.status(403).json({ error: 'forbidden' }); return; }
      await admin.auth().updateUser(uid, { password: pw });
      await db.doc('authLocks/' + uid).delete().catch(() => {});
      res.json({ ok: true });
      return;
    }
    res.status(400).json({ error: 'op' });
  } catch (e) { console.error('pwGuard', e); res.status(500).json({ error: 'server' }); }
});

// managers see who is locked out (for the reset button): mirror only {locked, lockedAt} to a readable doc
exports.onAuthLock = trig('authLocks/{uid}').onWrite(async (ch, ctx) => {
  const a = ch.after.exists ? ch.after.data() : null, ref = db.doc('authLockPub/' + ctx.params.uid);
  if (a && a.locked) await ref.set({ uid: ctx.params.uid, locked: true, lockedAt: a.lockedAt || Date.now() });
  else await ref.delete().catch(() => {});
});

// housekeeping OOS (room blocked without a fault): blocked / released → the hotel's reception desk
exports.onHkBlock = functions.region(REGION).firestore.document('hkBlocks/{id}').onWrite(async (ch) => {
  const b = ch.before.exists ? ch.before.data() : null, a = ch.after.exists ? ch.after.data() : null, x = a || b;
  if (!x || !x.hotel) return null;
  if (a && b) return null;
  const st = await stationsOf(x.hotel); if (!st.length) return null;
  const hn = await hotelName(x.hotel);
  const msg = a ? { title: `🔒 חדר ${x.room} נחסם (OOS)`, body: `${hn}${a.until ? ' · עד ' + a.until.split('-').reverse().slice(0, 2).join('.') : ''}${a.byName ? ' · ' + a.byName : ''}` }
    : { title: `🔓 חדר ${x.room} שוחרר וחזר למכירה`, body: `${hn} · החדר עבר ל-VD לניקוי` };
  await sendTo(st.filter(u => !a || u !== a.by), { ...msg, hash: '#hk', tag: 'oos-' + x.hotel + '-' + x.room });
  return null;
});

/* ---------- group guide page (owner, Nov 5): guide.html?k=<guideKey> calls this public endpoint.
   groups/{id} {guideKey 'g'+32hex, guideRooms spec "101-105 210", guideName, guidePhone, guideMsgs [{id, at, text, byName}], halls, ci, co, hotel}.
   Works from the day before arrival until the day after departure; returns only what the guide needs (no prices, no agent, no notes). ---------- */
function roomsParse(spec) {
  const add = [], del = new Set();
  String(spec || '').split(/[\s,;]+/).filter(Boolean).forEach((t) => {
    const neg = t.startsWith('-'), x = neg ? t.slice(1) : t, m = x.match(/^(\d+)-(\d+)$/);
    if (m) { let a = +m[1], b = +m[2]; if (b < a) [a, b] = [b, a]; for (let i = a; i <= b && i - a < 500; i++) (neg ? del.add(String(i)) : add.push(String(i))); }
    else if (/^\d+[A-Za-z]?$/.test(x)) (neg ? del.add(x) : add.push(x));
  });
  return [...new Set(add)].filter((r) => !del.has(r)).slice(0, 400);
}
const addDaysIso = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// which meals a group has (same as the client gdMealKeys): board + days with another board; BB → breakfast, HB → + dinner, FB → + lunch, plus meals already set
function guideMealKeys(g) {
  const bs = new Set([g.board || ''].concat((g.dayBoards || []).map((x) => x && x.b))), k = new Set();
  bs.forEach((b) => { if (['bb', 'hb', 'fb'].includes(b)) k.add('bf'); if (['hb', 'fb'].includes(b)) k.add('dn'); if (b === 'fb') k.add('ln'); });
  Object.keys(g.meals || {}).forEach((m) => { const x = g.meals[m] || {}; if (x.f || x.t) k.add(m); });
  return ['bf', 'ln', 'dn'].filter((m) => k.has(m));
}
// meals per day of the stay (owner, Nov 9: every day can have other times). Night d has board dayBoards[d] || board:
// dinner on d (HB/FB), breakfast the next morning (BB/HB/FB), lunch the next day (FB). No board but meal times set → those meals on every relevant day.
function guideDays(g) {
  if (!g.ci) return [];
  const co = g.co && g.co > g.ci ? g.co : addDaysIso(g.ci, 1), DB = {}, M = g.meals || {}, out = [];
  (g.dayBoards || []).forEach((x) => { if (x && x.d && x.b) DB[x.d] = x.b; });
  const anyB = !!g.board || Object.keys(DB).length, B = (d) => DB[d] || g.board || '';
  const has = (m) => !!((M[m] || {}).f || (M[m] || {}).t);
  for (let d = g.ci, i = 0; d <= co && i < 31; d = addDaysIso(d, 1), i++) {
    const prev = addDaysIso(d, -1), L = [];
    const bf = d > g.ci && (anyB ? ['bb', 'hb', 'fb'].includes(B(prev)) : has('bf'));
    const ln = d > g.ci && d < co && (anyB ? B(prev) === 'fb' : has('ln'));
    const dn = d < co && (anyB ? ['hb', 'fb'].includes(B(d)) : has('dn'));
    if (bf) L.push('bf'); if (ln) L.push('ln'); if (dn) L.push('dn');
    if (L.length) out.push({ d, meals: L.map((k) => ({ k, f: String((M[k] || {}).f || '').slice(0, 5), t: String((M[k] || {}).t || '').slice(0, 5) })) });
  }
  return out;
}
const GUIDE_PRE_DAYS = 14; // the pre-arrival form opens 14 days before arrival (or earlier once it was sent)
const guidePreOpen = (g, today) => !!g.ci && today < addDaysIso(g.ci, -1) && (today >= addDaysIso(g.ci, -GUIDE_PRE_DAYS) || !!g.preSentAt);

exports.grpGuide = functions.region(REGION).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method === 'POST') { // the guide types the guests' names of one room (owner, Nov 5) → groups/{id}.guideNames {room:[names]}
    try {
      let bd = req.body || {}; if (typeof bd === 'string') { try { bd = JSON.parse(bd); } catch (e) { bd = {}; } }
      const k = String(bd.k || ''), room = String(bd.room || '').slice(0, 12), isPre = bd.op === 'pre';
      if (!/^g[0-9a-f]{32}$/.test(k) || (!room && !isPre)) { res.status(400).json({ error: 'bad' }); return; }
      { // at most 120 saves per link per hour
        const rr = db.doc('guideRate/' + k), hour = new Date().toISOString().slice(0, 13);
        const over = await db.runTransaction(async (tx) => { const s = await tx.get(rr), d = s.exists ? s.data() : {}, n = d.hour === hour ? (+d.n || 0) : 0; if (n >= 120) return true; tx.set(rr, { hour, n: n + 1 }); return false; });
        if (over) { res.status(429).json({ error: 'rate' }); return; }
      }
      if (isPre) { // pre-arrival form: the guide's preferred meal times (owner, Nov 9) → groups.guidePref; first fill → WhatsApp to the guide + push gm/groups
        const q = await db.collection('groups').where('guideKey', '==', k).limit(1).get();
        if (q.empty) { res.status(404).json({ error: 'notfound' }); return; }
        const g = q.docs[0].data(), today = ilDate(new Date());
        if (g.status === 'cancelled' || (!guidePreOpen(g, today) && !(g.ci && today >= addDaysIso(g.ci, -1) && today <= (g.co || g.ci)))) { res.status(410).json({ error: 'expired' }); return; }
        const days = guideDays(g), pref = {}, tm = (x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || '')) ? String(x) : '';
        const P = bd.pref && typeof bd.pref === 'object' ? bd.pref : {};
        days.forEach((x) => { const Q = P[x.d] && typeof P[x.d] === 'object' ? P[x.d] : {}; x.meals.forEach((m) => { const v = tm(Q[m.k]); if (v) (pref[x.d] = pref[x.d] || {})[m.k] = v; }); });
        const keys = days.length ? ['x'] : [];
        const note = String(bd.note == null ? '' : bd.note).replace(/[\u0000-\u0009\u000b-\u001f<>]/g, ' ').trim().slice(0, 500);
        if (keys.length && !Object.keys(pref).length) { res.status(400).json({ error: 'empty' }); return; }
        const first = !g.guidePrefAt, now = Date.now(), up = { guidePref: pref, guidePrefNote: note, guidePrefAt: now };
        if (first) up.guideWaReq = { at: now, kind: 'done', msgId: '', by: '', byName: 'אוטומטי' };
        await q.docs[0].ref.update(up);
        try {
          const h = g.hotel || '', NM = { bf: 'בוקר', ln: 'צהריים', dn: 'ערב' };
          const pick = ((((await db.doc('waauto/main').get()).data() || {}).guide || {}).notify || {})[h] || [];
          const to = pick.length ? pick : await roleHolders(h, ['gm', 'grp']); // specific people chosen by the owner, else gm + groups holders
          const body = [g.name || '', Object.keys(pref).sort().map((d) => d.slice(8, 10) + '/' + d.slice(5, 7) + ' ' + ['bf', 'ln', 'dn'].filter((k) => pref[d][k]).map((k) => NM[k] + ' ' + pref[d][k]).join(', ')).join(' · '), note].filter(Boolean).join(' · ').slice(0, 220);
          if (to.length) await sendTo(to, { title: (first ? '🧭 המדריך מילא את פרטי הקבוצה' : '🧭 המדריך עדכן את פרטי הקבוצה') + (g.ci ? ' · הגעה ' + g.ci.slice(8, 10) + '/' + g.ci.slice(5, 7) : ''), body, hash: '#grp', tag: 'gdpre-' + q.docs[0].id });
        } catch (e) { console.warn('guide pre push', e.message); }
        res.json({ ok: true, pref, note, first });
        return;
      }
      const names = (Array.isArray(bd.names) ? bd.names : []).slice(0, 12).map((x) => String(x == null ? '' : x).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60));
      const q = await db.collection('groups').where('guideKey', '==', k).limit(1).get();
      if (q.empty) { res.status(404).json({ error: 'notfound' }); return; }
      const g = q.docs[0].data(), today = ilDate(new Date());
      if (g.status === 'cancelled' || (g.ci && today < addDaysIso(g.ci, -1)) || (g.co && today > addDaysIso(g.co, 1))) { res.status(410).json({ error: 'expired' }); return; }
      if (!roomsParse(g.guideRooms).includes(room)) { res.status(400).json({ error: 'room' }); return; }
      while (names.length && !names[names.length - 1]) names.pop();
      await q.docs[0].ref.update(new admin.firestore.FieldPath('guideNames', room), names.length ? names : admin.firestore.FieldValue.delete(), 'guideNamesAt', Date.now());
      res.json({ ok: true, names });
    } catch (e) { res.status(500).json({ error: 'server' }); }
    return;
  }
  if (req.method !== 'GET') { res.status(405).send('method'); return; }
  const k = String(req.query.k || '');
  if (!/^g[0-9a-f]{32}$/.test(k)) { res.status(404).json({ error: 'notfound' }); return; }
  try {
    const q = await db.collection('groups').where('guideKey', '==', k).limit(1).get();
    if (q.empty) { res.status(404).json({ error: 'notfound' }); return; }
    const g = q.docs[0].data(), today = ilDate(new Date());
    if (g.status === 'cancelled') { res.status(404).json({ error: 'notfound' }); return; }
    if (g.ci && today < addDaysIso(g.ci, -1) && guidePreOpen(g, today)) { // before arrival: the pre-arrival form (owner, Nov 9)
      const o = await org(), M = g.meals || {};
      res.json({ mode: 'pre', name: g.name || '', hotel: await hotelName(g.hotel || ''), chain: o.name, ci: g.ci || '', co: g.co || '', guide: String(g.guideName || '').slice(0, 60),
        days: guideDays(g),
        pref: g.guidePref || {}, note: String(g.guidePrefNote || '').slice(0, 500), prefAt: g.guidePrefAt || 0, now: Date.now() });
      return;
    }
    if ((g.ci && today < addDaysIso(g.ci, -1)) || (g.co && today > addDaysIso(g.co, 1))) { res.status(410).json({ error: 'expired', ci: g.ci || '', co: g.co || '' }); return; }
    const h = g.hotel || '';
    let day = today; try { const hd = await db.doc('hkday/' + h).get(); if (hd.exists && hd.data().date) day = hd.data().date; } catch (e) { }
    let D = {}; try { const d = await db.doc('hk/' + h + '__' + day).get(); if (d.exists) D = d.data() || {}; } catch (e) { }
    let blk = {}; try { const b = await db.collection('hkBlocks').where('hotel', '==', h).get(); b.docs.forEach((x) => { const v = x.data(); if (v && v.room != null && (!v.from || v.from <= day) && (!v.until || v.until >= day)) blk[String(v.room)] = 1; }); } catch (e) { }
    const m = (f, r) => (D[f] || {})[r];
    const rooms = roomsParse(g.guideRooms).map((r) => {
      const c = m('clean', r) || '';
      let st = 'wait';
      if (blk[r]) st = 'oos';
      else if (m('dnd', r)) st = 'dnd';
      else if (c === 'ooo') st = 'fault';
      else if (m('done', r) || m('chk', r) || m('trtDone', r) || c === 'oc' || c === 'vc') st = 'clean';
      else if (m('start', r)) st = 'busy';
      else if (c === 'vi') st = 'ready';
      const at = st === 'dnd' ? (m('dnd', r) || 0) : (g.ci && day <= g.ci) ? 0 : (m('done', r) || m('chkAt', r) || m('start', r) || 0); // check-in day: no cleaning time (owner, Nov 5)
      if (g.ci && day <= g.ci) st = 'list'; // check-in day: only the list of rooms, no cleaning status (owner, Nov 5)
      const nm = ((g.guideNames || {})[r] || []).map((x) => String(x || '').slice(0, 60));
      return { r, st, at: typeof at === 'number' ? at : 0, pax: +((g.roomPax || {})[r]) || 0, cat: ['il', 'fo'].includes((g.roomCat || {})[r]) ? g.roomCat[r] : '', names: nm };
    });
    const o = await org();
    let vn = {}; try { const oc = await db.doc('orgcfg/main').get(); ((oc.exists && oc.data().venues) || []).forEach((v) => { if (v && v.id) vn[v.id] = v.name || v.id; }); } catch (e) { }
    const halls = (g.halls || []).filter((x) => x && x.date).sort((a, b) => String(a.date + (a.start || '')).localeCompare(String(b.date + (b.start || '')))).slice(0, 60)
      .map((x) => { const [v, a] = String(x.space || '').split('|'); return { place: a || vn[v] || v || '', past: x.date < today, date: x.date, start: x.start || '', end: x.end || '', guests: +x.guests || 0, note: String(x.note || '').slice(0, 200) }; });
    const msgs = (g.guideMsgs || []).filter((x) => x && x.text).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 50).map((x) => ({ at: x.at || 0, text: String(x.text).slice(0, 2000), by: String(x.byName || '').slice(0, 60) }));
    const meals = ['bf', 'ln', 'dn'].map((k) => { const x = (g.meals || {})[k] || {}; return x.f || x.t ? { k, f: String(x.f || '').slice(0, 5), t: String(x.t || '').slice(0, 5), place: String(x.place || '').slice(0, 60) } : null; }).filter(Boolean);
    // until the arrival day the pre-arrival form is also offered on the stay page (link sent late, owner Nov 9)
    const pre = g.ci && today <= g.ci ? { days: guideDays(g), pref: g.guidePref || {}, note: String(g.guidePrefNote || '').slice(0, 500), prefAt: g.guidePrefAt || 0, guide: String(g.guideName || '').slice(0, 60) } : null;
    res.json({ name: g.name || '', hotel: await hotelName(h), chain: o.name, ci: g.ci || '', co: g.co || '', day, rooms, halls, msgs, meals, pre, now: Date.now() });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});


/* ---------- group guide over the system WhatsApp (owner, Nov 5): the reception / group screen sets groups/{id}.guideWaReq {at, kind invite|msg, msgId, by, byName}.
   Inside the 24h window (the guide wrote to us) a free text is sent; otherwise the approved template chosen in waauto/main.guide {inv:{tpl,lang}, msg:{tpl,lang}}
   with {{1}} guide name, {{2}} group name, {{3}} hotel, {{4}} link (invite) / message text (msg). The chat is waChats/{waId} {guide:true, groupId, hotel, cat:'events'};
   the guide's replies don't open a lead: they go to the group's guideReplies and push the hotel's reception desks + front holders. Result → guideWaLast. ---------- */
async function guideReply(c, text, at) {
  const ref = db.doc('groups/' + c.groupId);
  try { await db.runTransaction(async (tx) => { const g = await tx.get(ref); if (!g.exists) return; const L = (g.data().guideReplies || []).concat([{ at, text: String(text).slice(0, 1000) }]).slice(-40); tx.update(ref, { guideReplies: L }); }); } catch (e) { console.warn('guide reply', e.message); }
  const h = c.hotel || '';
  const to = [...new Set([...(await stationsOf(h)), ...(await roleHolders(h, ['front']))])];
  if (to.length) await sendTo(to, { title: '🧭 ' + (c.name || 'מדריך קבוצה') + (c.groupName ? ' · ' + c.groupName : ''), body: String(text).slice(0, 140), hash: '#front', tag: 'gd-' + c.groupId });
}
exports.onGuideWa = trig('groups/{id}').onUpdate(async (ch, ctx) => {
  const a = ch.after.data() || {}, b = ch.before.data() || {}, q = a.guideWaReq || {};
  if (!q.at || (b.guideWaReq && b.guideWaReq.at === q.at)) return;
  const id = ctx.params.id, ref = ch.after.ref, now = Date.now();
  const done = (ok, msg, how) => ref.update({ guideWaLast: { at: now, req: q.at, kind: q.kind || '', ok, msg: String(msg || '').slice(0, 300), how: how || '' }, ...(ok && q.kind === 'pre' ? { preSentAt: now } : {}) });
  try {
    if (q.by) { const r = await db.doc('roles/' + q.by).get(); const rd = r.exists ? r.data() : {}; const hs = rd.hotels || [], ap = rd.apps || {};
      let okRole = (ap.front || ap.gm || ap.shifts || ap.grp) && (!hs.length || hs.includes(a.hotel));
      if (!okRole) { try { const u = await admin.auth().getUser(q.by); okRole = !!u.emailVerified && (await pwIsOwnerMail(u.email)); } catch (e) {} }
      if (!okRole) return done(false, 'אין הרשאה לשלוח'); }
    const c = await waCfg(); if (!c.token) return done(false, 'הוואטסאפ של המערכת עוד לא מחובר');
    const to = waIdFrom(a.guidePhone); if (!to) return done(false, 'אין מספר טלפון תקין למדריך');
    const O = await org(), hn = await hotelName(a.hotel), base = String(O.url || APP).replace(/[^/]*$/, '');
    const link = a.guideKey ? base + 'guide.html?k=' + a.guideKey : '';
    let text = '', kind = ['msg', 'pre', 'done'].includes(q.kind) ? q.kind : 'invite';
    const dd = (x) => x ? x.slice(8, 10) + '/' + x.slice(5, 7) : '';
    if (kind === 'pre') { if (!link) return done(false, 'עוד אין קישור למדריך'); text = `היי${a.guideName ? ' ' + a.guideName : ''}, כאן ${hn}.\nאתם מגיעים אלינו עם הקבוצה "${a.name || ''}"${a.ci ? ' ב-' + dd(a.ci) : ''}. נשמח שתמלאו מספר פרטים על הקבוצה לפני ההגעה בקישור הבא:\n${link}\n\nHi! This is ${hn}. You are arriving with the group "${a.name || ''}"${a.ci ? ' on ' + dd(a.ci) : ''}. Please fill in a few details about the group before arrival:\n${link}`; }
    else if (kind === 'done') { if (!link) return done(false, 'עוד אין קישור למדריך'); text = `תודה${a.guideName ? ' ' + a.guideName : ''}! קיבלנו את הפרטים ונעשה את מירב המאמצים להתאים את שעות הארוחות.\nהעמוד הזה ילווה אתכם לאורך כל השהות ב${hn}: החדרים, הארוחות, האולמות והודעות מהקבלה.\n\nThank you! We received the details. This page will serve you throughout your stay at ${hn}: rooms, meals, halls and messages from reception.\n${link}`; }
    else if (kind === 'invite') { if (!link) return done(false, 'עוד אין קישור למדריך'); text = `שלום${a.guideName ? ' ' + a.guideName : ''},\nזה העמוד של הקבוצה "${a.name || ''}" ב${hn}: החדרים שלכם ומתי נוקו, האולמות והודעות מהקבלה.\nHello! This is your group's page at ${hn}: rooms and cleaning, halls and messages from reception.\n${link}`; }
    else { const m = (a.guideMsgs || []).find((x) => x.id === q.msgId); if (!m) return done(false, 'ההודעה לא נמצאה'); text = String(m.text || '') + (link ? '\n\n' + link : ''); }
    const cref = db.doc('waChats/' + to), cs = await cref.get(), cd = cs.exists ? cs.data() : {};
    const meta = { waId: to, phone: waLocal(to), guide: true, groupId: id, groupName: a.name || '', hotel: a.hotel || '', cat: cd.cat || 'events' };
    if (!cs.exists) await cref.set({ ...meta, name: a.guideName || '', createdAt: now, createdBy: q.by || 'system', unread: 0, status: 'open' });
    else await cref.set(meta, { merge: true });
    const open = cd.lastInAt && now - cd.lastInAt < 23.5 * 3600e3;
    if (open) {
      await cref.collection('msgs').add({ dir: 'out', type: 'text', text, status: 'queued', by: q.by || 'system', byName: q.byName || 'קבלה', at: now, src: 'guide' });
      return done(true, 'נשלח בוואטסאפ של המערכת', 'text');
    }
    const cfg = ((await db.doc('waauto/main').get()).data() || {}).guide || {}, pick = cfg[kind === 'invite' ? 'inv' : kind] || {};
    const pub = (await db.doc('wapub/main').get()).data() || {}, t = (pub.templates || []).find((x) => x.name === pick.tpl && (!pick.lang || x.lang === pick.lang));
    if (!t) return done(false, 'המדריך עוד לא כתב לנו ב-24 השעות האחרונות, ולכן וואטסאפ מאפשר לשלוח לו רק תבנית מאושרת. ' + (pick.tpl ? 'התבנית שנבחרה לא נמצאה ברשימת המאושרות.' : 'בעל המערכת צריך לבחור תבנית למדריכים.'));
    const val = [a.guideName || 'מדריך', a.name || 'הקבוצה', hn || '', kind !== 'msg' ? link : String(((a.guideMsgs || []).find((x) => x.id === q.msgId) || {}).text || '').replace(/\s*\n+\s*/g, ' · ').slice(0, 900)];
    const params = Array.from({ length: t.n || 0 }, (_, i) => String(val[i] || '-').trim() || '-');
    const body = tplText(t, params);
    await cref.collection('msgs').add({ dir: 'out', type: 'template', tpl: tplRef(t, params), text: body, status: 'queued', by: q.by || 'system', byName: q.byName || 'קבלה', at: now, src: 'guide' });
    return done(true, 'נשלח בוואטסאפ של המערכת (תבנית ' + t.name + ')', 'template');
  } catch (e) { return done(false, e.message); }
});


// pre-arrival form (owner, Nov 9): every morning, groups arriving in 1–4 days whose guide has a phone get the form link over the system WhatsApp
// (onGuideWa kind 'pre'). Runs only when the owner turned it on (waauto/main.guide.preAuto). No guide phone → one push to gm/groups/reception.
exports.guidePreArrival = functions.region(REGION).pubsub.schedule('0 10 * * *').timeZone('Asia/Jerusalem').onRun(async () => {
  const G = ((await db.doc('waauto/main').get()).data() || {}).guide || {};
  if (G.preAuto !== true) return null;
  const today = ilDate(new Date()), from = addDaysIso(today, 1), to = addDaysIso(today, 4), now = Date.now();
  const qs = await db.collection('groups').where('ci', '>=', from).where('ci', '<=', to).get();
  for (const d of qs.docs) {
    const g = d.data() || {};
    if (!['confirmed', 'option'].includes(g.status) || g.preSentAt || g.preTried || g.guidePrefAt) continue;
    try {
      if (!waIdFrom(g.guidePhone)) {
        if (g.prePhoneWarn) continue;
        await d.ref.update({ prePhoneWarn: now });
        const to2 = [...new Set([...(await roleHolders(g.hotel || '', ['gm', 'grp', 'front']))])];
        if (to2.length) await sendTo(to2, { title: '🧭 חסר טלפון של מדריך · ' + (g.name || 'קבוצה'), body: 'הקבוצה מגיעה ב-' + g.ci.slice(8, 10) + '/' + g.ci.slice(5, 7) + '. בלי טלפון של המדריך אי אפשר לשלוח לו את טופס הפרטים לפני ההגעה.', hash: '#grp', tag: 'gdph-' + d.id });
        continue;
      }
      const up = { preTried: now, guideWaReq: { at: now, kind: 'pre', msgId: '', by: '', byName: 'אוטומטי' } };
      if (!/^g[0-9a-f]{32}$/.test(g.guideKey || '')) up.guideKey = 'g' + crypto.randomBytes(16).toString('hex');
      await d.ref.update(up);
    } catch (e) { console.warn('guide pre', d.id, e.message); }
  }
  return null;
});


// reception edits a group's existing halls (hours / number of people) → keep the events-board quotes grp_<id>_<n> in step (owner, Nov 5).
// Space, date and the quote link are restored from before when the editor is not a groups manager (reception may only change hours/guests).
exports.onGroupHalls = trig('groups/{id}').onUpdate(async (ch) => {
  const a = ch.after.data() || {}, b = ch.before.data() || {};
  if (JSON.stringify(a.halls || []) === JSON.stringify(b.halls || [])) return;
  let halls = a.halls || [];
  if (a.hallsBy && a.hallsAt !== b.hallsAt) {
    let grp = false;
    try { const r = await db.doc('roles/' + a.hallsBy).get(); grp = !!(r.exists && (r.data().apps || {}).grp); } catch (e) {}
    if (!grp) { try { const u = await admin.auth().getUser(a.hallsBy); grp = await pwIsOwnerMail(u.email); } catch (e) {} }
    if (!grp) {
      const old = b.halls || [];
      const fixed = halls.map((x, i) => old[i] ? { ...old[i], start: String(x.start || old[i].start || ''), end: String(x.end || old[i].end || ''), guests: Math.max(0, +x.guests || 0) } : null).filter(Boolean);
      if (JSON.stringify(fixed) !== JSON.stringify(halls)) { await ch.after.ref.update({ halls: fixed }); return; } // the next update syncs
      halls = fixed;
    }
  }
  const prev = {}; (b.halls || []).forEach((x) => { if (x && x.qid) prev[x.qid] = x; });
  for (const x of halls) {
    if (!x || !x.qid || !/^grp_/.test(x.qid)) continue;
    const p = prev[x.qid]; if (p && p.start === x.start && p.end === x.end && +p.guests === +x.guests) continue;
    try { await db.doc('quotes/' + x.qid).update({ 'event.start': x.start || '', 'event.end': x.end || '', 'event.guests': +x.guests || 0, updatedAt: new Date().toISOString() }); } catch (e) { console.warn('hall sync', x.qid, e.message); }
  }
});


// group rooms on the housekeeping board (owner, Nov 5): a group's rooms (guideRooms + roomPax {room:ppr}) are marked on the board's day:
// grp flag + guests per room while the group stays, RES on the arrival day, C/O on the departure day. Applied when reception saves the rooms
// (onGroupRooms, for the board's current day) and every morning after the 05:00 day change (grpHkAll).
const OCC_ORDER = ['co', 'res', 'empty'];
function occAdd(v, k) { const l = String(v || '').split(',').filter((x) => x && x !== 'empty'); if (!l.includes(k)) l.push(k); return OCC_ORDER.filter((x) => l.includes(x)).join(','); }
function occDel(v, k) { const l = String(v || '').split(',').filter((x) => x && x !== k); return OCC_ORDER.filter((x) => l.includes(x)).join(','); }
async function grpHkMark(h, day, g, oldG) {
  const live = (x) => x && ['confirmed', 'option'].includes(x.status || 'offer') && x.ci && x.ci <= day && (x.co || x.ci) >= day;
  const nowR = live(g) ? roomsParse(g.guideRooms) : [], oldR = oldG && live(oldG) ? roomsParse(oldG.guideRooms) : [];
  if (!nowR.length && !oldR.length) return 0;
  const ref = db.doc('hk/' + h + '__' + day), cur = (await ref.get()).data() || {}, occ = cur.occ || {}, now = Date.now(), del = admin.firestore.FieldValue.delete();
  const o = { hotel: h, date: day, updatedAt: now, lastBy: 'grp', grp: {}, pax: {}, occ: {}, occBy: {}, occAt: {} }; let n = 0;
  for (const r of oldR) if (!nowR.includes(r)) {
    o.grp[r] = del; const op = +((oldG.roomPax || {})[r] || 0); if (op && +((cur.pax || {})[r] || 0) === op) o.pax[r] = del;
    let v = occ[r] || ''; if (day === oldG.ci) v = occDel(v, 'res'); if (day === oldG.co) v = occDel(v, 'co'); if (v !== (occ[r] || '')) o.occ[r] = v || del; n++;
  }
  for (const r of nowR) {
    o.grp[r] = true; const p = +((g.roomPax || {})[r] || 0); if (p) o.pax[r] = p;
    let v = occ[r] || ''; if (day === g.ci) v = occAdd(v, 'res'); if (day === g.co && g.co !== g.ci) v = occAdd(v, 'co');
    if (v !== (occ[r] || '')) { o.occ[r] = v; o.occBy[r] = 'קבוצה · ' + (g.name || ''); o.occAt[r] = now; } n++;
  }
  for (const k of ['pax', 'occ', 'occBy', 'occAt']) if (!Object.keys(o[k]).length) delete o[k];
  await ref.set(o, { merge: true });
  return n;
}
async function grpHkAll(h, day) {
  const q = await db.collection('groups').where('hotel', '==', h).get(); let n = 0;
  for (const d of q.docs) { const g = d.data() || {}; if (g.guideRooms) n += await grpHkMark(h, day, g, null); }
  return n;
}
exports.onGroupRooms = trig('groups/{id}').onUpdate(async (ch) => {
  const a = ch.after.data() || {}, b = ch.before.data() || {};
  const same = (a.guideRooms || '') === (b.guideRooms || '') && JSON.stringify(a.roomPax || {}) === JSON.stringify(b.roomPax || {}) && a.ci === b.ci && a.co === b.co && a.status === b.status && a.hotel === b.hotel;
  if (same) return;
  const h = a.hotel || ''; if (!h) return;
  let day = ilDate(new Date()); try { const hd = await db.doc('hkday/' + h).get(); if (hd.exists && hd.data().date) day = hd.data().date; } catch (e) {}
  await grpHkMark(h, day, a, b.hotel === h ? b : null);
  if (b.hotel && b.hotel !== h) { let d2 = day; try { const hd = await db.doc('hkday/' + b.hotel).get(); if (hd.exists && hd.data().date) d2 = hd.data().date; } catch (e) {} await grpHkMark(b.hotel, d2, {}, b); }
});


// groups without prices for reception (security check, Nov 5): reception (front) reads groupsPub instead of groups —
// no rates, totals, deposits, agent or notes. Kept in step by this trigger; backfill.js copies existing groups.
const { grpPubDoc } = require('./grppub.js');
exports.mirrorGroupPub = trig('groups/{id}').onWrite(async (ch, ctx) => {
  const ref = db.doc('groupsPub/' + ctx.params.id);
  if (!ch.after.exists) { await ref.delete().catch(() => {}); return; }
  await ref.set(grpPubDoc(ch.after.data() || {}));
});


// social media spend per hotel (Nov 7, owner): each campaign report gets hotelAuto (see camphotel.js), so the hotel manager
// can read their hotel's spend (rules) and the gm / CEO pages count it in expenses. Written only when it changes (no loop).
const { campCtx, campHotelOf } = require('./camphotel.js');
let _campX = null, _campAt = 0;
exports.campHotelTag = trig('campaigns/{id}').onWrite(async (ch) => {
  if (!ch.after.exists) return;
  if (!_campX || Date.now() - _campAt > 600000) { _campX = await campCtx(db); _campAt = Date.now(); }
  const c = ch.after.data() || {}, h = campHotelOf(c, _campX);
  if (c.hotelAuto === h) return;
  await ch.after.ref.update({ hotelAuto: h });
});


// hotel separation (security, Nov 5): WhatsApp chats and tasks carry the venue of their lead, so a hotel's events users see only theirs.
async function leadVenue(id) { if (!id) return null; try { const d = await db.doc('leads/' + id).get(); return d.exists ? String(d.data().venue || '') : null; } catch (e) { return null; } }
exports.waChatVenue = trig('waChats/{id}').onWrite(async (ch) => {
  if (!ch.after.exists) return;
  const a = ch.after.data() || {}, b = ch.before.exists ? ch.before.data() || {} : {};
  // every chat carries `agent` ('' = nobody took it yet), so employees can query agent in ['', me] (Nov 8)
  if (a.agent === undefined) await ch.after.ref.set({ agent: '' }, { merge: true });
  if (ch.before.exists && a.leadId === b.leadId && a.venue !== undefined) return;
  const v = await leadVenue(a.leadId);
  if (v === null) { if (a.venue === undefined) await ch.after.ref.set({ venue: '' }, { merge: true }); return; }
  if (v !== (a.venue || '') || a.venue === undefined) await ch.after.ref.set({ venue: v }, { merge: true });
});
exports.taskVenue = trig('tasks/{id}').onWrite(async (ch) => {
  if (!ch.after.exists) return;
  const a = ch.after.data() || {}, b = ch.before.exists ? ch.before.data() || {} : {};
  if (ch.before.exists && a.leadId === b.leadId) return;
  const v = await leadVenue(a.leadId); if (v !== null && v !== (a.venue || '')) await ch.after.ref.set({ venue: v }, { merge: true });
});
exports.leadVenueSync = trig('leads/{id}').onUpdate(async (ch, ctx) => {
  const a = ch.after.data() || {}, b = ch.before.data() || {};
  if ((a.venue || '') === (b.venue || '')) return;
  const v = String(a.venue || ''), id = ctx.params.id;
  for (const col of ['waChats', 'tasks']) {
    const q = await db.collection(col).where('leadId', '==', id).get();
    for (const d of q.docs) if ((d.data().venue || '') !== v) await d.ref.set({ venue: v }, { merge: true });
  }
});


// managers' assistant (owner, Nov 6): chat with Claude over the hotel's data, read-only, permission-checked → assistant.js
exports.assistant = require('./assistant.js').assistant;
// paid-advertising agent (Nov 7, owner): daily analysis + weekly campaign report per hotel and for the chain, READ ONLY.
// Does nothing until agentcfg/ads.enabled === true. See agents-setup.md.
const ads = require('./agent-ads.js');
exports.adsDaily = ads.adsDaily;
exports.adsWeekly = ads.adsWeekly;
exports.adsRunNow = ads.adsRunNow;
// weekly FX rates for foreign-currency groups (owner, Nov 7): Sunday 16:45 Israel; fxRunNow (owner only) fills past weeks: POST {from:'YYYY-MM-DD'}
const fx = require('./fx.js');
exports.fxWeekly = functions.region(REGION).pubsub.schedule('45 16 * * 0').timeZone('Asia/Jerusalem').onRun(async () => { try { await fx.fxSync(); } catch (e) { console.error('fxWeekly', e); } return null; });
exports.fxRunNow = functions.region(REGION).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  const u = await require('./agent-common').ownerOnly(req); if (!u) { res.status(401).json({ error: 'auth' }); return; }
  const from = String((req.body || {}).from || ''); if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) { res.status(400).json({ error: 'from' }); return; }
  try { res.json({ ok: true, weeks: await fx.fxSync(from || undefined) }); } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 300) }); }
});

exports.adsAgent = ads.adsAgent;
const ali = require('./aliana-wa.js');
exports.onAliIn = ali.onAliIn;
exports.onAliCfg = ali.onAliCfg;
// Adam, the events reply agent (Nov 9): deployed OFF; acts only when agentcfg/reply.enabled === true. Writes aiAgent, never waChats.agent.
exports.agentReply = require('./agent-reply.js').agentReply;
// Meta campaign structure for the ads agent (Nov 7, owner): read-only, once a day → metaStruct/{campaignId}
async function metaStructAll() {
  const m = (await db.doc('metacfg/main').get()).data() || {}, out = [], S = require('./meta-struct.js');
  for (const [id, conn] of metaConnList(m)) {
    try { out.push({ id, ...(await S.structOne(db, graphAll, { token: conn.token, adAccount: conn.adAccount, conn: { id, name: conn.name || '', venue: conn.venue || '' } })) }); }
    catch (e) { out.push({ id, error: String(e.message || e).slice(0, 200) }); }
  }
  return out;
}
exports.metaStructDaily = functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '512MB' }).pubsub.schedule('30 5 * * *').timeZone('Asia/Jerusalem').onRun(async () => { await metaStructAll(); return null; });
// one-off catch-up jobs for the ads agent (Nov 7, owner): adsJobs/{id} created by an admin script
//   {kind:'meta', since} = pull Meta insights from `since`; {kind:'week', week} = historical weekly reports of that week
exports.adsJob = functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '1GB' }).firestore.document('adsJobs/{id}').onCreate(async (snap) => {
  const j = snap.data() || {}, ref = snap.ref;
  await ref.set({ status: 'running', startedAt: Date.now() }, { merge: true });
  try {
    if (j.kind === 'meta') {
      const m = (await db.doc('metacfg/main').get()).data() || {}, out = [];
      for (const [id, conn] of metaConnList(m)) {
        try { const r = await metaInsights({ token: conn.token, adAccount: conn.adAccount, since: j.since, conn: { id, name: conn.name || '', venue: conn.venue || '' } }); out.push({ id, ...r }); }
        catch (e) { out.push({ id, error: String(e.message || e).slice(0, 200) }); }
      }
      await ref.set({ status: 'done', doneAt: Date.now(), result: out }, { merge: true });
    } else if (j.kind === 'struct') {
      await ref.set({ status: 'done', doneAt: Date.now(), result: await metaStructAll() }, { merge: true });
    } else if (j.kind === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(j.week || '')) {
      const r = await require('./agent-ads-backfill.js').runWeek(j.week);
      await ref.set({ status: 'done', doneAt: Date.now(), result: r }, { merge: true });
    } else await ref.set({ status: 'error', error: 'bad job' }, { merge: true });
  } catch (e) { console.error('adsJob', e); await ref.set({ status: 'error', error: String(e.message || e).slice(0, 300) }, { merge: true }); }
  return null;
});

// ---------- price comparison (Nov 7, owner: page "השוואת מחירים") ----------
// The owner's scheduled price agent POSTs {hotel, rows:[{src booking|site, checkin, room, orig, price, bf, left, note}]} with header x-rates-key.
// Key in ratescfg/main.key (owner only in rules). Writes ratesLog/{hotel}__{ilDate}; clients never write there.
exports.ratesIngest = functions.region(REGION).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type, x-rates-key'); res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).send('method'); return; }
  try {
    if (await pwRate(req, 30)) { res.status(429).json({ error: 'rate' }); return; }
    const cfg = await db.doc('ratescfg/main').get(), key = cfg.exists ? String(cfg.data().key || '') : '';
    const got = String(req.get('x-rates-key') || '');
    if (!key || key.length < 24 || got.length !== key.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key))) { res.status(403).json({ error: 'forbidden' }); return; }
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    // hotel = an id in hotels/, or a name ("Gutman" / "גוטמן") matched against the hotel names
    let hotel = String(b.hotel || '').slice(0, 60), hname = '';
    const hs = await db.collection('hotels').get();
    const byId = hs.docs.find((d) => d.id === hotel);
    if (byId) hname = byId.data().name || hotel;
    else {
      const q = hotel.toLowerCase().trim().replace(/^the\s+/, ''), qs = q.replace(/[\s_-]+/g, '');
      const AL = [[['gutman', 'גוטמן'], ['gutman', 'גוטמן']], [['7seas', 'sevenseas', 'seas', 'סיז', '7סיז'], ['seas', 'סיז']], [['hostel180', 'hostel', '180', 'הוסטל', 'הוסטל180'], ['hostel', 'הוסטל', '180']], [['7even', 'seven', 'סבן', 'sola', 'סולה'], ['7even', 'סבן']]];
      const hit = AL.find(([keys]) => keys.includes(qs));
      const al = hit ? hit[1] : [q];
      const nm = (d) => String(d.data().name || '').toLowerCase();
      const m = q ? (hs.docs.find((d) => nm(d).replace(/^the\s+/, '') === q) || hs.docs.find((d) => al.some((x) => nm(d).replace(/\s+/g, '').includes(x)))) : null;
      if (!m) { res.status(400).json({ error: 'hotel', hotels: hs.docs.map((d) => ({ id: d.id, name: d.data().name || '' })) }); return; }
      hotel = m.id; hname = m.data().name || m.id;
    }
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length || rows.length > 1500) { res.status(400).json({ error: 'rows' }); return; }
    const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null; };
    const clean = [];
    for (const r of rows) {
      const src = r && (r.src === 'booking' || r.src === 'site' || r.src === 'comp') ? r.src : null, ci = String((r && r.checkin) || '');
      if (!src || !/^\d{4}-\d{2}-\d{2}$/.test(ci)) continue;
      if (src === 'comp' && !String(r.comp || r.room || '').trim()) continue;
      clean.push({ src, checkin: ci, ...(src === 'comp' ? { comp: String(r.comp || r.room || '').slice(0, 60) } : {}), room: String(r.room || '').slice(0, 60), orig: num(r.orig), price: num(r.price), bf: !!r.bf, left: num(r.left), note: String(r.note || '').slice(0, 120) });
    }
    if (!clean.length) { res.status(400).json({ error: 'rows' }); return; }
    const day = ilDate(new Date());
    await db.doc('ratesLog/' + hotel + '__' + day).set({ hotel, hotelName: hname, runDate: day, runAt: Date.now(), rows: clean, n: clean.length });
    res.json({ ok: true, hotel, hotelName: hname, saved: clean.length, doc: hotel + '__' + day });
  } catch (e) { console.error('ratesIngest', e); res.status(500).json({ error: 'server' }); }
});
