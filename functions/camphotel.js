// Which hotel a social-media campaign report belongs to (Nov 7, owner: ad spend counts in each hotel's expenses).
// Same order as the ads agent (agent-ads.js attribution): the doc's hotel field, agentcfg/ads.hotelOf {connection id or name: hotelId},
// the connection's venue (settings.venues), the hotel's name inside the connection/campaign name. '' = chain only.
const norm = (x) => String(x || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9֐-׿]+/g, '');
async function campCtx(db) {
  const [hs, ss, ac] = await Promise.all([db.collection('hotels').get(), db.collection('settings').get(), db.doc('agentcfg/ads').get().catch(() => null)]);
  const hotels = hs.docs.map((d) => ({ id: d.id, key: norm((d.data() || {}).name || d.id) })), ids = new Set(hotels.map((h) => h.id));
  const venueHotel = {}; ss.docs.forEach((d) => { const v = (d.data() || {}).venues; if (ids.has(d.id) && Array.isArray(v)) v.forEach((x) => { if (x && !venueHotel[x]) venueHotel[x] = d.id; }); });
  const conf = {}; const cfg = ac && ac.exists ? ac.data() || {} : {}; Object.entries(cfg.hotelOf || {}).forEach(([k, v]) => { if (ids.has(v)) conf[norm(k)] = v; });
  return { hotels, ids, venueHotel, conf };
}
function campHotelOf(c, X) {
  const ok = (h) => (h && X.ids.has(h) ? h : '');
  const byConn = X.conf[norm(c.metaConn)] || X.conf[norm(c.metaConnName)] || '';
  const byText = () => { const n = norm((c.metaConnName || '') + ' ' + (c.name || '')), hit = X.hotels.filter((h) => h.key.length >= 3 && n.includes(h.key)); return hit.length === 1 ? hit[0].id : ''; };
  return ok(c.hotel) || ok(byConn) || ok(X.venueHotel[c.venue]) || byText() || '';
}
module.exports = { campCtx, campHotelOf };
