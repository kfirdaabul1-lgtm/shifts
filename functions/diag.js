// One-off status: auto backup + contract signing links. No secrets printed.
const admin = require('firebase-admin'); admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 900)}`);
(async () => {
  const b = (await db.doc('backupcfg/main').get()).data() || {};
  note('Backup', `key ${b.key ? 'set' : 'MISSING'} · lastAt ${b.lastAt ? new Date(b.lastAt).toISOString() : 'never'} · lastCount ${b.lastCount || '-'}`);
  const s = await db.collection('signs').get(); let p = 0, sg = 0; s.forEach((d) => (d.data().status === 'signed' ? sg++ : p++));
  note('Signs', `${s.size} links (${p} pending, ${sg} signed)`);
  const q = await db.collection('quotes').get(); let rs = 0; q.forEach((d) => { if (d.data().signature && d.data().signature.remote) rs++; });
  note('Quotes', `${q.size} quotes · ${rs} signed by link`);
})().catch((e) => note('Diag error', e.message));
