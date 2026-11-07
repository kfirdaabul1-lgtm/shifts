// One-off: import a price-agent run into ratesLog (same shape as ratesIngest). Input: env DATA = base64(gzip(JSON {hotel, run, rows})).
const admin = require('firebase-admin'), zlib = require('zlib');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
(async () => {
  const p = JSON.parse(zlib.gunzipSync(Buffer.from(process.env.DATA || '', 'base64')).toString());
  const hs = await db.collection('hotels').get(), q = String(p.hotel).toLowerCase();
  const m = hs.docs.find((d) => String(d.data().name || '').toLowerCase().includes(q) || String(d.data().name || '').includes('גוטמן'));
  if (!m) { console.log('::error::hotel not found'); process.exit(1); }
  const ok = (p.rows || []).filter((r) => (r.src === 'booking' || r.src === 'site') && /^\d{4}-\d{2}-\d{2}$/.test(r.checkin));
  const id = m.id + '__' + p.run;
  await db.doc('ratesLog/' + id).set({ hotel: m.id, hotelName: m.data().name || m.id, runDate: p.run, runAt: Date.now(), rows: ok, n: ok.length, src: 'import' });
  console.log('::notice title=Rates import::' + id + ' · ' + ok.length + ' rows');
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
