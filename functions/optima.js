// Optima Agent → bookings (owner, Nov 20). The Windows agent on Hotels.Terminal reads each hotel's Optima export and POSTs the CHANGED
// bookings here (all of them once a day). Same docs as the PMS mails: bookings/{hotel}__{Optima Master ID}, so nothing is duplicated.
// optimacfg/main (owner only) {on, keys:{sola, boheme, sevenseas, hostel}, hotelIds?, hkSync?:{hostel:true}} — a key can write ONLY its own hotel.
// The agent names the hotels by short name; bookings use the real hotel ids (HOTEL_ID; optimacfg.hotelIds may override).
// Rules of the merge (claude/optima-agent-plan.md):
//  - rooms are matched by Optima's reservation id (rid), never by their position in the list
//  - a room number from Optima wins; an empty one never erases a room assigned in the app
//  - an older export never overwrites a newer one (optSnap); a booking missing from an export is NEVER cancelled
//  - status stays booked | cancelled (what the board, 10days and the agents read); arrival state goes to `stay` res | in | out
//  - a room checked out in Optima → checked out in the app's housekeeping day too (OD/OC → VD), and its worker gets a push (Nov 28)
// Housekeeping, app → Optima (Nov 28, claude/optima-hk-sync-patch.md): a room that became VC in the app is queued (optimaHkQueue);
//  the agent takes the queue (op hkqueue), sets VC in Optima's Room Status screen and reports (op hkdone). Off unless optimacfg/main.hkSync[hotel].
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
    // rooms that went from in-house to checked out in this export (for the housekeeping day and the push)
    const was = {}; old.forEach((r) => { if (r && r.rid) was[r.rid] = r.stay; });
    // dorm beds are included (owner, Nov 28): in Optima every bed is a room of its own (1011 = dorm 101, bed 1), the same id as the app's bed unit
    const out = lines.filter((r) => r.stay === 'out' && was[r.rid] === 'in' && r.room).map((r) => r.room);
    return { up, same, gone, out, firstTime };
  }

  // Optima checkout → the app's housekeeping day (owner, Nov 28): same as the "ביצוע צ׳ק אאוט" button: an OD/OC room becomes VD.
  async function checkoutPush(h, rooms) {
    if (!rooms.length) return;
    const dd = await db.doc('hkday/' + h).get(), day = (dd.exists && dd.data().date) || ilDate(new Date());
    const ref = db.doc('hk/' + h + '__' + day), D = (await ref.get()).data() || {}, cl = D.clean || {}, asg = D.asg || {}, now = Date.now();
    const set = rooms.filter((r) => cl[r] === 'od' || cl[r] === 'oc');          // only rooms the app has as occupied
    if (set.length) await ref.set({ hotel: h, date: day, updatedAt: now, lastBy: 'optima',
      clean: Object.fromEntries(set.map((r) => [r, 'vd'])), cleanBy: Object.fromEntries(set.map((r) => [r, 'Optima'])), cleanAt: Object.fromEntries(set.map((r) => [r, now])) }, { merge: true });
    // the worker of a room that was OD/OC gets the push from onHkVacant (OD/OC → VD); the others (the app did not have it as occupied) get it here
    const per = {};
    rooms.filter((r) => !set.includes(r)).forEach((r) => { if (asg[r]) (per[asg[r]] = per[asg[r]] || []).push(r); });
    const hn = await hotelName(h);
    await Promise.all(Object.entries(per).map(([u, rs]) => sendTo([u], { title: rs.length > 1 ? 'חדרים התפנו (צ׳ק אאוט)' : 'החדר התפנה (צ׳ק אאוט)', body: `${hn ? hn + ': ' : ''}חדר ${rs.join(', ')} עשה צ׳ק אאוט, אפשר לנקות`, hash: '#hk', tag: 'optco-' + u + '-' + rs.join('-') })));
    return { set };
  }

  // ---------- housekeeping, app → Optima ----------
  const HK_TO = ['vc'], HK_TTL = 6 * 36e5;   // owner, Nov 28: only the final VC goes to Optima (the VI step stays in the app)
  const optUnit = (room) => { // app unit → Optima room number: the same number (a dorm bed is 1011 in both). A "101-3" style id would become 1013.
    const r = String(room || '').trim(), m = r.match(/^(\d{3})\D+(\d)$/);
    return (m ? m[1] + m[2] : r).replace(/[^\w]/g, '').slice(0, 10);
  };
  const hkQueueJobs = (b, a) => { // pure: which rooms changed in the app → { add: [{room,to}], void: [room] }
    const bc = b.clean || {}, ac = a.clean || {}, add = [], vo = [];
    for (const [room, v] of Object.entries(ac)) if (bc[room] !== v) (HK_TO.includes(v) ? add : vo).push(HK_TO.includes(v) ? { room, to: v } : room);
    return { add, void: vo };
  };
  const onHkToOptima = functions.region(REGION).firestore.document('hk/{id}').onWrite(async (ch) => {
    if (!ch.after.exists) return;
    const a = ch.after.data() || {}, b = ch.before.exists ? ch.before.data() || {} : {};
    if (!a.hotel || !a.date || a.lastBy === 'optima') return;              // never echo a change that came from Optima
    const cs = await db.doc('optimacfg/main').get(), cfg = cs.exists ? cs.data() || {} : {};
    if (!cfg.on || !cfg.hkSync) return;
    const short = HOTELS.find((h) => String(((cfg.hotelIds || {})[h]) || HOTEL_ID[h]) === a.hotel);
    if (!short || !cfg.hkSync[short]) return;
    const dd = await db.doc('hkday/' + a.hotel).get(), day = (dd.exists && dd.data().date) || ilDate(new Date());
    if (a.date !== day) return;                                            // today's housekeeping day only
    const j = hkQueueJobs(b, a), now = Date.now(), id = (r) => 'optimaHkQueue/' + short + '__' + a.date + '__' + String(r).replace(/[^\w-]/g, '');
    await Promise.all([
      ...j.add.map((x) => db.doc(id(x.room)).set({ hotel: short, hid: a.hotel, date: a.date, room: String(x.room), unit: optUnit(x.room), to: x.to, at: now, status: 'pending', by: String(a.lastBy || '').slice(0, 40) })),
      ...j.void.map(async (r) => { const d = await db.doc(id(r)).get(); if (d.exists && d.data().status === 'pending') await d.ref.set({ status: 'void', doneAt: now }, { merge: true }); }),
    ]);
  });
  async function hkOps(b, hotel, now, res) {
    if (b.op === 'hkqueue') { // one equality filter only (no composite index needed); the hotel is filtered here
      const q = await db.collection('optimaHkQueue').where('status', '==', 'pending').limit(200).get();
      const items = q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.hotel === hotel && x.at > now - HK_TTL && x.unit && HK_TO.includes(x.to)).slice(0, 40).map((x) => ({ id: x.id, room: x.unit, to: x.to }));
      res.json({ ok: true, items }); return;
    }
    const RES = ['done', 'skipped', 'failed']; let n = 0;
    for (const x of (Array.isArray(b.items) ? b.items : []).slice(0, 60)) {
      const id = String(x.id || ''); if (!id.startsWith(hotel + '__') || !RES.includes(x.result)) continue;
      const ref = db.doc('optimaHkQueue/' + id.replace(/[^\w-]/g, '')), d = await ref.get();
      if (!d.exists || d.data().hotel !== hotel || d.data().status !== 'pending') continue;
      await ref.set({ status: x.result, doneAt: now, reason: s(x.reason, 60) }, { merge: true }); n++;
    }
    await db.doc('optimaState/' + hotel).set({ hkAt: now, hkLastN: n }, { merge: true });
    res.json({ ok: true, updated: n });
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
      if (b.op === 'hkqueue' || b.op === 'hkdone') { await hkOps(b, hotel, now, res); return; }
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

  return { optimaIngest, onHkToOptima, _t: { merge, cleanItem, hkQueueJobs, optUnit } };
};
