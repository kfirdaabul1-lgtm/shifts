// Manual housekeeping day change (same as the 05:00 hkNightly): run from the "Housekeeping new day" workflow.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const ilDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
async function hkCarry(h, today, yday) {
  const ys = await db.doc('hk/' + h + '__' + yday).get(); if (!ys.exists) return 0;
  const ref = db.doc('hk/' + h + '__' + today), ts = await ref.get(), td = ts.exists ? ts.data() : {};
  if (td.carried) return 0;
  const yc = (ys.data() || {}).clean || {}, cur = td.clean || {}, now = Date.now();
  const o = { hotel: h, date: today, carried: true, updatedAt: now, clean: {}, cleanBy: {}, cleanAt: {} };
  let n = 0;
  for (const [r, c] of Object.entries(yc)) if (c && !cur[r]) { o.clean[r] = c === 'vc' ? 'vi' : c === 'oc' ? 'od' : c; o.cleanBy[r] = 'אוטומטי'; o.cleanAt[r] = now; n++; }
  await ref.set(o, { merge: true });
  return n;
}
(async () => {
  const today = ilDate(new Date()), hs = await db.collection('hotels').get(), out = [];
  for (const d of hs.docs) {
    const ref = db.doc('hkday/' + d.id), cur = await ref.get(), from = (cur.exists && cur.data().date) || ilDate(new Date(Date.now() - 24 * 3600e3));
    if (from >= today) { out.push(d.id + ': already ' + from); continue; }
    const n = await hkCarry(d.id, today, from);
    await ref.set({ hotel: d.id, date: today, from, by: 'auto', byName: 'מעבר יום ידני', at: Date.now() });
    out.push(d.id + ': ' + from + ' -> ' + today + ' (' + n + ' rooms)');
  }
  console.log(out.join('\n'));
  console.log('::notice title=HK new day::' + out.join(' | '));
})().catch((e) => { console.error(e); process.exit(1); });
