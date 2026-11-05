// fields of a group that reception may see (no prices / agent / notes) — used by mirrorGroupPub and backfill.js
const GRP_PUB = ['name', 'hotel', 'ci', 'co', 'status', 'rooms', 'pax', 'board', 'dayBoards', 'halls', 'hallsAt', 'hallsBy', 'guideRooms', 'guideName', 'guidePhone', 'guideKey', 'guideMsgs', 'guideAt', 'guideBy', 'guideWaLast', 'guideReplies', 'guideNames', 'meals', 'roomPax', 'roomCat'];
function grpPubDoc(g) {
  const o = {};
  for (const k of GRP_PUB) if (g[k] !== undefined) o[k] = g[k];
  if (Array.isArray(g.lines)) o.lines = g.lines.map((l) => ({ cat: l.cat || 'guest', ppr: +l.ppr || 0, rooms: +l.rooms || 0 }));
  return o;
}
module.exports = { grpPubDoc };
