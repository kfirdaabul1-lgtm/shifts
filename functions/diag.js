// one-time: places for the two obvious connections (7EVEN page → venue 'sola' = מלון 7EVEN, The Gutman → 'boheme' = Gutman)
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const MAP = { cmvjdk1bd: 'sola', cmvxmpgij: 'boheme' };
(async () => {
  const ref = db.doc('metacfg/main'), cfg = (await ref.get()).data() || {}, up = {};
  for (const [id, v] of Object.entries(MAP)) if (cfg.conns && cfg.conns[id] && !cfg.conns[id].venue) up['conns.' + id + '.venue'] = v;
  if (Object.keys(up).length) await ref.update(up);
  const snap = await db.collection('leads').get(); const cnt = {};
  for (const d of snap.docs) { const l = d.data(), v = MAP[l.metaConn]; if (v && !l.venue) { await d.ref.set({ venue: v }, { merge: true }); cnt[v] = (cnt[v] || 0) + 1; } }
  console.log('::notice::conns ' + JSON.stringify(up) + ' leads ' + JSON.stringify(cnt));
  process.exit(0);
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
