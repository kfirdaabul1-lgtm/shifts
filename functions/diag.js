const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
(async () => {
  await db.doc('wacfg/main').set({ syncReq: Date.now() }, { merge: true });
  await new Promise((r) => setTimeout(r, 25000));
  const c = (await db.doc('wacfg/main').get()).data() || {}, p = (await db.doc('wapub/main').get()).data() || {};
  console.log('::notice::wacfg provider=' + (c.provider || '') + ' phoneId=' + (c.phoneId || '') + ' wabaId=' + (c.wabaId || '') + ' hasToken=' + !!c.token + ' syncReq=' + (c.syncReq || '') + ' status=' + JSON.stringify(c.status || {}).slice(0, 600));
  console.log('::notice::wapub on=' + p.on + ' phone=' + (p.phone || '') + ' name=' + (p.name || '') + ' templates=' + (p.templates || []).length + ' · ' + (p.templates || []).map((t) => t.name + '/' + t.lang).filter((x) => /thank/i.test(x)).join(', '));
  process.exit(0);
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
