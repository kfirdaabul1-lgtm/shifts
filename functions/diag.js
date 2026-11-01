const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
(async () => {
  const c = (await db.doc('wacfg/main').get()).data() || {}, p = (await db.doc('wapub/main').get()).data() || {};
  console.log('::notice::wacfg provider=' + (c.provider || '') + ' phoneId=' + (c.phoneId || '') + ' wabaId=' + (c.wabaId || '') + ' hasToken=' + !!c.token + ' syncReq=' + (c.syncReq || '') + ' status=' + JSON.stringify(c.status || {}).slice(0, 600));
  console.log('::notice::wapub on=' + p.on + ' phone=' + (p.phone || '') + ' name=' + (p.name || '') + ' templates=' + (p.templates || []).map((t) => t.name + '/' + t.lang).join(', ').slice(0, 800));
  process.exit(0);
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
