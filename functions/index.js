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
exports.onFault = trig('faults/{id}').onCreate(async (snap) => {
  const f = snap.data() || {};
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
const BACKUP_COLLS = ['hotels', 'settings', 'employees', 'mgr', 'avail', 'shifts', 'schedule', 'requests', 'roles', 'joinCodes', 'config', 'menus', 'contracts', 'quotes', 'campaigns', 'suppliers', 'invoices', 'expcfg', 'inventory', 'purchaseReqs', 'shiftReports', 'faults'];
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
const PUB_KEYS = ['hotel', 'month', 'date', 'shift', 'name', 'empUid', 'ooo', 'faults', 'lost', 'booking', 'ciLeft', 'coLeft', 'ci', 'co', 'cid', 'unusual', 'details', 'createdAt', 'by'];
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
  const vip = a.vip || {}, bk = a.bk || {}, clean = a.clean || {}, pax = a.pax || {}, twin = a.twin || {}, cot = a.cot || {};
  const per = {};
  for (const [room, uid] of Object.entries(asg)) if (uid && b[room] !== uid) (per[uid] = per[uid] || []).push(room);
  const uids = Object.keys(per); if (!uids.length) return;
  const hn = await hotelName(a.hotel);
  await Promise.all(uids.map((u) => {
    const rooms = per[u].sort((x, y) => String(x).localeCompare(String(y), 'he', { numeric: true }));
    const txt = rooms.map((r) => r + (vip[r] ? ' VIP' : '') + (bk[r] ? ' Booking' : '') + (pax[r] ? ' ' + pax[r] + ' אורחים' : '') + (twin[r] ? ' Twin' : '') + (cot[r] ? ' Baby cot' : '') + (clean[r] === 'vd' ? ' (VD)' : '')).join(', ');
    return sendTo([u], { title: rooms.length > 1 ? `יש לך ${rooms.length} חדרים לסדר` : 'יש לך חדר לסדר', body: `${hn ? hn + ': ' : ''}חדר ${txt}`, hash: '#hk', tag: 'hk-' + u + '-' + a.date });
  }));
});
