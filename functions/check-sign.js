// Diagnostic (workflow "Check contract signing"): is the remote-signing link set up, and how long are the links? Prints no secrets or client data.
const admin = require('firebase-admin'); const zlib = require('zlib');
admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 400)}`);
(async () => {
  const c = (await db.doc('config/main').get()).data() || {}, s = (c.settings || c).sign || {};
  note('Sign settings', `url ${s.url ? s.url.slice(0, 45) + '…' : 'MISSING'} · secret ${s.secret ? 'set' : 'MISSING'} · notify email ${s.email ? 'set' : 'MISSING'} · config keys: ${Object.keys(c).slice(0, 12).join(',')}`);
  if (s.url) { try { const r = await fetch(s.url, { redirect: 'follow' }); const b = await r.text(); note('Sign page probe', `status ${r.status} · ${/הקישור חסר/.test(b) ? 'our sign page answers' : b.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120)}`); } catch (e) { note('Sign page probe', 'error ' + e.message); } }
  const qs = await db.collection('quotes').orderBy('updatedAt', 'desc').limit(40).get().catch(() => db.collection('quotes').limit(40).get());
  let n = 0, signed = 0, lens = [];
  qs.forEach((d) => { const q = d.data(); if (q.kind === 'group') return; n++; if (q.signature) signed++; const j = JSON.stringify({ q: { items: q.items, notes: q.notes, event: q.event, client: { name: '' } }, k: q.contract || null, m: q.menus || null }); lens.push(Math.round(zlib.gzipSync(j).length * 4 / 3) + 120); });
  lens.sort((a, b) => a - b);
  note('Quotes', `${n} recent quotes · ${signed} with an in-person signature · estimated link length min ${lens[0]} / median ${lens[lens.length >> 1]} / max ${lens[lens.length - 1]} chars`);
})().catch((e) => note('Check error', e.message));
