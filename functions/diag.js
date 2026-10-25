// One-off: remove room 104 from the Gutman housekeeping room list (hkcfg) if a saved list exists.
const admin = require('firebase-admin'); admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' / ').slice(0, 900)}`);
(async () => {
  const hs = await db.collection('hotels').get(); const g = hs.docs.find((d) => /גוטמן|gutman/i.test(String(d.data().name || '')));
  if (!g) return note('Gutman', 'not found');
  const ref = db.doc('hkcfg/' + g.id), s = await ref.get();
  if (!s.exists || !String(s.data().rooms || '').trim()) return note('hkcfg', 'no saved list for ' + g.id + ' (preset is used)');
  const rooms = String(s.data().rooms);
  if (/(^|\s)-104(\s|$)/m.test(rooms)) return note('hkcfg', 'already removed: ' + rooms);
  const lines = rooms.split('\n'); const i = lines.findIndex((l) => /(^|[\s,])1\d\d/.test(l)); 
  if (i < 0) lines.push('-104'); else lines[i] = lines[i].trimEnd() + ' -104';
  await ref.set({ rooms: lines.join('\n'), updatedAt: Date.now() }, { merge: true });
  note('hkcfg', 'before: ' + rooms + ' || after: ' + lines.join('\n'));
})().catch((e) => note('Diag error', e.message));
