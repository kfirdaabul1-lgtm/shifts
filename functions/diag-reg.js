const admin = require('firebase-admin'); admin.initializeApp(); const db = admin.firestore();
(async () => {
  const c = await db.collection('chains').get();
  console.log('registry:', c.docs.map((d) => d.id + '|' + (d.data().kind || '') + '|' + (d.data().name || d.data().appName || '')).join(' ; ') || 'none');
  const h = await db.collection('hotels').get();
  console.log('seven hotels:', h.docs.map((d) => d.id + '|' + (d.data().name || '') + '|' + (d.data().kind || '')).join(' ; '));
})().catch((e) => { console.error(e.message); process.exit(1); });
