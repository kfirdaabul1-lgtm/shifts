// Google Ads (owner, Nov 11): campaign numbers → campaigns/google_<campaignId>_<week>, READ ONLY.
// gadscfg/main (owner only in rules) {loginId (MCC, 10 digits), clientId, clientSecret, refreshToken,
//   customers ('' = every enabled client account under the MCC, else "1234567890,…"), venues {customerId: venue} (optional),
//   devToken (optional, no longer required since Sept 2026), syncReq, status}
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const db = admin.firestore();
const REGION = 'europe-west1';
const VER = 'v26'; // latest Google Ads API major version (Nov 2026); bump when Google sunsets it
const ilDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const isoAdd = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekOf = (iso) => isoAdd(iso, -new Date(iso + 'T12:00:00Z').getUTCDay());
const dig = (s) => String(s || '').replace(/\D/g, '');

async function accessToken(c) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('ההתחברות לגוגל נכשלה: ' + (j.error_description || j.error || r.status));
  return j.access_token;
}
async function gaql(c, at, cid, query) {
  const r = await fetch(`https://googleads.googleapis.com/${VER}/customers/${dig(cid)}/googleAds:searchStream`, {
    method: 'POST', body: JSON.stringify({ query }),
    headers: { Authorization: 'Bearer ' + at, 'login-customer-id': dig(c.loginId), 'Content-Type': 'application/json', ...(c.devToken ? { 'developer-token': c.devToken } : {}) } });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = (Array.isArray(j) ? j[0] : j) || {}, er = e.error || {}, det = ((((er.details || [])[0] || {}).errors) || [])[0] || {};
    throw new Error(String(det.message || er.message || ('HTTP ' + r.status)).slice(0, 300));
  }
  return (Array.isArray(j) ? j : [j]).flatMap((x) => (x && x.results) || []);
}
async function accountsOf(c, at) {
  const fixed = String(c.customers || '').split(',').map(dig).filter((x) => x.length === 10);
  if (fixed.length) return fixed.map((id) => ({ id, name: '' }));
  const rows = await gaql(c, at, c.loginId, 'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level <= 1');
  return rows.map((r) => r.customerClient || {}).filter((x) => !x.manager && x.status === 'ENABLED').map((x) => ({ id: dig(x.id), name: x.descriptiveName || '' }));
}
// keywords + search terms per campaign per week (owner, Nov 13) → gadsTerms/{campaignId}_{week} {campaignId, week, kw:[{t,m,i,c,s,v}], st:[{t,i,c,s,v}], at}
// top 150 rows by cost of each list; read only (Google hides low-volume search terms, so totals can be below the campaign's)
async function gadsTerms(c, at, cid, since, until) {
  const per = {}, add = (k, list, key, row) => { const x = per[k] = per[k] || { kw: {}, st: {} }, y = x[list][key] = x[list][key] || { ...row, i: 0, c: 0, s: 0, v: 0 }; return y; };
  const put = (y, m) => { y.i += +m.impressions || 0; y.c += +m.clicks || 0; y.s += (+m.costMicros || 0) / 1e6; y.v += +m.conversions || 0; };
  const kw = await gaql(c, at, cid, `SELECT campaign.id, segments.date, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM keyword_view WHERE segments.date BETWEEN '${since}' AND '${until}' AND metrics.impressions > 0`);
  for (const r of kw) { const k = (r.adGroupCriterion || {}).keyword || {}, t = String(k.text || '').slice(0, 120); if (!t) continue; put(add(r.campaign.id + '_' + weekOf(r.segments.date), 'kw', t + '|' + (k.matchType || ''), { t, m: k.matchType || '' }), r.metrics || {}); }
  const st = await gaql(c, at, cid, `SELECT campaign.id, segments.date, search_term_view.search_term, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE segments.date BETWEEN '${since}' AND '${until}' AND metrics.impressions > 0`);
  for (const r of st) { const t = String((r.searchTermView || {}).searchTerm || '').slice(0, 120); if (!t) continue; put(add(r.campaign.id + '_' + weekOf(r.segments.date), 'st', t, { t }), r.metrics || {}); }
  const top = (o) => Object.values(o).map((y) => ({ ...y, s: Math.round(y.s * 100) / 100, v: Math.round(y.v * 10) / 10 })).sort((a, b) => b.s - a.s || b.c - a.c).slice(0, 150);
  const list = Object.entries(per);
  for (let i = 0; i < list.length; i += 400) {
    const b = db.batch();
    for (const [k, x] of list.slice(i, i + 400)) { const [id, week] = k.split('_'); b.set(db.doc('gadsTerms/' + k), { campaignId: id, week, kw: top(x.kw), st: top(x.st), at: Date.now() }); }
    await b.commit();
  }
  return list.length;
}

