// one-time: Meta leads saved before Nov 1 lost the dash in guest ranges ("50-100" → 50100) and kept underscores in the type
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const split = (n) => { const s = String(n); for (let i = 1; i < s.length; i++) { const a = s.slice(0, i), b = s.slice(i); if (b[0] === '0') continue; if (+a < +b && +b <= +a * 10) return [+a, +b]; } return null; };
(async () => {
  const snap = await db.collection('leads').get(); let n = 0; const ex = [];
  for (const d of snap.docs) {
    const l = d.data(), up = {};
    if (+l.guests >= 1000 && !l.guestsTxt && /^meta_/.test(d.id)) { const p = split(l.guests); if (p) { up.guests = p[0]; up.guestsTxt = p[0] + '–' + p[1]; } }
    if (/^meta_/.test(d.id) && /_/.test(l.type || '')) up.type = String(l.type).replace(/_+/g, ' ').trim();
    if (Object.keys(up).length) { await d.ref.set(up, { merge: true }); n++; if (ex.length < 5) ex.push(l.guests + '→' + (up.guestsTxt || '') + ' ' + (up.type || '')); }
  }
  console.log(`::notice::fixed ${n} of ${snap.size} leads; e.g. ${ex.join(' | ')}`);
  process.exit(0);
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
