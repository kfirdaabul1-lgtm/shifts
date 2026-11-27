// One-off/idempotent: copy shift reports that have no money-free copy yet into shiftReportsPub.
// Runs from the deploy workflow after the functions deploy (service-account credentials).
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const KEYS = ['hotel', 'month', 'date', 'shift', 'name', 'empUid', 'ooo', 'faults', 'lost', 'cmp', 'booking', 'ciLeft', 'coLeft', 'ci', 'co', 'cid', 'unusual', 'details', 'createdAt', 'by'];
(async () => {
  // Adam, the events reply agent (Nov 9, owner): create its settings OFF and its first knowledge text, ONLY when missing (never overwrites)
  try {
    { const wa = db.doc('waauto/main'); const ws = await wa.get(); if (!String((ws.exists && ws.data().arsonaFrom) || '').trim()) { await wa.set({ arsonaFrom: '+972795157779' }, { merge: true }); console.log('::notice title=Arsona::sender number set'); } }
    { const rs = await db.collection('ratesLog').where('hotel', '==', 'main').get(); let last = null; rs.forEach(d => { const x = d.data(); if (!last || (x.runAt || 0) > (last.runAt || 0)) last = x; });
      if (last) { const rx = /do+rm|דורם|מיטה במעונות|bed in|beds|mixed|female|male|מעורב|נשים בלבד|גברים בלבד/i; const own = [...new Set((last.rows || []).filter(r => r.src !== 'comp').map(r => r.room || ''))]; const cmp = [...new Set((last.rows || []).filter(r => r.src === 'comp').map(r => r.comp || ''))];
        console.log('::notice title=Hostel rooms::' + own.map(n => (rx.test(n) ? '[D] ' : '[P] ') + n).join(' | ').slice(0, 1500));
        console.log('::notice title=Hostel comps::' + cmp.map(n => (rx.test(n) ? '[D] ' : '[P] ') + n).join(' | ').slice(0, 1500)); } else console.log('::notice title=Hostel rooms::no runs'); }
    { // owner, Nov 15: Arsona's number opened a WhatsApp chat + lead before the routing fix → move its messages to guest requests, remove the chat/lead
      const ch = '972795157779', cref = db.doc('waChats/' + ch), ms = await cref.collection('msgs').get(); let n = 0; const types = {};
      for (const d of ms.docs) { const x = d.data() || {}; types[x.type || '?'] = (types[x.type || '?'] || 0) + 1; if (x.dir !== 'in') continue;
        const real = x.text && !/^\[הודעה מסוג/.test(x.text) ? x.text : '';
        try { await db.doc('guestReqs/ars_' + d.id.replace(/[^A-Za-z0-9_-]/g, '').slice(-60)).create({ type: 'agent', hotel: '', hotelTxt: '', at: x.at || Date.now(), status: 'open', assignee: '', assigneeName: '', leadId: '', from: ch, createdAt: Date.now(), acts: [], kind: 'הודעה מארסונה', reason: '', guest: '', phone: '', email: '', conf: '', room: '', channel: 'WhatsApp', when: '', summary: real || 'הודעה מארסונה שהוואטסאפ לא העביר את התוכן שלה למערכת (כנראה הודעה עם כפתורים). יש לפתוח אותה בארסונה או בוואטסאפ בטלפון.', raw: real, unreadable: !real, msgType: String(x.type || '') }); n++; } catch (e) { }
        await d.ref.delete(); }
      if (ms.size) console.log('::notice title=Arsona chat::moved ' + n + ' msgs · types ' + JSON.stringify(types));
      if ((await cref.get()).exists) await cref.delete();
      const lr = db.doc('leads/wa_' + ch), ls = await lr.get();
      if (ls.exists && (ls.data().source === 'whatsapp') && !ls.data().owner) { await lr.delete(); console.log('::notice title=Arsona chat::lead removed'); }
    }
    const rc = db.doc('agentcfg/recruit'); // recruiting agent: created OFF (owner, Nov 18)
    if (!(await rc.get()).exists) { await rc.set({ enabled: false, name: '', openTemplate: { tpl: 'job_screening_start', lang: 'he' }, match: { forms: [], campaigns: [], words: '' }, notify: false, createdAt: Date.now(), createdBy: 'setup' }); console.log('::notice title=Recruit::agentcfg/recruit created (off)'); }
    const blr = db.doc('agentcfg/blog'); // blog / SEO agent: created OFF with the real hotel ids — owner, Nov 21
    if (!(await blr.get()).exists) { await blr.set({ enabled: false, postsPerHotel: 1, langs: ['he'], wpStatus: 'publish', hotels: [
      { id: 'h9xtmhzkm', name: 'The Gutman', site: 'gutman', book: 'https://www.simplebooking.it/ibe2/hotel/11482' },
      { id: 'hq4tapo0a', name: 'The Seven Seas', site: 'sevenseas', book: 'https://www.simplebooking.it/ibe2/hotel/11451' },
      { id: 'hezj3h4cj', name: '7EVEN', site: '7even', book: '' }], createdAt: Date.now(), createdBy: 'setup' }); console.log('::notice title=Blog::agentcfg/blog created (off)'); }
    // Nov 21 (owner): ONE chain WordPress site for every hotel → every blog hotel uses site key 'chain' (an earlier per-hotel site config is copied once)
    { const bd = await blr.get(); if (bd.exists && !bd.data().siteNov21) { const hs = (bd.data().hotels || []).map((h) => ({ ...h, site: 'chain' }));
        await blr.set({ hotels: hs, siteNov21: true }, { merge: true });
        const bc = db.doc('blogcfg/main'), bs = ((await bc.get()).data() || {}).sites || {};
        if (!bs.chain) { const k = Object.keys(bs).find((x) => bs[x] && bs[x].url); if (k) await bc.set({ sites: { chain: { ...bs[k], test: admin.firestore.FieldValue.delete() } } }, { merge: true }); }
        console.log('::notice title=Blog::hotels moved to the chain site (' + hs.length + ')'); } }
    { const bd = await blr.get(); if (bd.exists && !bd.data().nameNov21) { await blr.set({ name: 'גילי', nameNov21: true }, { merge: true }); console.log('::notice title=Blog::agent named Gili'); } }
    const hr = db.doc('agentcfg/hila'); // Hila, spa + bride sales agent: created OFF (training only) — owner, Nov 17
    if (!(await hr.get()).exists) { await hr.set({ enabled: false, name: 'הילה', mode: 'draft', scope: ['spa', 'bride'], createdAt: Date.now(), createdBy: 'setup' }); console.log('::notice title=Hila::agentcfg/hila created (off)'); }
    const cr = db.doc('agentcfg/reply');
    if (!(await cr.get()).exists) { await cr.set({ enabled: false, name: 'אדם', mode: 'draft', scope: ['events'], createdAt: Date.now(), createdBy: 'setup' }); console.log('::notice title=Adam::agentcfg/reply created (off, draft)'); }
    // Nov 17 (owner: "Adam should start answering event leads and keep them warm"): switch him ON once, sending by himself (auto),
    // filling empty lead fields, moving Gutman leads by the hotel rule and following up inside the 24h window. Later changes by the owner are kept.
    { const c = await cr.get(); if (c.exists && !c.data().onNov17) { await cr.set({ enabled: true, mode: 'auto', writeLead: true, route: true, follow: true, onNov17: Date.now() }, { merge: true }); console.log('::notice title=Adam::switched ON (auto, follow-ups, routing)'); } }
    const kr = db.doc('agentKB/reply');
    if (!(await kr.get()).exists) { const t = require('fs').readFileSync(require('path').join(__dirname, 'kb', 'reply-seed.md'), 'utf8').trim(); await kr.set({ text: t, updatedAt: Date.now(), updatedBy: 'setup', updatedByName: 'הזנה ראשונה' }); console.log('::notice title=Adam::agentKB/reply created, ' + t.length + ' chars'); }
    // Adi's campaign reports (Nov 16, owner: a report every Sunday and Thursday for the chain and every hotel): turn them on once
    { const ar = db.doc('agentcfg/ads'), ad = (await ar.get()).data() || {};
      if (ad.enabled !== true && !ad.onNov16) { await ar.set({ enabled: true, onNov16: Date.now() }, { merge: true }); console.log('::notice title=Adi::campaign reports turned on'); } }
    // WhatsApp template for Aliana's nags to reception employees (owner, Nov 17): create once on our WABA, Meta approves it
    try {
      const W = (await db.doc('wacfg/main').get()).data() || {}, ar = db.doc('waauto/main'), A = (await ar.get()).data() || {};
      if (!A.greqTpl) await ar.set({ greqTpl: { tpl: 'greq_alert', lang: 'he' } }, { merge: true });
      if (W.token && W.wabaId && !A.greqTplMade) {
        const r = await fetch('https://graph.facebook.com/v23.0/' + W.wabaId + '/message_templates', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + W.token },
          body: JSON.stringify({ name: 'greq_alert', language: 'he', category: 'UTILITY', components: [{ type: 'BODY', text: 'שלום {{1}}, בפניות האורחים של {{2}} יש פנייה שמחכה כבר {{3}} דקות ואף אחד עוד לא לקח אותה: {{4}} – {{5}}. נא להיכנס לאפליקציה, לקחת את הפנייה ולענות לאורח.', example: { body_text: [['דנה', 'מלון 7EVEN', '15', 'אורח · חדר 408', 'מבקש מגבות']] } }] }) });
        const j = await r.json().catch(() => ({}));
        const ok = r.ok || /already exists|duplicate/i.test(JSON.stringify(j.error || {}));
        if (ok) await ar.set({ greqTplMade: Date.now() }, { merge: true });
        console.log('::notice title=greq template::' + (r.ok ? 'created, status ' + (j.status || '?') : ok ? 'already exists' : 'failed: ' + String(((j.error || {}).message) || r.status).slice(0, 150)));
      }
    } catch (e) { console.log('::notice title=greq template::error ' + String(e.message).slice(0, 120)); }
    // Adam's warm-up template for event leads whose 24h window is closed (owner, Nov 17): Marketing, quick replies, create once
    try {
      const W = (await db.doc('wacfg/main').get()).data() || {}, ar = db.doc('waauto/main'), A = (await ar.get()).data() || {};
      if (W.token && W.wabaId && !A.warmTplMade) {
        const r = await fetch('https://graph.facebook.com/v23.0/' + W.wabaId + '/message_templates', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + W.token },
          body: JSON.stringify({ name: 'adam_warm_up', language: 'he', category: 'MARKETING', components: [
            { type: 'BODY', text: 'היי {{1}} 😊 כאן אדם מצוות האירועים של {{2}}. ראיתי שהשארת אצלנו פרטים לגבי אירוע ורציתי לוודא שלא פספסנו אותך. אשמח לעזור לך לתכנן – לאיזה תאריך ולכמה אורחים בערך מדובר?', example: { body_text: [['דנה', 'The Gutman']] } },
            { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'אשמח לפרטים' }, { type: 'QUICK_REPLY', text: 'שיחזרו אליי בטלפון' }, { type: 'QUICK_REPLY', text: 'כבר לא רלוונטי' }] }] }) });
        const j = await r.json().catch(() => ({}));
        const ok = r.ok || /already exists|duplicate/i.test(JSON.stringify(j.error || {}));
        if (ok) await ar.set({ warmTplMade: Date.now() }, { merge: true });
        console.log('::notice title=warm template::' + (r.ok ? 'created, status ' + (j.status || '?') : ok ? 'already exists' : 'failed: ' + String(((j.error || {}).message) || r.status).slice(0, 150)));
      }
    } catch (e) { console.log('::notice title=warm template::error ' + String(e.message).slice(0, 120)); }
    // Recruiting agent's opening template (owner, Nov 18): fixed "סבן קולקשן", only {{1}} = first name; Utility, create once
    try {
      const W = (await db.doc('wacfg/main').get()).data() || {}, ar = db.doc('waauto/main'), A = (await ar.get()).data() || {};
      if (W.token && W.wabaId && !A.recruitTplMade) {
        const r = await fetch('https://graph.facebook.com/v23.0/' + W.wabaId + '/message_templates', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + W.token },
          body: JSON.stringify({ name: 'job_screening_start', language: 'he', category: 'UTILITY', components: [
            { type: 'BODY', text: 'היי {{1}}, תודה שהשארת פרטים לעבודה בסבן קולקשן! אני העוזרת הדיגיטלית של צוות הגיוס. אפשר לשאול אותך כמה שאלות קצרות כאן בוואטסאפ?', example: { body_text: [['דנה']] } }] }) });
        const j = await r.json().catch(() => ({}));
        const ok = r.ok || /already exists|duplicate/i.test(JSON.stringify(j.error || {}));
        if (ok) await ar.set({ recruitTplMade: Date.now() }, { merge: true });
        console.log('::notice title=recruit template::' + (r.ok ? 'created, status ' + (j.status || '?') : ok ? 'already exists' : 'failed: ' + String(((j.error || {}).message) || r.status).slice(0, 150)));
      }
    } catch (e) { console.log('::notice title=recruit template::error ' + String(e.message).slice(0, 120)); }
    // Nov 18 (owner approved): delete the pending job_screening_start, submit job_screening_open (no "digital assistant" line), point agentcfg/recruit at it — once
    try {
      const W = (await db.doc('wacfg/main').get()).data() || {}, ar = db.doc('waauto/main'), A = (await ar.get()).data() || {};
      if (W.token && W.wabaId && !A.recruitTpl2Made) {
        const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + W.token }, base = 'https://graph.facebook.com/v23.0/' + W.wabaId + '/message_templates';
        const dr = await fetch(base + '?name=job_screening_start', { method: 'DELETE', headers: H }); const dj = await dr.json().catch(() => ({}));
        console.log('::notice title=recruit template v1::' + (dr.ok ? 'deleted' : 'delete failed: ' + String(((dj.error || {}).message) || dr.status).slice(0, 150)));
        const r = await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ name: 'job_screening_open', language: 'he', category: 'UTILITY', components: [
          { type: 'BODY', text: 'היי {{1}}, תודה שהשארת פרטים לעבודה בסבן קולקשן! אפשר לשאול אותך כמה שאלות קצרות כאן בוואטסאפ?', example: { body_text: [['דנה']] } }] }) });
        const j = await r.json().catch(() => ({}));
        const ok = r.ok || /already exists|duplicate/i.test(JSON.stringify(j.error || {}));
        if (ok) { await ar.set({ recruitTpl2Made: Date.now() }, { merge: true }); await db.doc('agentcfg/recruit').set({ openTemplate: { tpl: 'job_screening_open', lang: 'he' } }, { merge: true }); }
        console.log('::notice title=recruit template v2::' + (r.ok ? 'created, status ' + (j.status || '?') : ok ? 'already exists' : 'failed: ' + String(((j.error || {}).message) || r.status).slice(0, 150)));
      }
    } catch (e) { console.log('::notice title=recruit template v2::error ' + String(e.message).slice(0, 120)); }
    // Nov 18 (owner): the recruiting agent is called Ariel — once
    { const r = db.doc('agentcfg/recruit'), d = (await r.get()).data() || {}; if (!d.nameNov18) await r.set({ name: 'אריאל', nameNov18: Date.now() }, { merge: true }); }
    { const r = db.doc('agentcfg/recruit'), d = (await r.get()).data() || {}; if (!d.openTemplate) await r.set({ openTemplate: { tpl: 'job_screening_open', lang: 'he' }, otRestored: Date.now() }, { merge: true }); } // Nov 22: the field had disappeared from the doc → no opening messages
    { const r = db.doc('agentcfg/recruit'), d = (await r.get()).data() || {}; if (!d.onNov18) await r.set({ enabled: true, onNov18: Date.now() }, { merge: true }); } // owner Nov 18: Ariel starts answering job leads
    // Guy, the yield agent (Nov 12, owner asked to turn it on): create agentcfg/yield enabled, ONLY when missing
    const yr = db.doc('agentcfg/yield');
    if (!(await yr.get()).exists) { await yr.set({ enabled: true, name: 'גיא', createdAt: Date.now(), createdBy: 'setup' }); console.log('::notice title=Guy::agentcfg/yield created (on)'); }
    // Nov 13 (owner): the campaigns agent is now Adi (Aliana = the operations manager) → rename the notes she learned from the social group
    { const q = await db.collection('adNotes').where('by', '==', 'aliana').get(); const b = db.batch(); let n = 0; q.forEach((d) => { if (d.data().byName !== 'עדי · מקבוצת הסושיאל') { b.update(d.ref, { byName: 'עדי · מקבוצת הסושיאל' }); n++; } }); if (n) { await b.commit(); console.log('::notice title=Adi::renamed ' + n + ' notes'); } }
    // operations manager (Nov 13, owner's settings; reports only until push is turned on): create ONLY when missing
    const oc = db.doc('agentcfg/ops');
    if (!(await oc.get()).exists) { await oc.set({ enabled: true, push: false, hkTarget: 14, ratios: { default: { dining: { bf: 50, dn: 50 }, kitchen: { covers: 180 }, dishwash: { perMeal: 1 }, reception: { upTo: 40, low: 1, high: 2 } } }, createdAt: Date.now(), createdBy: 'setup' }); console.log('::notice title=Ops::agentcfg/ops created (on, push off)'); }
    const ok = db.doc('agentKB/ops');
    if (!(await ok.get()).exists) { const t = require('fs').readFileSync(require('path').join(__dirname, 'kb', 'ops.md'), 'utf8').trim(); await ok.set({ text: t, updatedAt: Date.now(), updatedBy: 'setup', updatedByName: 'תשובות הבעלים 12.11' }); console.log('::notice title=Ops::agentKB/ops created, ' + t.length + ' chars'); }
  } catch (e) { console.log('::warning title=Adam seed::' + String(e.message || e).slice(0, 200)); }
  const [all, pub] = await Promise.all([db.collection('shiftReports').get(), db.collection('shiftReportsPub').get()]);
  const have = new Set(pub.docs.map((d) => d.id));
  let n = 0, b = db.batch();
  for (const d of all.docs) {
    if (have.has(d.id)) continue;
    const r = d.data(), o = {};
    for (const k of KEYS) if (r[k] !== undefined) o[k] = r[k];
    b.set(db.doc('shiftReportsPub/' + d.id), o);
    if (++n % 400 === 0) { await b.commit(); b = db.batch(); }
  }
  if (n % 400) await b.commit();
  console.log('shift reports:', all.size, 'copied now:', n);
  console.log('::notice title=Backfill::shift reports ' + all.size + ', copied ' + n);
  // groups without prices for reception (groupsPub); rewrites every time (idempotent)
  const { grpPubDoc } = require('./grppub.js');
  const gs = await db.collection('groups').get(); let gb = db.batch(), gn = 0;
  for (const d of gs.docs) { gb.set(db.doc('groupsPub/' + d.id), grpPubDoc(d.data() || {})); if (++gn % 400 === 0) { await gb.commit(); gb = db.batch(); } }
  if (gn % 400) await gb.commit();
  console.log('::notice title=Backfill::groupsPub ' + gn);
  // hotel separation: venue on waChats / tasks (from their lead) and clients (lead with the same phone)
  const leads = await db.collection('leads').get(), lv = {}, byTel = {};
  leads.docs.forEach((d) => { const l = d.data() || {}; lv[d.id] = String(l.venue || ''); const t = String(l.phone || '').replace(/\D/g, ''); if (t && l.venue && !byTel[t]) byTel[t] = l.venue; });
  let vn = 0;
  for (const col of ['waChats', 'tasks']) {
    const q = await db.collection(col).get();
    for (const d of q.docs) { const x = d.data() || {}; const v = x.leadId && lv[x.leadId] !== undefined ? lv[x.leadId] : (x.venue === undefined ? '' : null); if (v !== null && (x.venue === undefined || x.venue !== v)) { await d.ref.set({ venue: v }, { merge: true }); vn++; } }
  }
  const cq = await db.collection('clients').get();
  for (const d of cq.docs) { const x = d.data() || {}; if (x.venue !== undefined) continue; const k = String(d.id).replace(/\D/g, ''); await d.ref.set({ venue: byTel[k] || '' }, { merge: true }); vn++; }
  console.log('::notice title=Backfill::venue set on ' + vn + ' docs');
  // WhatsApp chat ownership (Nov 8): every chat needs an agent field ('' = free)
  const wcs = await db.collection('waChats').get(); let an = 0;
  for (const d of wcs.docs) if ((d.data() || {}).agent === undefined) { await d.ref.update({ agent: '' }); an++; }
  { let ln = 0; for (const d of wcs.docs) { const x = d.data() || {}; if (!x.lastAt) { await d.ref.update({ lastAt: x.createdAt || Date.now() }); ln++; } } if (ln) console.log('::notice title=Backfill::lastAt added to ' + ln + ' WhatsApp chats'); }
  console.log('::notice title=Backfill::waChats ' + wcs.size + ', agent set on ' + an);
  // social media spend per hotel: hotelAuto on every campaign report (idempotent)
  const CH = require('./camphotel.js'), CX = await CH.campCtx(db), cps = await db.collection('campaigns').get(); let cn = 0, cu = 0;
  for (const d of cps.docs) { const c = d.data() || {}, h = CH.campHotelOf(c, CX); if (h) cn++; if (c.hotelAuto !== h) { await d.ref.update({ hotelAuto: h }); cu++; } }
  console.log('::notice title=Backfill::campaigns ' + cps.size + ', with hotel ' + cn + ', updated ' + cu);
  // Arsona guest requests with no hotel (Nov 17): find the hotel name anywhere in the text (same order as index.js arsHotel)
  { const A = [[/seas|סיז|blueberry|בלובר/, 'sevenseas'], [/gutman|גוטמן|boheme/, 'boheme'], [/hostel|הוסטל|180|קפסול/, 'hostel'], [/7even|seven|סבן|beach|sola/, 'sola']];
    const hs = await db.collection('hotels').get(), st = await db.collection('settings').get(), byVen = {};
    st.forEach((d) => (d.data().venues || []).forEach((v) => { if (!byVen[v]) byVen[v] = d.id; }));
    const pick = (txt) => { const s = String(txt || '').replace(/\d{3,}/g, ' ').toLowerCase(); for (const [re, ven] of A) if (re.test(s)) { const d = hs.docs.find((x) => re.test(String(x.data().name || '').toLowerCase())); if (d) return d.id; if (byVen[ven]) return byVen[ven]; } return ''; };
    const gq = await db.collection('guestReqs').where('hotel', '==', '').get(); let gn2 = 0;
    for (const d of gq.docs) { const x = d.data() || {}, h = pick([x.raw, x.summary, x.hotelTxt].join(' ')); if (h) { await d.ref.update({ hotel: h }); gn2++; } }
    console.log('::notice title=Backfill::guest requests without hotel ' + gq.size + ', fixed ' + gn2);
    // Arsona e-mails saved as a general card before the mail layout was known (Nov 17): re-read them with the mail parser
    const { arsMailParse } = require('./arsmail.js'); const T = { 'request for agent': 'agent', 'agent required': 'agent', 'potential lead': 'lead', 'missing information': 'missing' };
    const mq = await db.collection('guestReqs').where('kind', '==', 'מייל מארסונה').get(); let mn = 0;
    for (const d of mq.docs) { const x = d.data() || {}, p = arsMailParse(x.raw); if (!p) continue;
      await d.ref.update({ type: T[p.key] || 'agent', kind: p.typeTxt, hotelTxt: p.hotelTxt, guest: p.guest, conf: p.conf, room: p.room, channel: p.channel || 'מייל', when: p.when, summary: p.summary, src: 'mail', hotel: x.hotel || (p.hotelTxt && pick(p.hotelTxt)) || pick(x.raw) }); mn++; }
    console.log('::notice title=Backfill::Arsona mails re-read ' + mn + ' of ' + mq.size); }
  // hiring leads (Nov 18): every lead needs a `cat` field (clients now list leads with where('cat','in',…) / cat == 'jobs');
  // leads without one get 'jobs' when their kind is jobs (same words as index.js leadKind), else ''. Prints counts only.
  { const JOBS_RE = /גיוס|דרוש|דרושים|משרה|משרות|קורות חיים|הגשת מועמדות|לעבוד אצלנו|job|jobs|hiring|career|recruit/i;
    const cc = ((await db.doc('leadcats/main').get()).data() || {}).campCat || {};
    const lq = await db.collection('leads').get(); let nc = 0, nj = 0, b = db.batch(), bn = 0;
    for (const d of lq.docs) { const l = d.data() || {}; if (typeof l.cat === 'string') continue;
      const mapped = cc[String(l.campaign || '').trim()] || '', isJ = mapped ? mapped === 'jobs' : (JOBS_RE.test(String(l.campaign || '')) || (!/כלה|כלות|ספא|spa|חדר|room|לינה/i.test(String(l.campaign || '')) && JOBS_RE.test([l.type, l.notes].join(' '))));
      b.set(d.ref, isJ ? { cat: 'jobs', jobHotel: l.jobHotel || '', job: l.job || '' } : { cat: '' }, { merge: true }); nc++; if (isJ) nj++;
      if (++bn >= 400) { await b.commit(); b = db.batch(); bn = 0; } }
    if (bn) await b.commit();
    console.log('::notice title=Backfill::leads without cat ' + nc + ' (set to jobs: ' + nj + ') of ' + lq.size); }
  // leads app split from events (owner, Nov 19): everyone who has apps.events (roles, their personal extras, job roles) also gets apps.leads,
  // so nobody loses the leads page; the owner then removes it from whoever doesn't need it. Runs once (marker migrations/leadsNov19). Counts only.
  { const mk = db.doc('migrations/leadsNov19');
    if (!(await mk.get()).exists) { let nr = 0, nj = 0;
      for (const d of (await db.collection('roles').get()).docs) { const r = d.data() || {}, a = r.apps || {}, x = r.extra || {}, up = {};
        if (a.events === true && a.leads !== true) up['apps.leads'] = true;
        if (x && typeof x === 'object' && x.events === true && x.leads !== true) up['extra.leads'] = true;
        if (Object.keys(up).length) { await d.ref.update(up); nr++; } }
      for (const d of (await db.collection('jobRoles').get()).docs) { const a = (d.data() || {}).apps || {}; if (a.events === true && a.leads !== true) { await d.ref.update({ 'apps.leads': true }); nj++; } }
      await mk.set({ at: Date.now(), roles: nr, jobRoles: nj });
      console.log('::notice title=Backfill::leads app added to ' + nr + ' roles and ' + nj + ' job roles'); } }
  // owner, Nov 19: no staff private number in the agents' knowledge — the events department line 053-3965323 instead (counts only).
  { let n = 0; for (const id of ['reply', 'hila']) { const r = db.doc('agentKB/' + id), d = (await r.get()).data() || {}, t = String(d.text || '');
      const t2 = t.replace(/0?5\d[\s-]?\d{3}[\s-]?\d{4}/g, (m) => { const x = m.replace(/\D/g, ''); return x === '0533965323' ? m : '053-3965323'; });
      if (t2 !== t) { await r.set({ text: t2, updatedAt: Date.now(), updatedBy: 'phone-scrub' }, { merge: true }); n++; } }
    if (n) console.log('::notice title=Backfill::private phone numbers replaced in ' + n + ' agent knowledge docs'); }
  // Owner, Nov 20: "נדרש נציג" label — candidates Ariel already finished as qualified, with no person answering since, get needHuman. Once. Counts only.
  { const mk = db.doc('migrations/needHumanNov20');
    if (!(await mk.get()).exists) { let n = 0;
      const cs = await db.collection('candidates').where('status', '==', 'qualified').get();
      for (const d of cs.docs) { const c = d.data() || {}, t = +c.finishedAt || 0; if (!t || !c.chat) continue;
        const ch = db.doc('waChats/' + c.chat), cx = await ch.get(); if (!cx.exists || (cx.data() || {}).needHuman) continue;
        const ms = await ch.collection('msgs').where('at', '>', t).get();
        if (ms.docs.some((m) => { const x = m.data() || {}; return x.dir === 'out' && /^[A-Za-z0-9]{20,40}$/.test(String(x.by || '')); })) continue;
        await ch.set({ needHuman: t, needHumanBy: 'אריאל', needHumanWhy: 'סיימה סינון · מועמד/ת מתאים/ה' }, { merge: true }); n++; }
      await mk.set({ at: Date.now(), n }); console.log('::notice::needHuman backfill ' + n); } }

  // owner, Nov 19 (after the split): take the leads app away from EVERYONE (roles, personal extras, job roles); the owner then gives it
  // to the people who need it from the permissions page. Runs once (marker migrations/leadsOffNov19). Counts only.
  { const mk = db.doc('migrations/leadsOffNov19');
    if (!(await mk.get()).exists) { let nr = 0, nj = 0; const del = admin.firestore.FieldValue.delete();
      for (const d of (await db.collection('roles').get()).docs) { const r = d.data() || {}, up = {};
        if ((r.apps || {}).leads) up['apps.leads'] = del; if ((r.extra || {}).leads) up['extra.leads'] = del;
        if (Object.keys(up).length) { await d.ref.update(up); nr++; } }
      for (const d of (await db.collection('jobRoles').get()).docs) if (((d.data() || {}).apps || {}).leads) { await d.ref.update({ 'apps.leads': del }); nj++; }
      await mk.set({ at: Date.now(), roles: nr, jobRoles: nj });
      console.log('::notice title=Backfill::leads app removed from ' + nr + ' roles and ' + nj + ' job roles'); } }

  // Optima Agent (Nov 27, owner): one random key per hotel, created ONCE when missing (never printed: the repo and its logs are public).
  // The owner copies a hotel's key from Firebase Console → Firestore → optimacfg → main into the agent's keys folder.
  { const ref = db.doc('optimacfg/main'), cs = await ref.get(), keys = { ...((cs.exists && cs.data().keys) || {}) }; let n = 0;
    for (const h of ['sola', 'boheme', 'sevenseas', 'hostel']) if (!(String(keys[h] || '').length >= 24)) { keys[h] = require('crypto').randomBytes(24).toString('hex'); n++; }
    if (n || !cs.exists) { await ref.set({ ...(cs.exists ? {} : { on: true, createdAt: Date.now() }), keys }, { merge: true }); console.log('::notice title=Optima::' + n + ' hotel keys created'); } }
})().catch((e) => { console.error(e); console.log('::error title=Backfill failed::' + String(e && e.message || e).slice(0, 300)); process.exit(1); });
