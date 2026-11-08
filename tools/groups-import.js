// one-off (Nov 8, owner): import 218 7EVEN groups from claude/seven-groups-import.md. Data is committed only RSA/AES-encrypted
// (tools/imp/groups.enc); the private key lives in Firestore _import/key (no rules match = admin only) and is deleted after apply.
// STEP=key → make the key, print the PUBLIC key. STEP=dry → counts + agent mapping (agency names only). STEP=apply → write, delete key.
const admin = require('firebase-admin'); admin.initializeApp();
const crypto = require('crypto'), fs = require('fs'), db = admin.firestore();
const note = (t, m) => console.log('::notice title=' + t + '::' + String(m).replace(/\n/g, ' | '));
const AG = { // code → [full name in the file, match keywords (lower case)]
  K: ['מרכז קשת לתיירות חינוכית בעמ', ['קשת']], TD: ['טללים כנסים אירועים ותיירות בעמ', ['טללים']], T: ['טללים כנסים אירועים ותיירות בעמ', ['טללים']],
  MY: ['מסע יהודי בעמ', ['מסע יהודי']], SK: ['Sk Tours In Nature', ['s.k', 'sk tours']], IM: ['Israel Maven', ['maven', 'מייבן']],
  RI: ['רמה ישראל', ['רמה']], IT: ['Immanuel Tours Agencies Ltd', ['immanuel', 'עמנואל']], VH: ['ורד השרון נסיעות ותיירות בעמ', ['ורד השרון', 'vered']],
  VHI: ['ורד השרון נסיעות ותיירות בעמ', ['ורד השרון', 'vered']], YH: ['יהודה הצעיר ישראל', ['יהודה הצעיר']], IE: ['החוויה הישראלית שרותי תיירות', ['החוויה הישראלית']],
  AS: ['עמיאל טורס בעמ', ['עמיאל']], AD: ['עמיאל טורס בעמ', ['עמיאל']], GI: ['Get Israel', ['get israel']], DZ: ['דיזנהאוז-יוניתורס תיירות נכנסת 1998 בעמ', ['דיזנהאוז', 'דיזנגהאוז', 'unitour', 'יוניתורס', 'יוניטורס', 'diesenhaus']],
  TM: ['Tailor Made Tours Ltd', ['tailor', 'טיילור', 'טילור', 'טיילר']], SE: ['Sar El Tours And Conferences Ltd', ['sar el', 'שר אל', 'sarel']], NZ: ['הסתדרות חלוצית עולמית הנוער הציוני', ['הנוער הציוני']],
  NZD: ['הסתדרות חלוצית עולמית הנוער הציוני', ['הנוער הציוני']], AT: ['ידידי עתידים עמותה', ['עתידים', 'atidim']],
};
const TRIP = new Set(['TD', 'T', 'MY', 'IE', 'TM']), CUR = { TD: 'usd', IE: 'usd', TM: 'usd', AD: 'usd', NZD: 'usd', AS: 'ils' };
const clean = (s) => String(s || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
const nkey = (s) => clean(s).toLowerCase().replace(/\s+/g, ' ');
const addD = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
(async () => {
  const step = process.env.STEP;
  if (step === 'key') {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    await db.doc('_import/key').set({ privateKey, at: Date.now() });
    console.log(publicKey); note('Public key', publicKey.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '')); return;
  }
  const kd = await db.doc('_import/key').get(); if (!kd.exists) throw new Error('no key');
  const E = JSON.parse(fs.readFileSync('imp/groups.enc', 'utf8'));
  const k = crypto.privateDecrypt({ key: kd.data().privateKey, oaepHash: 'sha256' }, Buffer.from(E.k, 'base64'));
  const dc = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(E.iv, 'base64')); dc.setAuthTag(Buffer.from(E.tag, 'base64'));
  const txt = Buffer.concat([dc.update(Buffer.from(E.d, 'base64')), dc.final()]).toString('utf8');
  const rows = txt.split('\n').filter(Boolean).map((l) => { const [name, ag, ci, co, pax, board, o, notes] = l.split('|'); return { name: clean(name), ag, ci, co, pax: +pax, board, origin: o === 'i' ? 'il' : 'abroad', notes: String(notes || '').replace(/\\n/g, '\n') }; });
  note('Rows', rows.length);
  const hs = await db.collection('hotels').get();
  const hotel = hs.docs.find((d) => /7even|סבן/i.test(String((d.data() || {}).name || '') + ' ' + d.id));
  if (!hotel) throw new Error('no 7EVEN hotel'); const H = hotel.id, HN = (hotel.data() || {}).name || '';
  note('Hotel', H + ' ' + HN);
  const agents = (await db.collection('agents').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const agentMap = {}, toCreate = {};
  for (const code of new Set(rows.map((r) => r.ag))) {
    const [full, kws] = AG[code]; const hit = agents.filter((a) => kws.some((w) => nkey(a.name).includes(w)));
    if (hit.length === 1) agentMap[code] = { id: hit[0].id, name: hit[0].name };
    else if (hit.length > 1) { const best = hit.sort((a, b) => (b.active !== false) - (a.active !== false) || String(a.name).length - String(b.name).length)[0]; agentMap[code] = { id: best.id, name: best.name, multi: hit.map((a) => a.name).join(' / ') }; }
    else { const id = toCreate[full] || ('ag_' + crypto.randomBytes(8).toString('hex')); toCreate[full] = id; agentMap[code] = { id, name: full, created: true }; }
  }
  note('Agents', Object.entries(agentMap).map(([c, a]) => c + '→' + a.name + (a.created ? ' (חדש)' : '') + (a.multi ? ' [מתוך: ' + a.multi + ']' : '')).join(' ; '));
  const groups = (await db.collection('groups').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const byKey = {}; groups.forEach((g) => { (byKey[nkey(g.name) + '|' + g.ci] = byKey[nkey(g.name) + '|' + g.ci] || []).push(g); });
  const pls = (await db.collection('priceLists').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const plAg = (p) => (Array.isArray(p.agentIds) && p.agentIds.length ? p.agentIds : (p.agentId ? [p.agentId] : []));
  const plPick = (agId, ci, co) => { const last = addD(co, -1); const ok = pls.filter((p) => p.active !== false && (!p.hotel || p.hotel === H) && (!p.from || p.from <= ci) && (!p.to || p.to >= last));
    return ok.find((p) => plAg(p).includes(agId)) || ok.find((p) => !plAg(p).length) || null; };
  const agCur = {}; groups.forEach((g) => { if (g.agentId && g.cur) (agCur[g.agentId] = agCur[g.agentId] || {})[g.cur] = ((agCur[g.agentId] || {})[g.cur] || 0) + 1; });
  const topCur = (id) => { const m = agCur[id]; if (!m) return ''; return Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]; };
  const c = { create: 0, update: 0, otherHotel: 0, multiMatch: 0, withPl: 0, noPl: 0, curFile: 0, curPl: 0, curAgent: 0, curDefault: 0 };
  const now = Date.now(), ops = [];
  for (const r of rows) {
    const a = agentMap[r.ag], ppr = TRIP.has(r.ag) ? 3 : 2, rooms = Math.ceil(r.pax / ppr), pl = plPick(a.id, r.ci, r.co);
    let cur = CUR[r.ag] || ''; if (cur) c.curFile++; else if (pl && pl.cur) { cur = pl.cur; c.curPl++; } else if (topCur(a.id)) { cur = topCur(a.id); c.curAgent++; } else { cur = 'ils'; c.curDefault++; }
    pl ? c.withPl++ : c.noPl++;
    const m = byKey[nkey(r.name) + '|' + r.ci] || []; if (m.length > 1) c.multiMatch++;
    const ex = m.find((g) => g.hotel === H) || m[0];
    const base = { name: r.name, hotel: H, agentId: a.id, agentName: a.name, ci: r.ci, co: r.co, board: r.board, origin: r.origin, status: 'confirmed', updatedAt: now };
    if (ex) {
      if (ex.hotel && ex.hotel !== H) c.otherHotel++;
      const up = { ...base }; const exRooms = (ex.lines || []).filter((l) => (l.cat || 'guest') === 'guest').reduce((t, l) => t + (+l.rooms || 0), 0);
      if (!exRooms) { up.lines = [{ cat: 'guest', ppr, rooms, price: 0 }]; up.rooms = rooms; up.pax = r.pax; }
      if (!ex.cur) up.cur = cur; if (!ex.plId && pl) { up.plId = pl.id; up.plName = pl.name || ''; }
      if (r.notes && !String(ex.notes || '').includes(r.notes)) up.notes = ex.notes ? ex.notes + '\n' + r.notes : r.notes;
      ops.push(['u', ex.id, up]); c.update++;
    } else {
      const id = 'imp7_' + crypto.randomBytes(8).toString('hex');
      ops.push(['c', id, { ...base, cur, pax: r.pax, rooms, lines: [{ cat: 'guest', ppr, rooms, price: 0 }], plId: pl ? pl.id : '', plName: pl ? (pl.name || '') : '', notes: r.notes, comm: 0, deposit: 0, source: 'import', importedAt: now, createdAt: now, createdBy: 'import' }]); c.create++;
    }
  }
  note('Plan', JSON.stringify(c) + ' newAgents=' + Object.keys(toCreate).length);
  if (step !== 'apply') return;
  for (const [full, id] of Object.entries(toCreate)) await db.doc('agents/' + id).set({ name: full, active: true, comm: 0, source: 'import', createdAt: now });
  for (let i = 0; i < ops.length; i += 400) { const b = db.batch(); ops.slice(i, i + 400).forEach(([k, id, d]) => k === 'c' ? b.set(db.doc('groups/' + id), d) : b.set(db.doc('groups/' + id), d, { merge: true })); await b.commit(); }
  await db.doc('_import/key').delete();
  note('Done', 'written ' + ops.length + ', key deleted');
})().catch((e) => { console.log('::error title=Import failed::' + e.message); process.exit(1); });
