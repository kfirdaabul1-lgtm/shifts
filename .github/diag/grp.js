// one-off: why does a group show 0 (structure only, no names/prices in the public log)
const admin = require('firebase-admin'); admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${m}`);
const has = (v) => v !== '' && v != null && !isNaN(+v);
(async () => {
  const gs = await db.collection('groups').where('name', '==', 'TL VL 55-633').get();
  note('groups found', gs.size);
  for (const d of gs.docs) {
    const g = d.data();
    note('group', JSON.stringify({ noPl: !!g.noPl, plId: !!g.plId, board: g.board, ci: g.ci, co: g.co, origin: g.origin || '', cur: g.cur, rooms: g.rooms, pax: g.pax, lines: (g.lines || []).map((l) => ({ cat: l.cat, ppr: l.ppr, rooms: l.rooms, type: !!l.type, price: has(l.price) && +l.price > 0 })), dayBoards: (g.dayBoards || []).length }));
    if (!g.plId) continue;
    const p = await db.doc('priceLists/' + g.plId).get();
    if (!p.exists) { note('pl', 'MISSING'); continue; }
    const pl = p.data(), grid = pl.grid || {}, mg = pl.mgrid || {};
    const gridInfo = {}; for (const n of Object.keys(grid)) gridInfo[n] = Object.keys(grid[n] || {}).filter((b) => has(grid[n][b]));
    const mInfo = {}; for (const m of Object.keys(mg)) { mInfo[m] = {}; for (const n of Object.keys(mg[m] || {})) mInfo[m][n] = Object.keys(mg[m][n] || {}).filter((b) => has(mg[m][n][b])); }
    note('pl', JSON.stringify({ active: pl.active, hotel: pl.hotel === g.hotel || !pl.hotel, from: pl.from, to: pl.to, cur: pl.cur, rows: (pl.rows || []).map((r) => ({ ppr: r.ppr, rate: has(r.rate) })), grid: gridInfo, mgrid: mInfo, bb: has(pl.bb), hb: has(pl.hb), fb: has(pl.fb) }));
  }
})().catch((e) => note('err', e.message));
