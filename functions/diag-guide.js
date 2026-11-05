// temporary diagnostic (no names/phones printed): groups with a guide link — halls, meals, related board quotes
const admin = require('firebase-admin'); admin.initializeApp(); const db = admin.firestore();
(async () => {
  const q = await db.collection('groups').where('guideKey', '>', '').get();
  for (const d of q.docs) {
    const g = d.data();
    const qs = await db.collection('quotes').where('group.groupId', '==', d.id).get();
    const grpQ = await db.collection('quotes').where('kind', '==', 'group').get();
    const near = grpQ.docs.filter((x) => { const e = (x.data().event || {}); return e.date && g.ci && e.date >= g.ci && e.date <= (g.co || g.ci); });
    console.log(JSON.stringify({ id: d.id, hotel: g.hotel, ci: g.ci, co: g.co, status: g.status, halls: (g.halls || []).map((h) => ({ date: h.date, start: h.start, qid: h.qid })), meals: g.meals || null, mealsKeys: Object.keys(g.meals || {}), guideAt: g.guideAt, board: g.board, linkedQuotes: qs.docs.map((x) => ({ id: x.id, date: (x.data().event || {}).date })), groupQuotesInStay: near.map((x) => ({ id: x.id, date: x.data().event.date, gid: (x.data().group || {}).groupId || '', sameName: (x.data().client || {}).name === g.name })) }));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
