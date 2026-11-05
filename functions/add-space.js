// one-off (owner, Nov 5): add the space "קומה 4" to the 7EVEN venue (sola) and to the 7EVEN hotel's event spaces
const admin = require('firebase-admin'); admin.initializeApp(); const db = admin.firestore();
const VID = 'sola', AREA = 'קומה 4';
const DEF = [{ id: 'sola', name: 'מלון 7EVEN', areas: ['סולה', 'Co-Work', 'מסעדה', 'בויילר', 'וולנס'], hex: '#b7822a' }, { id: 'boheme', name: 'Gutman', areas: ['לה בוהם', 'לה בוהם גארדן'], hex: '#86304a' }, { id: 'sevenseas', name: '7seas', areas: ['גג'], hex: '#13789c' }];
(async () => {
  const ref = db.doc('orgcfg/main'), o = (await ref.get()).data() || {};
  const venues = Array.isArray(o.venues) ? o.venues : JSON.parse(JSON.stringify(DEF));
  console.log('venues from', Array.isArray(o.venues) ? 'orgcfg' : 'defaults', venues.map((v) => v.id + ':' + (v.areas || []).join('/')).join(' | '));
  const v = venues.find((x) => x.id === VID); if (!v) { console.log('no sola venue'); return; }
  if (!(v.areas || []).includes(AREA)) v.areas = [...(v.areas || []), AREA];
  await ref.set({ venues }, { merge: true });
  const st = await db.collection('settings').get();
  for (const d of st.docs) {
    const s = d.data() || {};
    if (!(s.venues || []).includes(VID)) continue;
    if (Array.isArray(s.spaces)) { if (!s.spaces.includes(VID + '|' + AREA)) await d.ref.update({ spaces: [...s.spaces, VID + '|' + AREA] }); console.log('settings', d.id, 'spaces now', s.spaces.length + 1); }
    else console.log('settings', d.id, 'no spaces list (uses all venue areas)');
  }
  console.log('done');
})().catch((e) => { console.error(e.message); process.exit(1); });
