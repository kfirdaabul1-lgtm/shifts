// Operations manager (Nov 13): admin script run by .github/workflows/ops-run.yml.
// KIND = check (config + last log lines) | morning | checkin | weekly → creates opsJobs/{id} {kind, push:false} and waits for opsJob.
// Prints ids / status / counts only (public Actions logs) — never report text, names or rooms.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 400)}`);
(async () => {
  const c = (await db.doc('agentcfg/ops').get()).data();
  note('Config', c ? `enabled=${c.enabled === true} push=${c.push === true} hkTarget=${c.hkTarget} ratios=${Object.keys(c.ratios || {}).join(',')}` : 'agentcfg/ops missing');
  const kb = (await db.doc('agentKB/ops').get()).data(); note('KB', kb ? (kb.text || '').length + ' chars' : 'missing');
  const lg = await db.collection('agentLog').where('agent', '==', 'ops').get();
  for (const d of lg.docs.map((x) => x.data()).sort((a, b) => b.at - a.at).slice(0, 10)) note('Log', `${new Date(d.at).toISOString()} ${d.kind} ${d.hotel} items=${d.items ?? '-'} stop=${d.stop || '-'} in=${(d.usage || {}).in} out=${(d.usage || {}).out} ${d.error ? 'error=' + d.error : ''}`);
  { // Arsona guest requests + the nag state (counts only)
    const now = Date.now(), all = (await db.collection('guestReqs').get()).docs.map((d) => d.data() || {});
    const b = { open: 0, taken: 0, done: 0, other: 0 }, age = { u10: 0, m10_4h: 0, o4h: 0 }; let noHotel = 0;
    for (const r of all) { b[r.status in b ? r.status : 'other']++; if (r.status === 'open') { const m = (now - (+r.at || now)) / 60e3; if (m < 10) age.u10++; else if (m < 240) age.m10_4h++; else age.o4h++; if (!r.hotel) noHotel++; } }
    note('GuestReqs', `total=${all.length} ${JSON.stringify(b)} openAge=${JSON.stringify(age)} openNoHotel=${noHotel}`);
    const g = (await db.doc('opsWatch/greqNag').get()).data() || {}; note('Nag state', `at=${g.at ? new Date(g.at).toISOString() : '-'} tracked=${Object.keys(g.sent || {}).length} steps=${JSON.stringify(Object.values(g.sent || {}))}`);
    const wl = (await db.collection('agentLog').where('agent', '==', 'ops').get()).docs.map((d) => d.data()).filter((d) => d.kind === 'greq-wa' && d.at > now - 2 * 864e5);
    note('Nag WhatsApp 48h', `sent=${wl.length} ok=${wl.filter((d) => !d.error).length} errors=${[...new Set(wl.map((d) => d.error).filter(Boolean))].slice(0, 3).join(' | ')}`);
  }
  const kind = process.env.KIND;
  if (kind === 'warmcheck') { // Adam warm-up dry check (counts only)
    const now = Date.now(), il = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }), today = il(now), yest = il(now - 864e5);
    const ls = (await db.collection('leads').where('createdAt', '>=', now - 3 * 864e5).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => [today, yest].includes(il(+l.createdAt || 0)));
    const rc = (await db.doc('agentcfg/reply').get()).data() || {}; console.log('REPLY cfg', JSON.stringify({ enabled: rc.enabled, mode: rc.mode, scope: rc.scope, follow: rc.follow }));
    const wp = (await db.doc('wapub/main').get()).data() || {}; console.log('TEMPLATES', JSON.stringify((wp.templates || []).map((t) => [t.name, t.lang, t.n, (t.names || []).join('|'), String(t.body || '').length])));
    const wa = (await db.doc('waauto/main').get()).data() || {}; console.log('AUTO RULES', JSON.stringify(Object.fromEntries(Object.entries(wa.rules || {}).map(([k, r]) => [k, r.tpl]))));
    const rows = [], cc = ((await db.doc('leadcats/main').get()).data() || {}).campCat || {};
    for (const l of ls) {
      const dig = String(l.phone || '').replace(/\D/g, ''), wid = dig.startsWith('0') ? '972' + dig.slice(1) : dig;
      const c = wid.length >= 11 ? ((await db.doc('waChats/' + wid).get()).data() || null) : null;
      let msgs = []; if (c) msgs = (await db.collection('waChats/' + wid + '/msgs').orderBy('at', 'desc').limit(20).get()).docs.map((d) => d.data());
      const hum = msgs.filter((m) => m.dir === 'out' && /^[A-Za-z0-9]{20,40}$/.test(String(m.by || ''))).length, ai = msgs.filter((m) => m.by === 'ai').length;
      const ins = msgs.filter((m) => m.dir === 'in'), lastInType = ins[0] ? ins[0].type : '-';
      rows.push([il(l.createdAt) === today ? 'T' : 'Y', l.cat || '-', l.venue || '-', l.stage, l.source || '-', c ? 'chat' : 'nochat', c ? (c.lastInAt ? Math.round((now - c.lastInAt) / 36e5) + 'h' : 'noin') : '-', c ? c.lastDir : '-', c && c.agent ? 'agent' : '', hum, ai, ins.length, lastInType, l.waAutoAt ? 'auto' : '', 'map=' + (cc[l.campaign] || '-'), 'spaword=' + /ספא|spa|עיסוי|טיפול/i.test(String(l.campaign || '') + ' ' + String(l.type || ''))].join(' '));
    }
    console.log('LEADS', ls.length); rows.forEach((r) => console.log('ROW', r));
    const lg = (await db.collection('agentLog').where('agent', '==', 'reply').get()).docs.map((d) => d.data()).filter((d) => d.at > now - 864e5);
    console.log('REPLY LOG 24h', lg.length, JSON.stringify(lg.slice(0, 30).map((d) => [new Date(d.at).toISOString().slice(11, 16), d.skipped || d.follow || (d.replied ? 'replied' : '') || (d.error ? 'err' : '') || (d.route ? 'route' : '')])));
    return;
  }
  if (kind === 'hilaseed' || kind === 'hilaseed-force') { const ref = await db.collection('opsJobs').add({ kind: 'hilaseed', force: kind === 'hilaseed-force', at: Date.now(), by: 'workflow' }); for (let i = 0; i < 40; i++) { await new Promise((x) => setTimeout(x, 6000)); const j = (await ref.get()).data() || {}; if (j.status) { note('Hila seed', j.error || JSON.stringify(j.warm || {})); return; } } note('Hila seed', 'still running (job ' + ref.id + ')'); return; }
  if (kind === 'tplmake-followup') { const c = (await db.doc('wacfg/main').get()).data() || {}; // owner approved the wording, Nov 22
    const body = { name: 'followup_short', language: 'he', category: 'MARKETING', parameter_format: 'NAMED', components: [
      { type: 'BODY', text: 'היי {{customer_name}}, כאן {{agent_name}} 🙂 עדיין רלוונטי? אשמח להמשיך מאיפה שעצרנו', example: { body_text_named_params: [{ param_name: 'customer_name', example: 'דנה' }, { param_name: 'agent_name', example: 'טניה' }] } },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'אשמח שתחזרו אליי' }, { type: 'QUICK_REPLY', text: 'כבר לא רלוונטי' }] }] };
    const r = await fetch('https://graph.facebook.com/v23.0/' + c.wabaId + '/message_templates', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.token }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); note('followup_short', r.ok ? ('created ' + (j.status || '') + ' ' + (j.category || '')) : ('error ' + String((j.error && (j.error.error_user_msg || j.error.message)) || r.status).slice(0, 200))); return; }
  if (kind.startsWith('tpl:')) { const c = (await db.doc('wacfg/main').get()).data() || {}; const r = await fetch('https://graph.facebook.com/v23.0/' + c.wabaId + '/message_templates?fields=name,language,status,category,components&name=' + encodeURIComponent(kind.slice(4)), { headers: { Authorization: 'Bearer ' + c.token } }); const j = await r.json().catch(() => ({})); for (const t of (j.data || [])) console.log('TPLFULL|' + JSON.stringify(t.components)); return; } // one template's full text (business text only)
  if (kind === 'tpllist') { const c = (await db.doc('wacfg/main').get()).data() || {}; const r = await fetch('https://graph.facebook.com/v23.0/' + c.wabaId + '/message_templates?fields=name,language,status,category,rejected_reason,components&limit=200', { headers: { Authorization: 'Bearer ' + c.token } }); const j = await r.json().catch(() => ({})); if (j.error) { note('Templates', 'error ' + String(j.error.message).slice(0, 120)); return; } for (const t of (j.data || [])) { const b = ((t.components || []).find((x) => x.type === 'BODY') || {}).text || ''; console.log('TPL|' + t.name + '|' + t.language + '|' + t.category + '|' + t.status + (t.rejected_reason && t.rejected_reason !== 'NONE' ? ' ' + t.rejected_reason : '') + '|' + b.replace(/\s+/g, ' ').slice(0, 110)); } note('Templates', (j.data || []).length + ' templates'); return; } // template names/status for the owner (business text only)
  if (kind === 'tplstat') { const c = (await db.doc('wacfg/main').get()).data() || {}; for (const n of ['job_screening_open', 'job_screening_start']) { const r = await fetch('https://graph.facebook.com/v23.0/' + c.wabaId + '/message_templates?name=' + n, { headers: { Authorization: 'Bearer ' + c.token } }); const j = await r.json().catch(() => ({})); note('Template ' + n, (j.data || []).map((t) => t.name + ' ' + t.language + ' ' + t.status + (t.rejected_reason && t.rejected_reason !== 'NONE' ? ' (' + t.rejected_reason + ')' : '')).join(' | ') || (j.error ? 'error ' + String(j.error.message).slice(0, 120) : 'not found')); } return; }
  if (kind === 'ivcheck') { // hiring leads: where interviews are recorded (counts only)
    const L = (await db.collection('leads').where('cat', '==', 'jobs').get()).docs.map((d) => d.data() || {});
    const st = {}; let next = 0, ivWord = 0, actsIv = 0, tasks = 0;
    for (const l of L) { st[l.stage || '-'] = (st[l.stage || '-'] || 0) + 1; if (l.nextAt) next++; if (/ראיון|interview/i.test(String(l.notes || ''))) ivWord++; if ((l.acts || []).some((a) => /ראיון|interview/i.test(String(a.text || '')))) actsIv++; }
    const T = (await db.collection('tasks').get()).docs.map((d) => d.data() || {}); const ids = new Set((await db.collection('leads').where('cat', '==', 'jobs').get()).docs.map((d) => d.id));
    tasks = T.filter((t) => ids.has(t.leadId)).length;
    const C = (await db.collection('candidates').get()).docs.map((d) => d.data() || {}); const cst = {}; C.forEach((c) => { cst[c.status || '-'] = (cst[c.status || '-'] || 0) + 1; });
    note('Jobs', `leads=${L.length} stages=${JSON.stringify(st)} nextAt=${next} notesIv=${ivWord} actsIv=${actsIv} tasks=${tasks} candidates=${C.length} cstatus=${JSON.stringify(cst)} candKeys=${[...new Set(C.flatMap((c) => Object.keys(c)))].join(',').slice(0, 300)}`);
    return; }
  if (kind === 'blog') { // Gili's readiness: booleans/counts only
    const a = (await db.doc('agentcfg/blog').get()).data() || {}, b = (await db.doc('blogcfg/main').get()).data() || {}, st = (b.sites || {}).chain || {};
    const kb = {}; for (const h of Object.keys(a.hotels || {}).concat([''])) { const d = (await db.doc('agentKB/blog' + (h ? '_' + h : '')).get()).data() || {}; kb[h || 'general'] = String(d.text || '').length; }
    const dr = (await db.collection('blogDrafts').get()).docs.map((d) => (d.data() || {}).status || '-'); const by = {}; dr.forEach((x) => { by[x] = (by[x] || 0) + 1; });
    note('Gili', JSON.stringify({ enabled: a.enabled, hotels: Object.keys(a.hotels || {}), kbChars: kb, site: { url: !!st.url, user: !!st.user, pass: !!st.appPass, test: st.test ? { ok: st.test.ok, roles: st.test.roles } : null }, drafts: by, wpAllow: a.wpAllow === true }));
    return; }
  if (kind === 'arielunclaim') { // free catch-up claims of recruit chats whose last message is still unanswered (Nov 23)
    { const q = await db.collection('candidates').where('status', '==', 'screening').get(); let f = 0; for (const d of q.docs) { const c = d.data() || {}; if (c.finishedAt) { await d.ref.update({ finishedAt: admin.firestore.FieldValue.delete() }); f++; } } note('Ariel resumed fix', 'finishedAt cleared ' + f); }
    const Ch = (await db.collection('waChats').where('lastAt', '>', Date.now() - 6 * 36e5).get()).docs.filter((d) => { const c = d.data() || {}; return c.recruit && c.lastDir === 'in'; }); const out = [];
    for (const d of Ch) { const rs = (await d.ref.collection('msgs').orderBy('at', 'desc').limit(3).get()).docs; const l = rs.find((x) => (x.data() || {}).type !== 'reaction'); if (!l) continue; const m = l.data() || {};
      const cr = db.doc('agentClaims/recruitCu_' + d.id + '_' + l.id), ex = (await cr.get()).exists; if (ex) await cr.delete();
      const c2 = (await db.doc('agentClaims/recruit_' + d.id + '_' + l.id).get()).exists;
      out.push([m.dir, m.type, m.src || '', String(m.text || '').trim().length, ex ? 'cu' : '', c2 ? 'rt' : '', Math.round((Date.now() - (+m.at || 0)) / 6e4)].join(',')); }
    note('Ariel unclaim', JSON.stringify(out)); return;
  }
  if (kind === 'arielho') { // why Ariel hands off (buckets/counts only, Nov 26)
    const since = Date.now() - 10 * 864e5, cs = (await db.collection('candidates').get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => (+c.updatedAt || 0) > since);
    const st = {}; cs.forEach((c) => { st[c.status || '?'] = (st[c.status || '?'] || 0) + 1; }); note('Statuses (10 days)', JSON.stringify(st));
    const bk = (r) => { r = String(r || '').toLowerCase(); return /too many/.test(r) ? 'too-many-msgs' : /staff/.test(r) ? 'staff-chat' : /person|human|נציג|אדם|representative|agent/.test(r) ? 'asked-person' : /salary|pay|שכר|תנאים/.test(r) ? 'salary' : /not (a )?job|guest|supplier|customer|לקוח|אורח/.test(r) ? 'not-job-seeker' : /sure|unclear|unknown|לא בטוח|question|שאלה/.test(r) ? 'unsure/question' : 'other'; };
    const b = {}; cs.filter((c) => c.status === 'handoff').forEach((c) => { const k = bk(c.handoff); b[k] = (b[k] || 0) + 1; }); note('Handoff reasons', JSON.stringify(b));
    const q = cs.filter((c) => c.status === 'qualified' || c.status === 'not_fit'); const miss = q.filter((c) => (c.missing || []).length).length, nocv = q.filter((c) => !c.cv).length;
    const ans = q.map((c) => Object.keys(c.answers || {}).length); note('Finished', 'n=' + q.length + ' withMissing=' + miss + ' noCV=' + nocv + ' answersPerCand=' + JSON.stringify(ans));
    const rates = []; for (const c of cs) { if (!c.chat) continue; const r = await db.doc('agentRate/recruit_' + c.chat).get(); if (r.exists) rates.push(+r.data().n || 0); } note('Ariel replies per chat', JSON.stringify(rates.sort((x, y) => y - x)));
    const logs = (await db.collection('agentLog').where('agent', '==', 'recruit').get()).docs.map((d) => d.data()).filter((d) => d.at > since); const sk = {}; logs.forEach((l) => { const k = l.skipped ? String(l.skipped).slice(0, 40) : l.error ? 'error' : 'run'; sk[k] = (sk[k] || 0) + 1; }); note('Recruit log', JSON.stringify(sk));
    return; }
  if (kind === 'ariel') { // Ariel's on/off history and template (booleans/names/times only)
    const r = (await db.doc('agentcfg/recruit').get()).data() || {}; const T = ((await db.doc('wapub/main').get()).data() || {}).templates || [];
    const ot = r.openTemplate && typeof r.openTemplate === 'object' ? r.openTemplate.tpl : r.openTemplate;
    note('Ariel cfg', JSON.stringify({ enabled: r.enabled, mode: r.mode, ot, otApproved: T.some((t) => t.name === ot), toggledBy: r.toggledBy || '', toggledAt: r.toggledAt ? new Date(r.toggledAt).toISOString() : '', updatedAt: r.updatedAt || '', keys: Object.keys(r) }));
    { const C = (await db.collection('candidates').get()).docs.map((d) => d.data() || {}); const st = {}, wt = {}; C.forEach((c) => { st[c.status || '-'] = (st[c.status || '-'] || 0) + 1; if (c.status === 'waiting_template') wt[String(c.note || '').slice(0, 50)] = (wt[String(c.note || '').slice(0, 50)] || 0) + 1; });
      const L = (await db.collection('leads').where('cat', '==', 'jobs').get()).docs.map((d) => d.data() || {}); const day = Date.now() - 3 * 864e5; const recent = L.filter((l) => (l.createdAt || 0) > day);
      note('Ariel candidates', JSON.stringify({ cands: C.length, status: st, waiting: wt, jobLeads: L.length, last3d: recent.length, last3dNoCand: recent.filter((l) => !C.some((c) => c.leadId === l.id)).length, last3dPhone: recent.filter((l) => l.phone).length })); }
    { const since = Date.now() - 12 * 36e5; const Ch = (await db.collection('waChats').where('lastAt', '>', since).get()).docs.filter((d) => { const c = d.data() || {}; return c.recruit || c.cat === 'jobs'; });
      const why = {}; for (const d of Ch) { const c = d.data() || {}; if (c.lastDir !== 'in') { why.answered = (why.answered || 0) + 1; continue; }
        const cd = (await db.doc('candidates/' + String(c.leadId || '')).get()).data() || null; const lim = (await db.doc('agentRate/recruit_' + d.id).get()).data() || {};
        const k = [!c.recruit ? 'noRecruitFlag' : '', c.aiRecruit && c.aiRecruit.off ? 'off' : '', c.agent ? 'staffAgent' : '', !cd ? 'noCand:' + (c.leadId ? 'lead' : 'noLead') : 'st:' + (cd.status || '-'), lim.n ? 'n' + lim.n : '', c.aiNight && c.aiNight.recruit ? 'night' : '', 'min' + Math.round((Date.now() - (+c.lastAt || 0)) / 6e4)].filter(Boolean).join('|');
        why[k] = (why[k] || 0) + 1;
        if (cd && ['contacted', 'screening', 'new'].includes(cd.status)) { const ms = (await d.ref.collection('msgs').orderBy('at', 'desc').limit(5).get()).docs.map((x) => x.data() || {});
          const lgc = (await db.collection('agentLog').where('chat', '==', d.id).get()).docs.map((x) => x.data() || {}).sort((x, y) => y.at - x.at).slice(0, 4);
          note('Ariel chat ' + d.id.slice(-4), JSON.stringify({ msgs: ms.map((x) => [x.dir, x.type, /^[A-Za-z0-9]{20,}$/.test(x.by || '') ? 'uid' : (x.by || ''), x.src || '', x.status || '', Math.round((Date.now() - (+x.at || 0)) / 6e4)].join(',')), log: lgc.map((x) => [x.agent, Math.round((Date.now() - x.at) / 6e4), x.skipped || x.err || x.stop || Object.keys(x).join('/')].join(',')) })); } }
      note('Ariel unanswered 12h', JSON.stringify({ chats: Ch.length, why })); }
    const lg = (await db.collection('agentLog').orderBy('at', 'desc').limit(300).get()).docs.map((d) => d.data()).filter((x) => /recruit|ariel/.test(x.agent || '')).slice(0, 12);
    note('Ariel log', lg.map((x) => new Date(x.at).toISOString().slice(5, 16) + ' ' + (x.agent || '') + '/' + (x.kind || '') + ' ' + (x.err ? 'ERR ' + String(x.err).slice(0, 60) : (x.skipped ? 'SKIP ' + String(x.skipped).slice(0, 40) : (x.stop || '')))).join(' | ') || 'none');
    return; }
  if (kind === 'wainfo') { // phone numbers' status on Meta (booleans/status only)
    const c = (await db.doc('wacfg/main').get()).data() || {};
    for (const [lbl, id] of [['main', c.phoneId], ['agents', c.aliPhoneId]]) { if (!id) { note('Phone ' + lbl, 'none'); continue; }
      const r = await fetch('https://graph.facebook.com/v23.0/' + id + '?fields=is_official_business_account,name_status,platform_type,code_verification_status,quality_rating,messaging_limit_tier,account_mode', { headers: { Authorization: 'Bearer ' + c.token } }); const j = await r.json();
      note('Phone ' + lbl, j.error ? ('error ' + j.error.code + ' ' + j.error.message) : JSON.stringify(j).replace(/"id":"\d+",?/, '')); }
    if (c.wabaId) { const r = await fetch('https://graph.facebook.com/v23.0/' + c.wabaId + '/phone_numbers?fields=is_official_business_account,display_phone_number,platform_type', { headers: { Authorization: 'Bearer ' + c.token } }); const j = await r.json(); note('WABA numbers', j.error ? 'error ' + j.error.code : JSON.stringify((j.data || []).map((x) => ({ n: String(x.display_phone_number || '').slice(-4), oba: x.is_official_business_account, p: x.platform_type })))); }
    return; }
  if (kind === 'wagroup' || kind === 'wawin') { if (kind === 'wawin') { const c = (await db.doc('wacfg/main').get()).data() || {}; const d = String(c.aliOwnerPhone || '').replace(/\D/g, ''); const t = d.startsWith('972') ? d.slice(3) : d.replace(/^0/, ''); const w = (await db.doc('aliWa/972' + t.slice(-9)).get()).data() || {}; note('Window', 'ownerPhone=' + !!c.aliOwnerPhone + ' openH=' + (w.lastInAt ? ((Date.now() - w.lastInAt) / 36e5).toFixed(1) : '-')); return; } const ref = await db.collection('opsJobs').add({ kind: 'wagroup', at: Date.now(), by: 'workflow' }); for (let i = 0; i < 30; i++) { await new Promise((x) => setTimeout(x, 5000)); const j = (await ref.get()).data() || {}; if (j.status) { note('Group', j.error || JSON.stringify(j.warm || {})); return; } } note('Group', 'no answer yet'); return; }
  if (kind === 'adamroute' || kind === 'adamroute-dry') { const ref = await db.collection('opsJobs').add({ kind: 'adamroute', dry: kind === 'adamroute-dry', at: Date.now(), by: 'workflow' }); for (let i = 0; i < 30; i++) { await new Promise((x) => setTimeout(x, 5000)); const j = (await ref.get()).data() || {}; if (j.status) { note('Route', j.error || JSON.stringify(j.warm || {})); return; } } note('Route', 'no answer yet (job ' + ref.id + ')'); return; }
  if (kind === 'ivscan' || kind === 'ivscan-dry') { const ref = await db.collection('opsJobs').add({ kind: 'ivscan', dry: kind === 'ivscan-dry', at: Date.now(), by: 'workflow' }); for (let i = 0; i < 80; i++) { await new Promise((x) => setTimeout(x, 6000)); const j = (await ref.get()).data() || {}; if (j.status) { note('Interview scan', j.error || JSON.stringify(j.iv || {})); return; } } note('Interview scan', 'still running (job ' + ref.id + ')'); return; }
  if (kind === 'greqwho') { const ref = await db.collection('opsJobs').add({ kind, at: Date.now(), by: 'workflow' }); for (let i = 0; i < 30; i++) { await new Promise((x) => setTimeout(x, 5000)); const j = (await ref.get()).data() || {}; if (j.status) { note('Greq targets', j.error || JSON.stringify(j.warm || {})); return; } } note('Greq targets', 'no answer yet'); return; }
  if (kind === 'recruitcatchup') { const ref = await db.collection('opsJobs').add({ kind: 'recruitcatchup', at: Date.now(), by: 'workflow' }); for (let i = 0; i < 60; i++) { await new Promise((x) => setTimeout(x, 6000)); const j = (await ref.get()).data() || {}; if (j.status) { note('Recruit catchup', j.error || JSON.stringify(j.warm || {})); return; } } note('Recruit catchup', 'still running'); return; }
  if (kind === 'recruitresume' || kind === 'recruitresume-dry') { const ref = await db.collection('opsJobs').add({ kind: 'recruitresume', dry: kind.endsWith('-dry'), at: Date.now(), by: 'workflow' }); for (let i = 0; i < 60; i++) { await new Promise((x) => setTimeout(x, 6000)); const j = (await ref.get()).data() || {}; if (j.status) { note('Recruit resume', j.error || JSON.stringify(j.warm || {})); return; } } note('Recruit resume', 'still running'); return; }
  if (kind === 'recruitall' || kind === 'recruitall-dry') { const ref = await db.collection('opsJobs').add({ kind: 'recruitall', dry: kind === 'recruitall-dry', at: Date.now(), by: 'workflow' }); for (let i = 0; i < 60; i++) { await new Promise((x) => setTimeout(x, 6000)); const j = (await ref.get()).data() || {}; if (j.status) { note('Recruit all', j.error || JSON.stringify(j.warm || {})); return; } } note('Recruit all', 'still running (job ' + ref.id + ')'); return; }
  if (kind === 'adamcb') { const ref = await db.collection('opsJobs').add({ kind, at: Date.now(), by: 'workflow' }); for (let i = 0; i < 30; i++) { await new Promise((x) => setTimeout(x, 5000)); const j = (await ref.get()).data() || {}; if (j.status) { note('Callbacks', j.error || JSON.stringify(j.warm || {})); return; } } note('Callbacks', 'no answer yet (job ' + ref.id + ')'); return; }
  if (kind === 'adamwarm' || kind === 'adamwarm-dry') { // Adam warms yesterday's + today's event leads (counts only)
    const ref = await db.collection('opsJobs').add({ kind: 'adamwarm', days: 1, dry: kind === 'adamwarm-dry', at: Date.now(), by: 'workflow' }); note('Job', ref.id + ' created');
    for (let i = 0; i < 50; i++) { await new Promise((x) => setTimeout(x, 6000)); const j = (await ref.get()).data() || {};
      if (j.status) { note('Warm', j.error ? 'error ' + j.error : JSON.stringify(j.warm || {})); return; } }
    note('Job', 'still running'); return;
  }
  if (kind === 'hkplan') { // Aliana's housekeeping plan for tomorrow (counts only)
    const ref = await db.collection('opsJobs').add({ kind, push: false, at: Date.now(), by: 'workflow' }); note('Job', ref.id + ' created');
    for (let i = 0; i < 40; i++) { await new Promise((x) => setTimeout(x, 6000)); const j = (await ref.get()).data() || {};
      if (j.status) { if (j.error) note('Job error', j.error); for (const d of j.done || []) note('Hotel ' + d.hotel, d.error ? 'error' : `rooms=${d.rooms} crew=${d.crew} pri=${d.pri} shortage=${d.shortage} noRoom=${d.noRoom}`); note('Day', j.day || '-'); return; } }
    note('Job', 'still running'); return;
  }
  if (!['morning', 'checkin', 'weekly'].includes(kind)) return;
  const ref = await db.collection('opsJobs').add({ kind, push: false, at: Date.now(), by: 'workflow' });
  note('Job', ref.id + ' created, waiting');
  for (let i = 0; i < 70; i++) {
    await new Promise((x) => setTimeout(x, 10000));
    const j = (await ref.get()).data() || {};
    if (j.status === 'done' || j.status === 'error') {
      if (j.error) note('Job error', j.error);
      const done = Array.isArray(j.done) ? j.done : [];
      for (const d of done) note('Hotel ' + d.hotel, d.error ? 'error' : `items=${d.items ?? '-'} changes=${d.changes ?? '-'} missing=${d.missing ?? '-'}`);
      if (!done.length) note('Job', 'nothing ran (agent off?)');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
      if (kind !== 'weekly') for (const id of done.map((d) => kind + '_' + d.hotel + '_' + today).concat(kind === 'morning' ? ['morning_chain_' + today] : [])) {
        const r = await db.doc('opsReports/' + id).get(); if (!r.exists) { note('Report ' + id, 'missing'); continue; }
        const x = r.data(); note('Report ' + id, `headline=${(x.headline || '').length}ch summary=${(x.summary || '').length}ch priorities=${(x.priorities || []).length} items=${(x.items || []).length} high=${(x.items || []).filter((i) => i.sev === 'high').length} model=${x.model || 'code'} pushed=${Object.keys(x.pushed || {}).length}`);
      }
      return;
    }
  }
  note('Job', 'still running after ~12 min');
})().catch((e) => { note('ops-run error', e.message); process.exitCode = 1; });
