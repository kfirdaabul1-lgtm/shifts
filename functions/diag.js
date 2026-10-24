// Diagnostic for a housekeeping worker (workflow "Diagnose"): prints her employee/role scope and today's room state. No pay or secrets.
const admin = require('firebase-admin'); admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 900)}`);
(async () => {
  const q = String(process.env.WHO || 'wendy').toLowerCase();
  const es = await db.collection('employees').get(); const hits = es.docs.filter((d) => String(d.data().name || '').toLowerCase().includes(q) || String(d.data().name || '').includes('וונדי') || String(d.data().name || '').includes('ונדי'));
  note('Matches', hits.map((d) => `${d.id}: ${d.data().name} · hotel ${d.data().hotel} · depts ${(d.data().depts || []).join(',')} · mgmt ${d.data().mgmt || ''} · active ${d.data().active}`).join(' | ') || 'none');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  for (const d of hits) {
    const r = await db.doc('roles/' + d.id).get(); note('Role ' + d.data().name, r.exists ? JSON.stringify({ apps: r.data().apps, hotels: r.data().hotels, job: r.data().jobName }) : 'no role doc');
    const h = d.data().hotel; const day = await db.doc('hkday/' + h).get(); const hd = day.exists ? day.data().date : today;
    const hk = await db.doc('hk/' + h + '__' + hd).get(); const D = hk.exists ? hk.data() : {};
    const mine = Object.keys(D.asg || {}).filter((k) => D.asg[k] === d.id);
    note('HK ' + h + ' ' + hd + ' (today ' + today + ')', `exists ${hk.exists} · lastBy ${D.lastBy} · rooms: ` + mine.map((k) => `${k} clean=${(D.clean || {})[k]} start=${(D.start || {})[k] ? new Date(D.start[k]).toISOString().slice(11, 16) : '-'} done=${(D.done || {})[k] ? 'y' : '-'} trt=${(D.trt || {})[k] || ''}/${(D.trtDone || {})[k] ? 'y' : ''} chk=${(D.chk || {})[k] ? 'y' : ''} back=${(D.back || {})[k] ? 'y' : ''}`).join('; '));
    const lb = await db.collection('hk').where('lastBy', '==', d.id).get(); note('HK docs last written by her', lb.docs.map((x) => x.id).join(', ') || 'none');
    const lg = await db.collection('hkLog').where('uid', '==', d.id).get(); note('Her cleaning logs', lg.size + ' ' + lg.docs.slice(-5).map((x) => x.id).join(', '));
    const hs = await db.collection('hk').where('hotel', '==', h).get(); note('HK docs of hotel', hs.docs.map((x) => x.id.split('__')[1] + ':' + Object.keys(x.data().start || {}).length + 's/' + Object.keys(x.data().done || {}).length + 'd').join(', '));
    for (const x of hs.docs) { const v = x.data(); note('Doc ' + x.id, Object.keys(v).map((k) => k + ':' + (v[k] === null ? 'null' : Array.isArray(v[k]) ? 'arr' : typeof v[k] === 'object' ? 'map' + Object.keys(v[k]).length : JSON.stringify(v[k]).slice(0, 30))).join(' ')); }
    const tok = await db.doc('pushTokens/' + d.id).get(); if (tok.exists) note('Devices ' + d.data().name, Object.values(tok.data().tokens || {}).map((t) => String(t.ua || '').slice(0, 90)).join(' | '));
  }
})().catch((e) => note('Diag error', e.message));
