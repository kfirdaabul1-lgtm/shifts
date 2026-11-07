// weekly FX rates (owner, Nov 7): Bank of Israel representative rate of the week's first business day → fxRates/{weekStart}
// foreign-currency groups are valued per night at the rate of the week the night falls in (index.html fxRate / grpMonthShare)
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const ilDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const isoAdd = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekOfISO = (iso) => isoAdd(iso, -new Date(iso + 'T12:00:00Z').getUTCDay());
const BOI = 'https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS,RER_EUR_ILS?format=csv';
function csvRow(ln) { const out = []; let cur = '', q = false; for (const ch of ln) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; }
async function boiRates(from, to) {
  const r = await fetch(BOI + '&startperiod=' + from + '&endperiod=' + to);
  if (!r.ok) throw new Error('BOI HTTP ' + r.status);
  const lines = (await r.text()).trim().split(/\r?\n/), head = csvRow(lines.shift()).map((s) => s.toUpperCase());
  const iS = head.indexOf('SERIES_CODE'), iT = head.indexOf('TIME_PERIOD'), iV = head.indexOf('OBS_VALUE');
  if (iS < 0 || iT < 0 || iV < 0) throw new Error('BOI CSV columns changed: ' + head.join('|').slice(0, 300));
  const out = {}; // out[date] = {usd, eur}
  for (const ln of lines) { const c = csvRow(ln), v = +c[iV]; if (!(v > 0)) continue;
    const k = /USD/.test(c[iS]) ? 'usd' : /EUR/.test(c[iS]) ? 'eur' : ''; if (k) (out[c[iT]] = out[c[iT]] || {})[k] = v; }
  return out;
}
// fills every week from `fromIso` (default 4 weeks back) to this week; weeks already saved (or fixed by hand, manual:true) are never overwritten
async function fxSync(fromIso) {
  const today = ilDate(new Date()), from = weekOfISO(fromIso || isoAdd(today, -28)), rates = await boiRates(isoAdd(from, -1), today), days = Object.keys(rates).sort(), done = [];
  for (let w = from; w <= weekOfISO(today); w = isoAdd(w, 7)) {
    const d = days.find((x) => x >= w && rates[x].usd); if (!d || d > isoAdd(w, 6)) continue; // no rate published yet this week
    const ref = db.doc('fxRates/' + w), s = await ref.get(); if (s.exists && (s.data().usd || s.data().manual)) continue;
    await ref.set({ week: w, rateDate: d, usd: rates[d].usd || null, eur: rates[d].eur || null, src: 'boi', at: Date.now() }); done.push({ week: w, date: d, usd: rates[d].usd || null, eur: rates[d].eur || null });
  }
  return done;
}
module.exports = { fxSync, boiRates };
