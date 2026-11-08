// one-off diag: ask the ads chat as the owner; prints only lengths/status and the agentLog meta (no answer text)
const admin = require('firebase-admin'); admin.initializeApp();
const fs = require('fs');
const KEY = (fs.readFileSync(__dirname + '/index.js', 'utf8').match(/WEB_KEY = [^']*'([^']+)'/) || [])[1];
(async () => {
  const u = await admin.auth().getUserByEmail('kfirdaabul1@gmail.com');
  const ct = await admin.auth().createCustomToken(u.uid);
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ct, returnSecureToken: true }) });
  const { idToken } = await r.json();
  const t0 = Date.now();
  const a = await fetch('https://europe-west1-hotel-shifts.cloudfunctions.net/adsAgent', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify({ messages: [{ role: 'user', text: process.env.Q || 'האם הסושיאל עושים עבודה טובה בקמפיינים של סבן?' }] }) });
  const j = await a.json().catch(() => ({}));
  console.log('::notice title=answer::' + JSON.stringify({ http: a.status, ms: Date.now() - t0, textLen: (j.text || '').length, failed: /לא הצלחתי/.test(j.text || ''), error: j.error, tools: j.tools }));
  const q = await admin.firestore().collection('agentLog').orderBy('at', 'desc').limit(3).get();
  q.docs.forEach((d) => { const x = d.data(); console.log('::notice title=log::' + JSON.stringify({ at: new Date(x.at).toISOString(), kind: x.kind, model: x.model, tools: x.tools, out: x.usage && x.usage.out, stop: x.stop, textLen: x.textLen })); });
})().catch((e) => { console.log('fail', e.message); process.exit(1); });
