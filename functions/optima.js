// Optima Agent → bookings (owner, Nov 20). The Windows agent on Hotels.Terminal reads each hotel's Optima export and POSTs the CHANGED
// bookings here (all of them once a day). Same docs as the PMS mails: bookings/{hotel}__{Optima Master ID}, so nothing is duplicated.
// optimacfg/main (owner only) {on, keys:{sola, boheme, sevenseas, hostel}, hotelIds?} — a key can write ONLY its own hotel.
// The agent names the hotels by short name; bookings use the real hotel ids (HOTEL_ID; optimacfg.hotelIds may override).
// Rules of the merge (claude/optima-agent-plan.md):
//  - rooms are matched by Optima's reservation id (rid), never by their position in the list
//  - a room number from Optima wins; an empty one never erases a room assigned in the app
//  - an older export never overwrites a newer one (optSnap); a booking missing from an export is NEVER cancelled
//  - status stays booked | cancelled (what the board, 10days and the agents read); arrival state goes to `stay` res | in | out
//  - a room checked out in Optima → push to the housekeeping worker assigned to it ("the room is free, you can clean")
module.exports = ({ functions, admin, db, REGION, sendTo, hotelName, ilDate }) => {
  const crypto = require('crypto');
  const HOTELS = ['sola', 'boheme', 'sevenseas', 'hostel'], STAYS = ['res', 'in', 'out', 'cancelled'];
  const HOTEL_ID = { sola: 'hezj3h4cj', boheme: 'h9xtmhzkm', sevenseas: 'hq4tapo0a', hostel: 'main' }; // 7EVEN, The Gutman, The Seven Seas, Hostel 180
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  const int = (v) => Math.max(0, Math.min(99, Math.round(+v || 0)));

  function cleanItem(x) {
    const conf = s(x && x.conf, 40).replace(/[^\w-]/g, '');
    const rooms = (Array.isArray(x && x.rooms) ? x.rooms : []).slice(0, 30).map((r) => ({
      rid: s(r.rid, 44).replace(/[^\w#-]/g, ''), room: s(r.room, 10).replace(/[^\w-]/g, ''), beds: (Array.isArray(r.beds) ? r.beds : []).slice(0, 12).map((b) => s(b, 10)),
      type: s(r.type, 60), ci: iso(r.ci), co: iso(r.co), adults: int(r.adults), children: int(r.children), babies: int(r.babies),
      people: int(r.people) || int(r.adults) + int(r.children) + int(r.babies), board: ['RO', 'BB', 'HB', 'FB'].includes(r.board) ? r.board : '',
      stay: STAYS.includes(r.stay) ? r.stay : '', ...(r.guest ? { guest: s(r.guest, 100) } : {}), ...(r.vip ? { vip: true } : {}) }));
    if (!conf || !rooms.length || rooms.some((r) => !r.rid || !r.ci || !r.co || !r.stay)) return null;
    return { conf, rooms, guest: s(x.guest, 100), comment: s(x.comment, 600).replace(/\s+/g, ' ').trim(), channel: s(x.channel, 60), group: s(x.group, 80) };
  }

  // pure: the new booking fields from the current doc + one item of one export. Returns null when there is nothing to write.
  function merge(cd, it, snap, win, now) {
    if ((+cd.optSnap || 0) >= snap) return { skip: 'stale' };
    const old = [...(cd.rooms || []), ...(cd.roomsX || [])], byRid = {};
    old.forEach((r) => { if (r && r.rid) byRid[r.rid] = r; });
    const firstTime = !cd.optSnap, oldAct = cd.rooms || [];
    const lines = it.rooms.map((r, i) => {
      // first Optima write over a booking made from the mails (no rids yet): positions only when the count is the same — the mail path did that too
      const p = byRid[r.rid] || (firstTime && oldAct.length === it.rooms.length ? oldAct[i] : null) || {};
      const o = { ...r, room: r.room || s(p.room, 10), people: r.people || int(p.people), type: r.type || s(p.type, 60), board: r.board || s(p.board, 2) };
      if (!o.beds.length) delete o.beds;
      return o;
    });
    // a room line of this booking that is not in the export: removed only if its dates are inside the scanned window (outside = just not scanned)
    const seen = new Set(lines.map((r) => r.rid));
    const kept = old.filter((r) => r && r.rid && !seen.has(r.rid) && (!win || !(r.ci <= win.to && r.co >= win.from)));
    const gone = old.filter((r) => r && r.rid && !seen.has(r.rid) && !kept.includes(r)).map((r) => r.rid);
    const all = [...lines, ...kept], act = all.filter((r) => r.stay !== 'cancelled'), use = act.length ? act : all;
    const stay = !act.length ? 'cancelled' : act.some((r) => r.stay === 'in') ? 'in' : act.every((r) => r.stay === 'out') ? 'out' : 'res';
    const up = {
      status: act.length ? 'booked' : 'cancelled', stay, rooms: use, roomsX: act.length ? all.filter((r) => r.stay === 'cancelled') : [],
      ci: use.map((r) => r.ci).sort()[0], co: use.map((r) => r.co).sort().slice(-1)[0],
      people: use.reduce((a, r) => a + (+r.people || 0), 0), board: [...new Set(use.map((r) => r.board).filter(Boolean))].join('/'),
    };
    if (it.guest) up.guest = it.guest; if (it.comment) up.comment = it.comment; if (it.channel) up.channel = it.channel; if (it.group) up.group = it.group;
    const keys = Object.keys(up), same = keys.every((k) => JSON.stringify(cd[k] === undefined ? (Array.isArray(up[k]) ? [] : '') : cd[k]) === JSON.stringify(up[k]));
    // rooms that went from in-house to checked out in this export (for the housekeeping push)
    const was = {}; old.forEach((r) => { if (r && r.rid) was[r.rid] = r.stay; });
    // dorm beds: one guest leaving does not free the room (other beds may still be taken) → no push for dorms (hostel, Nov 27)
    const out = lines.filter((r) => r.stay === 'out' && was[r.rid] === 'in' && r.room && !/dorm/i.test(r.type)).map((r) => r.room);
    return { up, same, gone, out, firstTime };
  }

  async function checkoutPush(h, rooms) {
    if (!rooms.length) return;
    const dd = await db.doc('hkday/' + h).get(), day = (dd.exists && dd.data().date) || ilDate(new Date());
    const D = (await db.doc('hk/' + h + '__' + day).get()).data() || {}, asg = D.asg || {}, per = {};
    rooms.forEach((r) => { if (asg[r]) (per[asg[r]] = per[asg[r]] || []).push(r); });
    const hn = await hotelName(h);
    await Promise.all(Object.entries(per).map(([u, rs]) => sendTo([u], { title: rs.length > 1 ? 'חדרים התפנו (צ׳ק אאוט)' : 'החדר התפנה (צ׳ק אאוט)', body: `${hn ? hn + ': ' : ''}חדר ${rs.join(', ')} עשה צ׳ק אאוט, אפשר לנקות`, hash: '#hk', tag: 'optco-' + u + '-' + rs.join('-') })));
  }

  const optimaIngest = functions.region(REGION).runWith({ timeoutSeconds: 120 }).https.onRequest(async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
    try {
      const cs = await db.doc('optimacfg/main').get(), cfg = cs.exists ? cs.data() || {} : {}, got = String(req.get('x-optima-key') || '');
      const hotel = cfg.on ? HOTELS.find((h) => { const k = String((cfg.keys || {})[h] || ''); return k.length >= 24 && got.length === k.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(k)); }) : null;
      if (!hotel) { res.status(403).json({ error: 'forbidden' }); return; }
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}, now = Date.now();
      if (b.op === 'heartbeat') { await db.doc('optimaState/agent').set({ at: now, agent: s(b.agent, 10), errors: int(b.errors) }, { merge: true }); res.json({ ok: true }); return; }
      if (b.hotel !== hotel) { res.status(403).json({ error: 'hotel' }); return; } // the key belongs to another hotel
      const hid = String(((cfg.hotelIds || {})[hotel]) || HOTEL_ID[hotel]);
      const snap = +b.snapshotAt || 0;
      if (!(snap > now - 7 * 864e5 && snap < now + 6e5)) { res.status(400).json({ error: 'snapshotAt' }); return; }
      if (b.op === 'review') { // bookings the agent held back (unknown status / bad dates): only the numbers and the reason, for the owner
        const list = (Array.isArray(b.items) ? b.items : []).slice(0, 300).map((x) => ({ conf: s(x.conf, 40), reason: s(x.reason, 40), raw: s(x.raw, 20) }));
        await db.doc('optimaState/' + hotel).set({ review: list, reviewAt: now }, { merge: true }); res.json({ ok: true, saved: list.length }); return;
      }
      if (b.op !== 'bookings') { res.status(400).json({ error: 'op' }); return; }
      const raw = Array.isArray(b.items) ? b.items : [];
      if (raw.length > 300) { res.status(400).json({ error: 'too many items' }); return; }
      const win = b.window && iso(b.window.from) && iso(b.window.to) ? { from: b.window.from, to: b.window.to } : null;
      let saved = 0, skipped = 0; const bad = [], outRooms = [];
      for (const x of raw) {
        const it = cleanItem(x); if (!it) { bad.push(s(x && x.conf, 40)); continue; }
        const ref = db.doc('bookings/' + hid + '__' + it.conf);
        const r = await db.runTransaction(async (tx) => {
          const cur = await tx.get(ref), cd = cur.exists ? cur.data() || {} : {}, m = merge(cd, it, snap, win, now);
          if (m.skip) return m;
          const seenOnly = { optSnap: snap, ...(b.full ? { optSeenAt: now } : {}) };
          if (m.same && !m.firstTime) { tx.set(ref, seenOnly, { merge: true }); return { skip: 'same' }; }
          tx.set(ref, { ...m.up, hotel: hid, conf: it.conf, src: 'optima', by: 'optima', updatedAt: now, ...seenOnly, optSeenAt: now, ...(cur.exists ? {} : { createdAt: now }),
            hist: admin.firestore.FieldValue.arrayUnion({ at: now, mt: snap, action: 'optima', ...(m.gone.length ? { gone: m.gone } : {}) }) }, { merge: true });
          return m;
        });
        if (r.skip) skipped++; else { saved++; outRooms.push(...(r.out || [])); }
      }
      await db.doc('optimaState/' + hotel).set({ hotelId: hid, lastAt: now, lastSnap: snap, lastItems: raw.length, lastSaved: saved, lastBad: bad.length, ...(b.full ? { fullAt: now } : {}) }, { merge: true });
      try { await checkoutPush(hid, [...new Set(outRooms)]); } catch (e) { console.warn('optima checkout push', e.message); }
      res.json({ ok: true, saved, skipped, bad });
    } catch (e) { console.error('optimaIngest', e); res.status(500).json({ error: 'server' }); }
  });

  return { optimaIngest, _t: { merge, cleanItem } };
};
