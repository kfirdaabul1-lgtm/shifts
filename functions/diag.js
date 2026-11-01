const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
(async () => {
  await db.doc('wacfg/main').set({ syncReq: Date.now() }, { merge: true });
  await new Promise((r) => setTimeout(r, 25000));
  const p = (await db.doc('wapub/main').get()).data() || {}, c = (await db.doc('wacfg/main').get()).data() || {};
  console.log('::notice::status ' + JSON.stringify(c.status || {}).slice(0, 300));
  console.log('::notice::templates ' + (p.templates || []).map((t) => t.name + '/' + t.lang + '/n' + t.n + ' :: ' + String(t.body || '').slice(0, 60)).join(' || '));
  process.exit(0);
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
