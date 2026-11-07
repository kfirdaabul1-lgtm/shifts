// one-off: fill fxRates from the first foreign-currency group (prints only weeks and public BOI rates)
const admin = require('firebase-admin'); admin.initializeApp();
const { fxSync } = require('./fx.js');
(async () => {
  const q = await admin.firestore().collection('groups').get();
  const fg = q.docs.map((d) => d.data()).filter((g) => g.cur && g.cur !== 'ils' && g.ci);
  const from = process.env.FROM || fg.map((g) => g.ci).sort()[0] || '';
  console.log('::notice title=fx::foreign groups ' + fg.length + ' (' + [...new Set(fg.map((g) => g.cur))].join(',') + '), from ' + (from || 'default'));
  const done = await fxSync(from || undefined);
  console.log('::notice title=fx saved::' + done.length + ' weeks ' + JSON.stringify(done).slice(0, 3000));
})().catch((e) => { console.log('::error title=fx::' + String(e.message || e).slice(0, 300)); process.exit(1); });
