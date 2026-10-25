// One-off: test push (with notification block) to one employee.
const admin = require('firebase-admin'); admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 900)}`);
(async () => {
  const es = await db.collection('employees').get(), d = es.docs.find((x) => /mahaveer/i.test(String(x.data().name || '')));
  const t = await db.doc('pushTokens/' + d.id).get(), tokens = Object.keys(t.exists ? t.data().tokens || {} : {});
  const U = 'https://kfirdaabul1-lgtm.github.io/shifts/';
  const res = await admin.messaging().sendEachForMulticast({ tokens, data: { title: 'בדיקת התראות ✓', body: 'Test notification – if you see this on the lock screen, it works.', url: U, tag: 'test2' },
    webpush: { headers: { Urgency: 'high', TTL: '86400' }, notification: { title: 'בדיקת התראות ✓', body: 'Test notification – if you see this on the lock screen, it works.', icon: U + 'icon-192.png', dir: 'rtl', lang: 'he' }, fcmOptions: { link: U } } });
  note('Test push', res.responses.map((r, i) => tokens[i].slice(0, 12) + ': ' + (r.success ? 'OK' : r.error.code)).join(' | '));
})().catch((e) => note('Diag error', e.message));
