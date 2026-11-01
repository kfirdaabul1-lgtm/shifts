// one-time: tag existing Meta leads with their connection (by page name from the status of each connection)
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
(async () => {
  const cfg = (await db.doc('metacfg/main').get()).data() || {};
  const conns = { ...(cfg.conns || {}) }; if (cfg.token && !conns.main) conns.main = { name: 'חיבור 1' };
  const pageConn = {};
  for (const id of Object.keys(conns)) { const st = ((cfg.cst || {})[id] || {}).status || (id === 'main' ? cfg.status : {}) || {}; (st.pages || []).forEach((p) => { pageConn[p] = id; }); }
  console.log('::notice::connections ' + Object.entries(conns).map(([k, v]) => k + '=' + (v.name || '') + (v.venue ? '/' + v.venue : '')).join(', ') + ' · pages ' + JSON.stringify(pageConn));
  const snap = await db.collection('leads').get(); let n = 0; const cnt = {};
  for (const d of snap.docs) {
    if (!/^meta_/.test(d.id)) continue; const l = d.data(); if (l.metaConn) continue;
    const t = ((l.acts || [])[0] || {}).text || '', m = t.match(/"\s·\s([^·]+?)(\s·|$)/), page = m ? m[1].trim() : '';
    const id = pageConn[page] || (Object.keys(conns).length === 1 ? Object.keys(conns)[0] : '');
    if (!id) continue; const c = conns[id] || {};
    const up = { metaConn: id, metaConnName: c.name || '', page }; if (c.venue && !l.venue) up.venue = c.venue;
    await d.ref.set(up, { merge: true }); n++; cnt[id + ':' + page] = (cnt[id + ':' + page] || 0) + 1;
  }
  console.log(`::notice::tagged ${n} leads ${JSON.stringify(cnt)}`);
  process.exit(0);
})().catch((e) => { console.log('::error::' + e.message); process.exit(1); });
