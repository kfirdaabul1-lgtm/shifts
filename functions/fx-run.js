// one-off: fill fxRates from the first foreign-currency group (prints only weeks and public BOI rates)
// DIAG=grp prints only counts about confirmed groups (no names, no amounts)
const admin = require('firebase-admin'); admin.initializeApp();
const { fxSync } = require('./fx.js');
(async () => {
  const q = await admin.firestore().collection('groups').get();
  if (process.env.DIAG === 'grp') {
    const M = '2026-11', all = q.docs.map((d) => d.data()), c = {};
    const inc = (k) => { c[k] = (c[k] || 0) + 1; };
    for (const g of all) {
      inc('all:' + (g.status || '-'));
      if (g.status !== 'confirmed') continue;
      const inM = (g.ci || '') < '2026-12-01' && (g.co || '') > M + '-01';
      if (!inM) continue;
      inc('novConfirmed'); inc('cur:' + (g.cur || 'ils')); inc('src:' + (g.source || 'manual'));
      const lines = g.lines || []; const rooms = lines.reduce((t, l) => t + (+l.rooms || 0), 0);
      inc(rooms > 0 ? 'hasRooms' : 'noRooms'); inc(lines.some((l) => +l.price > 0) ? 'linePrice' : 'noLinePrice');
      inc(g.plId ? 'hasPl' : 'noPl'); inc(g.noPl ? 'freeMode' : 'plMode'); inc(+g.rate > 0 ? 'legacyRate' : 'noLegacyRate');
      inc(g.origin ? 'origin:' + g.origin : 'noOrigin'); inc('h:' + (g.hotel || '-') + ':' + (g.cur || 'ils') + ':' + (rooms > 0 ? 'rooms' : 'empty'));
    }
    const hs = await admin.firestore().collection('hotels').get(); console.log('::notice title=grp hotels::' + hs.docs.map((d) => d.id + '=' + (d.data().name || '')).join(', '));
    const fx = await admin.firestore().collection('fxRates').get(); console.log('::notice title=grp fx::' + fx.size + ' weeks');
    console.log('::notice title=grp diag::' + JSON.stringify(c)); return;
  }
  const fg = q.docs.map((d) => d.data()).filter((g) => g.cur && g.cur !== 'ils' && g.ci);
  const from = process.env.FROM || fg.map((g) => g.ci).sort()[0] || '';
  console.log('::notice title=fx::foreign groups ' + fg.length + ' (' + [...new Set(fg.map((g) => g.cur))].join(',') + '), from ' + (from || 'default'));
  const done = await fxSync(from || undefined);
  console.log('::notice title=fx saved::' + done.length + ' weeks ' + JSON.stringify(done).slice(0, 3000));
})().catch((e) => { console.log('::error title=fx::' + String(e.message || e).slice(0, 300)); process.exit(1); });
