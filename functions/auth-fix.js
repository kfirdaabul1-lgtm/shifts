// Temporary (Nov 12): find an Auth user by sha256(email), report docs, delete the Auth user only when it has no employees/roles doc.
// Prints only uid prefixes, booleans and counts (public Actions logs).
const admin = require('firebase-admin');
admin.initializeApp();
const crypto = require('crypto');
const sha = (s) => crypto.createHash('sha256').update(String(s || '').trim().toLowerCase()).digest('hex');
const H = process.env.HASH, DEL = process.env.DO_DELETE === '1';
(async () => {
  const db = admin.firestore(), auth = admin.auth();
  let tok, users = [];
  do { const r = await auth.listUsers(1000, tok); users.push(...r.users); tok = r.pageToken; } while (tok);
  const hit = users.filter((u) => sha(u.email) === H);
  console.log('auth users total', users.length, 'matching', hit.length);
  const emps = await db.collection('employees').get();
  const empByMail = emps.docs.filter((d) => sha(d.data().email) === H).map((d) => d.id.slice(0, 6));
  console.log('employees docs with that email field:', empByMail.length, empByMail.join(','));
  for (const u of hit) {
    const e = await db.doc('employees/' + u.uid).get(), r = await db.doc('roles/' + u.uid).get();
    const un = await db.collection('usernames').where('uid', '==', u.uid).get();
    console.log('uid', u.uid.slice(0, 6), 'providers', u.providerData.map((p) => p.providerId).join('+'), 'created', u.metadata.creationTime, 'lastSignIn', u.metadata.lastSignInTime,
      'employeeDoc', e.exists, 'roleDoc', r.exists, 'usernames', un.size, 'disabled', u.disabled);
    if (!e.exists && !r.exists) {
      if (DEL) {
        for (const d of un.docs) await d.ref.delete();
        await auth.deleteUser(u.uid);
        console.log('DELETED auth user', u.uid.slice(0, 6), '+ usernames', un.size);
      } else console.log('would delete');
    } else console.log('NOT deleted (has docs)');
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
