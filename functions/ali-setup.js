// one-off (owner, Nov 8): find Aliana's new number (…6959294) in the WABA and save its Phone number ID in wacfg/main.aliPhoneId
// (onAliCfg then registers it). Prints only statuses, never ids or tokens.
const admin = require('firebase-admin'); admin.initializeApp();
const db = admin.firestore();
(async () => {
  const c = (await db.doc('wacfg/main').get()).data() || {};
  if (!c.token || !c.wabaId) { console.log('no token/waba'); return; }
  const r = await fetch('https://graph.facebook.com/v23.0/' + c.wabaId + '/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,name_status,status', { headers: { Authorization: 'Bearer ' + c.token } });
  const j = await r.json();
  if (j.error) { console.log('graph error:', j.error.message); return; }
  for (const p of j.data || []) console.log('number …' + String(p.display_phone_number).replace(/\D/g, '').slice(-4), '| verify:', p.code_verification_status, '| name:', p.name_status, '| status:', p.status);
  const hit = (j.data || []).find((p) => String(p.display_phone_number).replace(/\D/g, '').endsWith('796959294'));
  if (!hit) { console.log('Aliana number not in this WABA'); return; }
  if (c.aliPhoneId === hit.id) { await db.doc('wacfg/main').set({ aliSync: Date.now() }, { merge: true }); console.log('already saved, re-sync requested'); }
  else { await db.doc('wacfg/main').set({ aliPhoneId: hit.id }, { merge: true }); console.log('saved aliPhoneId'); }
  await new Promise((s) => setTimeout(s, 25000));
  const st = ((await db.doc('wacfg/main').get()).data() || {}).aliStatus || {};
  console.log('aliStatus ok:', st.ok, '| msg:', st.msg || '', '| reg:', st.reg, st.regErr ? '| regErr: ' + st.regErr : '');
})().catch((e) => { console.log('fail', e.message); process.exit(1); });
