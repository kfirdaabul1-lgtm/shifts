// Optima Agent check (Nov 27): counts only — never names, phones or keys (the repo and its logs are public).
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).slice(0, 900)}`);
(async () => {
  const st = (await db.doc('optimaState/hostel').get()).data() || {}, ag = (await db.doc('optimaState/agent').get()).data() || {};
  note('State', JSON.stringify({ hotelId: st.hotelId, lastItems: st.lastItems, lastSaved: st.lastSaved, lastBad: st.lastBad, review: (st.review || []).length, agentAt: ag.at ? new Date(ag.at).toISOString() : '' }));
  const q = await db.collection('bookings').where('hotel', '==', 'main').get();
  const c = { all: q.size, optima: 0, other: 0, stay: {}, status: {}, roomsWithNo: 0, lines: 0, lineNoRoom: 0, multi: 0, withGuest: 0, wrongHotelDocs: 0, ridLines: 0, posMatched: 0 };
  q.forEach((d) => { const b = d.data() || {}; if (b.src !== 'optima') { c.other++; return; } c.optima++;
    c.stay[b.stay] = (c.stay[b.stay] || 0) + 1; c.status[b.status] = (c.status[b.status] || 0) + 1;
    const rs = b.rooms || []; c.lines += rs.length; if (rs.length > 1) c.multi++; if (b.guest) c.withGuest++;
    rs.forEach((r) => { if (r.rid) c.ridLines++; if (!r.room) c.lineNoRoom++; }); if (rs.some((r) => r.room)) c.roomsWithNo++;
    if (!d.id.startsWith('main__')) c.wrongHotelDocs++; if ((b.hist || []).some((h) => h.action === 'import' || h.action === 'new')) c.posMatched++; });
  note('Hostel bookings', JSON.stringify(c));
  const bad = await db.collection('bookings').where('hotel', '==', 'hostel').get();
  note('Docs under wrong id "hostel"', String(bad.size));
  // housekeeping sync queue (room numbers + status only)
  const cfg = (await db.doc('optimacfg/main').get()).data() || {};
  note('hkSync', JSON.stringify({ on: cfg.on === true, hkSync: cfg.hkSync || {} }));
  const hq = await db.collection('optimaHkQueue').orderBy('at', 'desc').limit(25).get();
  const t = (v) => v ? new Date(v).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '';
  note('HK queue (newest 25)', hq.docs.map((d) => { const x = d.data(); return [x.hotel, x.room, x.status, t(x.at), t(x.doneAt), x.reason || ''].join(' '); }).join(' | ') || 'empty');
  for (const h of ['sola', 'boheme', 'sevenseas']) { const s2 = (await db.doc('optimaState/' + h).get()).data() || {}; note('State ' + h, JSON.stringify({ lastItems: s2.lastItems, lastSaved: s2.lastSaved, at: s2.at ? new Date(s2.at).toISOString() : '' })); }
})().catch((e) => { console.log('::error title=check::' + e.message); process.exit(1); });
