// One-off: list ratesLog, then import a price-agent run per hotel (same shape as ratesIngest). DATA = base64(gzip(JSON {run, hotels:{name:[rows]}})).
const admin = require('firebase-admin'), zlib = require('zlib');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const AL = [['gutman', ['gutman', 'גוטמן']], ['seas', ['seas', 'סיז']], ['hostel', ['hostel', 'הוסטל', '180']], ['7even', ['7even', 'סבן']]];
(async () => {
  const ex = await db.collection('ratesLog').get();
  ex.docs.forEach((d) => console.log('::notice title=Existing::' + d.id + ' · n ' + d.data().n + ' · src ' + (d.data().src || 'agent') + ' · at ' + new Date(d.data().runAt).toISOString()));
  const p = JSON.parse(zlib.gunzipSync(Buffer.from(process.env.DATA || '', 'base64')).toString());
  const hs = await db.collection('hotels').get();
  for (const [name, rows] of Object.entries(p.hotels)) {
    const q = name.toLowerCase(), al = (AL.find(([k]) => q.includes(k)) || [0, [q]])[1];
    const m = hs.docs.find((d) => al.some((a) => String(d.data().name || '').toLowerCase().replace(/\s+/g, '').includes(a)));
    if (!m) { console.log('::warning::no hotel for ' + name); continue; }
    const ok = rows.filter((r) => (r.src === 'booking' || r.src === 'site') && /^\d{4}-\d{2}-\d{2}$/.test(r.checkin));
    const id = m.id + '__' + p.run;
    await db.doc('ratesLog/' + id).set({ hotel: m.id, hotelName: m.data().name || m.id, runDate: p.run, runAt: Date.now(), rows: ok, n: ok.length, src: 'import' });
    console.log('::notice title=Imported::' + name + ' → ' + id + ' · ' + ok.length);
  }
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
