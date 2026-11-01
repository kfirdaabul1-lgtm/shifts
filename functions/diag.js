const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
(async () => {
  await db.doc('metacfg/main').set({ syncReq: Date.now() }, { merge: true });
  await new Promise((r) => setTimeout(r, 90000));
  const cfg = (await db.doc('metacfg/main').get()).data() || {};
  for (const [id, c] of Object.entries(cfg.conns || {})) { const r = (cfg.cst || {})[id] || {}, st = r.status || {}; console.log(`::notice::${id} ${c.name} at=${new Date(st.at || 0).toISOString()} leadsAt=${new Date((r.leadsAt || 0) * 1000).toISOString()} pages=${(st.pages || []).join('|')} forms=${st.forms} new=${st.newLeads} total=${st.leadsTotal} err=${st.err || ''} leadErr=${st.leadErr || ''}`); }
  const s = await db.collection('leads').where('phone', 'in', ['0544957709', '+972544957709', '972544957709']).get();
  console.log('::notice::lead by phone: ' + s.docs.map((d) => d.id + ' ' + d.data().name + ' ' + new Date(d.data().createdAt).toISOString()).join(' | ') || 'none');
  const r = await db.collection('leads').orderBy('createdAt', 'desc').limit(3).get();
  console.log('::notice::latest: ' + r.docs.map((d) => d.id + ' ' + d.data().name + ' ' + new Date(d.data().createdAt).toISOString()).join(' | '));
  process.exit(0);
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
