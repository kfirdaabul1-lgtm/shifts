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
