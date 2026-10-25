// One-off: test push to one employee (by name) and send a fresh notification request. Prints FCM results only.
const admin = require('firebase-admin'); admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 900)}`);
(async () => {
  const es = await db.collection('employees').get(), d = es.docs.find((x) => /mahaveer/i.test(String(x.data().name || '')));
  if (!d) return note('Employee', 'no match');
  const t = await db.doc('pushTokens/' + d.id).get(), m = t.exists ? t.data().tokens || {} : {};
  note('Devices', Object.entries(m).map(([k, x]) => `${k.slice(0, 12)}… ios=${!!x.ios} ua=${String(x.ua || '').slice(0, 80)} at=${new Date(+x.at || 0).toISOString().slice(0, 16)}`).join(' | '));
  const tokens = Object.keys(m);
  if (tokens.length) {
    const res = await admin.messaging().sendEachForMulticast({ tokens, data: { title: 'בדיקת התראות ✓', body: 'אם קיבלת את ההודעה הזו, ההתראות עובדות.', url: 'https://kfirdaabul1-lgtm.github.io/shifts/', tag: 'test' }, webpush: { headers: { Urgency: 'high', TTL: '86400' } } });
    note('Test push', res.responses.map((r, i) => tokens[i].slice(0, 12) + ': ' + (r.success ? 'OK ' + r.messageId.slice(-12) : (r.error.code + ' ' + r.error.message))).join(' | '));
  }
  await d.ref.set({ pushReq: Date.now() }, { merge: true }); note('Sent', 'pushReq set for ' + d.data().name);
})().catch((e) => note('Diag error', e.message));
