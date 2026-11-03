// one-off self test of the login lockout (pwGuard) with a throwaway account; cleans up after itself
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore(), crypto = require('crypto');
const URL = 'https://europe-west1-hotel-shifts.cloudfunctions.net/pwGuard';
const note = (t, m) => console.log(`::notice title=${t}::${m}`);
const post = (b) => fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => r.status + ' ' + (await r.text()));
(async () => {
  const name = 'zzpwtest' + crypto.randomBytes(3).toString('hex'), email = name + '@users.seven-collection.app', pw = 'Corr3ct-' + crypto.randomBytes(4).toString('hex');
  const u = await admin.auth().createUser({ email, password: pw });
  await db.doc('usernames/' + name).set({ uid: u.uid, email, at: Date.now() });
  try {
    note('1 correct', await post({ op: 'login', login: name, password: pw }));
    for (let i = 0; i < 3; i++) note('2 wrong ' + (i + 1), await post({ op: 'login', login: name, password: 'nope' + i }));
    note('3 correct after lock', await post({ op: 'login', login: name, password: pw }));
    const lk = await db.doc('authLocks/' + u.uid).get(); note('4 lock doc', JSON.stringify({ exists: lk.exists, locked: lk.exists && lk.data().locked, fails: lk.exists && lk.data().fails }));
    await new Promise((r) => setTimeout(r, 4000));
    const pub = await db.doc('authLockPub/' + u.uid).get(); note('5 pub mirror', String(pub.exists));
    note('6 free taken', await post({ op: 'free', u: name }));
    note('7 free new', await post({ op: 'free', u: name + 'x' }));
    const ghost = 'zzghost' + crypto.randomBytes(3).toString('hex');
    for (let i = 0; i < 3; i++) note('8 unknown ' + (i + 1), await post({ op: 'login', login: ghost, password: 'x' }));
    await db.doc('authLocks/x' + crypto.createHash('sha256').update(ghost).digest('hex').slice(0, 30)).delete();
    note('9 reset username (no mail)', await post({ op: 'reset', login: name }));
    note('10 set without token', await post({ op: 'set', uid: u.uid, password: 'abcdef12' }));
  } finally {
    await admin.auth().deleteUser(u.uid).catch(() => {});
    await db.doc('usernames/' + name).delete().catch(() => {});
    await db.doc('authLocks/' + u.uid).delete().catch(() => {});
    await new Promise((r) => setTimeout(r, 4000));
    await db.doc('authLockPub/' + u.uid).delete().catch(() => {});
    note('cleanup', 'done');
  }
})().catch((e) => note('selftest error', e.message));
