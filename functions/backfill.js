// One-off/idempotent: copy shift reports that have no money-free copy yet into shiftReportsPub.
// Runs from the deploy workflow after the functions deploy (service-account credentials).
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const KEYS = ['hotel', 'month', 'date', 'shift', 'name', 'empUid', 'ooo', 'faults', 'lost', 'cmp', 'booking', 'ciLeft', 'coLeft', 'ci', 'co', 'cid', 'unusual', 'details', 'createdAt', 'by'];
(async () => {
  // Adam, the events reply agent (Nov 9, owner): create its settings OFF and its first knowledge text, ONLY when missing (never overwrites)
  try {
    const cr = db.doc('agentcfg/reply');
    if (!(await cr.get()).exists) { await cr.set({ enabled: false, name: 'אדם', mode: 'draft', scope: ['events'], createdAt: Date.now(), createdBy: 'setup' }); console.log('::notice title=Adam::agentcfg/reply created (off, draft)'); }
    const kr = db.doc('agentKB/reply');
    if (!(await kr.get()).exists) { const t = require('fs').readFileSync(require('path').join(__dirname, 'kb', 'reply-seed.md'), 'utf8').trim(); await kr.set({ text: t, updatedAt: Date.now(), updatedBy: 'setup', updatedByName: 'הזנה ראשונה' }); console.log('::notice title=Adam::agentKB/reply created, ' + t.length + ' chars'); }
    // Guy, the yield agent (Nov 12, owner asked to turn it on): create agentcfg/yield enabled, ONLY when missing
    const yr = db.doc('agentcfg/yield');
    if (!(await yr.get()).exists) { await yr.set({ enabled: true, name: 'גיא', createdAt: Date.now(), createdBy: 'setup' }); console.log('::notice title=Guy::agentcfg/yield created (on)'); }
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
  console.log('::notice title=Backfill::waChats ' + wcs.size + ', agent set on ' + an);
  // social media spend per hotel: hotelAuto on every campaign report (idempotent)
  const CH = require('./camphotel.js'), CX = await CH.campCtx(db), cps = await db.collection('campaigns').get(); let cn = 0, cu = 0;
  for (const d of cps.docs) { const c = d.data() || {}, h = CH.campHotelOf(c, CX); if (h) cn++; if (c.hotelAuto !== h) { await d.ref.update({ hotelAuto: h }); cu++; } }
  console.log('::notice title=Backfill::campaigns ' + cps.size + ', with hotel ' + cn + ', updated ' + cu);
})().catch((e) => { console.error(e); console.log('::error title=Backfill failed::' + String(e && e.message || e).slice(0, 300)); process.exit(1); });
