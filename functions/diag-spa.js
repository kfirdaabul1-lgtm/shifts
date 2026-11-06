const admin = require('firebase-admin'); admin.initializeApp(); const db = admin.firestore();
(async () => {
  const c = (await db.doc('spacfg/main').get()).data() || {};
  console.log('ther', JSON.stringify((c.ther || []).map((t) => ({ id: t.id, g: t.g, active: t.active }))));
  console.log('hours', JSON.stringify((c.online || {}).hours || {}), 'on', !!(c.online || {}).on);
  const s = await db.collection('spaShifts').get();
  s.docs.forEach((d) => console.log('shift', d.id, JSON.stringify(d.data().date), JSON.stringify(d.data().ther || {}), d.data().updatedAt));
  console.log('count', s.size);
})().catch((e) => { console.error(e.message); process.exit(1); });
