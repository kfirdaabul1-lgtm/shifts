const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const G = 'https://graph.facebook.com/v23.0/';
(async () => {
  const c = (await db.doc('wacfg/main').get()).data() || {};
  console.log('::notice::wacfg phoneId=' + c.phoneId + ' wabaId=' + c.wabaId + ' verify=' + (c.verify ? 'set' : 'none') + ' appSecret=' + (c.appSecret ? 'set' : 'none') + ' status=' + JSON.stringify(c.status || {}).slice(0, 500));
  const get = async (p) => { const r = await fetch(G + p, { headers: { Authorization: 'Bearer ' + c.token } }); return r.status + ' ' + (await r.text()).slice(0, 700); };
  console.log('::notice::subscribed_apps ' + await get(c.wabaId + '/subscribed_apps'));
  console.log('::notice::phone ' + await get(c.phoneId + '?fields=display_phone_number,verified_name,platform_type,status,code_verification_status,name_status,throughput'));
  console.log('::notice::debug ' + await get('debug_token?input_token=' + c.token));
  const ch = await db.collection('waChats').limit(5).get();
  console.log('::notice::chats ' + ch.size + ' ' + ch.docs.map((d) => d.id).join(','));
  process.exit(0);
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
