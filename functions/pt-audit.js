// Temporary read-only check (Nov 13, owner): employees without pushTokens / without tokens.
// Output (names/phones) is encrypted with the public key given as input — public Actions logs show only ciphertext + counts.
const admin = require('firebase-admin'), crypto = require('crypto');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
(async () => {
  const pub = Buffer.from(process.env.PUB || '', 'base64').toString();
  const [es, ts, hs, ms] = await Promise.all(['employees', 'pushTokens', 'hotels', 'mgr'].map((c) => db.collection(c).get()));
  const tok = {}; ts.forEach((d) => { tok[d.id] = Object.keys((d.data() || {}).tokens || {}).length; });
  const hn = { chain: 'הרשת' }; hs.forEach((d) => { hn[d.id] = d.data().name || d.id; });
  const act = {}; ms.forEach((d) => { act[d.id] = d.data().active; });
  const rows = []; let total = 0, ok = 0;
  es.forEach((d) => {
    const e = d.data() || {}; total++;
    const st = !(d.id in tok) ? 'nodoc' : tok[d.id] ? 'ok' : 'notokens';
    if (st === 'ok') { ok++; return; }
    rows.push({ hotel: hn[e.hotel] || e.hotel || '', depts: e.depts || [], name: e.name || '', phone: e.phone || '', st, manual: d.id.startsWith('m_') || !!e.manual, inactive: act[d.id] === false || e.active === false, mgmt: e.mgmt || '' });
  });
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(rows)), c.final()]), tag = c.getAuthTag();
  const ek = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  console.log(`::notice title=Counts::employees ${total}, with tokens ${ok}, missing ${rows.length}`);
  const blob = [ek, iv, tag, enc].map((b) => b.toString('base64')).join('.');
  for (let i = 0; i < blob.length; i += 4000) console.log('BLOB' + String(i / 4000).padStart(3, '0') + ':' + blob.slice(i, i + 4000));
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
