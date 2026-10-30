const admin = require('firebase-admin'); admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 900)}`);
(async () => { const c = (await db.doc('wacfg/main').get()); const d = c.exists ? c.data() : null;
  note('WA cfg', d ? `provider ${d.provider} · token ${d.token ? 'set' : 'no'} · phoneId ${d.phoneId ? 'set' : 'no'} · waba ${d.wabaId ? 'set' : 'no'} · status ${JSON.stringify(d.status || {})}` : 'none');
  const ch = await db.collection('waChats').get(); note('WA chats', ch.size); })().catch(e => note('Diag error', e.message));
