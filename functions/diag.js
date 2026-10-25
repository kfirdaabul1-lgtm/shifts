// One-off: find an employee by name, show his notification devices and send a fresh notification request (pushReq). No pay data.
const admin = require('firebase-admin'); admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 900)}`);
(async () => {
  const hs = await db.collection('hotels').get(), hn = {}; hs.forEach((d) => (hn[d.id] = d.data().name || d.id));
  const es = await db.collection('employees').get();
  const hits = es.docs.filter((d) => /אביר|abir/i.test(String(d.data().name || '')));
  for (const d of hits) {
    const e = d.data(), t = await db.doc('pushTokens/' + d.id).get(), toks = t.exists ? Object.values(t.data().tokens || {}) : [];
    let u = null; try { u = await admin.auth().getUser(d.id); } catch (_) {}
    note('Employee', `${e.name} · ${hn[e.hotel] || e.hotel} · depts ${(e.depts || []).join(',')} · sign-in ${u ? u.providerData.map((x) => x.providerId).join(',') || 'password' : 'manual/no account'} · last sign-in ${u && u.metadata.lastSignInTime || '-'} · devices ${toks.length}: ${toks.map((x) => (x.ios ? 'iOS ' : '') + String(x.ua || '').slice(0, 70) + ' @' + new Date(+x.at || 0).toISOString().slice(0, 16)).join(' | ')}`);
    if (/גוטמן|gutman/i.test(hn[e.hotel] || '')) { await d.ref.set({ pushReq: Date.now() }, { merge: true }); note('Sent', 'pushReq set for ' + e.name); }
  }
  if (!hits.length) note('Employee', 'no match');
})().catch((e) => note('Diag error', e.message));
