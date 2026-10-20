// One-off/idempotent: copy shift reports that have no money-free copy yet into shiftReportsPub.
// Runs from the deploy workflow after the functions deploy (service-account credentials).
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const KEYS = ['hotel', 'month', 'date', 'shift', 'name', 'empUid', 'ooo', 'faults', 'lost', 'booking', 'ciLeft', 'coLeft', 'ci', 'co', 'cid', 'unusual', 'details', 'createdAt', 'by'];
(async () => {
  const [all, pub] = await Promise.all([db.collection('shiftReports').get(), db.collection('shiftReportsPub').get()]);
  const have = new Set(pub.docs.map((d) => d.id));
  let n = 0, b = db.batch();
  for (const d of all.docs) {
    if (have.has(d.id)) continue;
    const r = d.data(), o = {};
    for (const k of KEYS) if (r[k] !== undefined) o[k] = r[k];
    b.set(db.doc('shiftReportsPub/' + d.id), o);
    if (++n % 400 === 0) { await b.commit(); b = db.batch(); }
  }
  if (n % 400) await b.commit();
  console.log('shift reports:', all.size, 'copied now:', n);
  console.log('::notice title=Backfill::shift reports ' + all.size + ', copied ' + n);
})().catch((e) => { console.error(e); console.log('::error title=Backfill failed::' + String(e && e.message || e).slice(0, 300)); process.exit(1); });