async function gadsRun() {
  const ref = db.doc('gadscfg/main'), s = await ref.get(); if (!s.exists) return null;
  const c = s.data() || {};
  if (!c.refreshToken || !c.clientId || !c.clientSecret || dig(c.loginId).length !== 10) return null;
  const st = { at: Date.now(), ok: false, err: '', accounts: [], campaigns: 0, reports: 0 }, errs = [];
  try {
    const at = await accessToken(c), accs = await accountsOf(c, at);
    if (!accs.length) throw new Error('אין חשבונות מודעות מקושרים לחשבון המנהל (או שהקישור עוד לא אושר)');
    const until = ilDate(new Date()), since = weekOf(isoAdd(until, -35)), by = {};
    for (const a of accs) {
      try {
        const rows = await gaql(c, at, a.id, `SELECT customer.descriptive_name, campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}' AND metrics.impressions > 0`);
        const nm = a.name || (rows[0] && rows[0].customer && rows[0].customer.descriptiveName) || a.id;
        st.accounts.push(nm);
        for (const r of rows) {
          const cp = r.campaign || {}, m = r.metrics || {}, w = weekOf(r.segments.date), k = cp.id + '_' + w;
          const x = by[k] = by[k] || { name: cp.name || '', id: String(cp.id), cust: a.id, custName: nm, week: w, spend: 0, impressions: 0, clicks: 0, conv: 0 };
          x.name = cp.name || x.name; x.spend += (+m.costMicros || 0) / 1e6; x.impressions += +m.impressions || 0; x.clicks += +m.clicks || 0; x.conv += +m.conversions || 0;
        }
        try { st.terms = (st.terms || 0) + await gadsTerms(c, at, a.id, since, until); } catch (e) { errs.push(a.id + ' (מילים): ' + e.message); }
      } catch (e) { errs.push(a.id + ': ' + e.message); }
    }
    const list = Object.entries(by); let n = 0;
    for (let i = 0; i < list.length; i += 400) {
      const b = db.batch();
      for (const [k, x] of list.slice(i, i + 400)) {
        b.set(db.doc('campaigns/google_' + k), { name: x.name, platform: 'google', target: 'Google Ads', week: x.week, start: x.week, end: isoAdd(x.week, 6),
          spend: Math.round(x.spend * 100) / 100, leads: Math.round(x.conv), conv: Math.round(x.conv * 100) / 100, msgs: 0, impressions: x.impressions, clicks: x.clicks,
          auto: 'google', gadsId: x.id, gadsCustomer: x.cust, gadsCustomerName: x.custName, venue: ((c.venues || {})[x.cust]) || '', updatedAt: Date.now() }, { merge: true });
        n++;
      }
      await b.commit();
    }
    st.campaigns = new Set(list.map(([, x]) => x.id)).size; st.reports = n;
    st.err = errs.join(' | ').slice(0, 500); st.ok = !errs.length;
  } catch (e) { st.err = String(e.message || e).slice(0, 500); }
  await ref.set({ status: st }, { merge: true });
  return st;
}
exports.gadsRun = gadsRun;
exports.gadsPoll = functions.region(REGION).runWith({ timeoutSeconds: 300 }).pubsub.schedule('every 3 hours').onRun(async () => { await gadsRun(); return null; });
exports.onGadsCfg = functions.region(REGION).runWith({ timeoutSeconds: 300 }).firestore.document('gadscfg/main').onWrite(async (ch) => {
  if (!ch.after.exists) return null;
  const a = ch.before.exists ? ch.before.data() : {}, b = ch.after.data() || {};
  const key = (x) => JSON.stringify([x.loginId, x.clientId, x.clientSecret, x.refreshToken, x.customers, x.devToken, x.syncReq]);
  if (key(a) === key(b)) return null; // our own status write
  await gadsRun(); return null;
});
