// ================= Yield (revenue management) agent "Guy / גיא": a second pair of eyes on the revenue manager and on the price page (owner, Nov 12) =================
// Connected Nov 12 (functions/index.js). Does nothing until agentcfg/yield.enabled === true. READ ONLY: it never changes a price, a rate plan,
// a room or any document of the app.
//
// What it does, per hotel and for the whole chain (same scopes as the ads agent):
//   1. PAGE CHECK  - is the data on the "price comparison" page (ratesLog) fresh, complete and sane? (stale run, missing dates, a source
//                    missing, mismatching room names, outlier prices, zero prices, Genius higher than the original price...)
//   2. PARITY      - is the direct website priced at or below Booking's public price? Is Genius sensible against the website?
//   3. PRICE SHAPE - weekday / weekend / Israeli holiday pattern, flat streaks, jumps, sold-out dates, low-inventory dates,
//                    room-category ladder inversions. All computed in code.
//   4. RM ACTIONS  - what the revenue manager actually DID: compares the same stay date between runs (raised / cut / unchanged),
//                    flags dates that sold out or got tight with no price rise, and big cuts.
//   5. MARKET      - when competitor rows (src 'comp', already accepted by ratesIngest) exist: rate index against the compset per date.
//                    Price-level recommendations are produced ONLY when at least cfg.minComps (default 1) competitor has a price on the date.
//   6. GROUPS      - confirmed / option group blocks in the next 60 days (rooms taken out of public inventory).
//   7. OTB (optional) - if otbLog/{hotel}__{date} snapshots exist (rooms sold / revenue per stay date, from the PMS) it adds occupancy, ADR,
//                    RevPAR and pickup. Nothing writes otbLog yet: without it the agent says plainly that it cannot see occupancy.
// It writes one report per scope into yieldReports/{kind}_{scopeKey}_{date|weekStart}; the model only explains numbers the code computed.
//
// Schedules: daily 08:00 (skipped when nothing changed, and on Sunday), weekly Sunday 09:00 (Asia/Jerusalem). Owner-only POST yieldRunNow {kind, force}.
// yieldJob: yieldJobs/{id} {kind} created by an admin script runs runAll inside the function (it has the Claude key) and writes the result ids back.
const functions = require('firebase-functions/v1');
const crypto = require('crypto');
const C = require('./agent-common');
const { db } = C;
const REGION = 'europe-west1';
const SMART = 'claude-sonnet-5-5';
const DEFAULTS = { enabled: false, daily: true, weekly: true, model: '', horizon: 14, staleDays: 4, outlierHi: 1.6, outlierLo: 0.55, parityTol: 0.02, breakfastValue: 0, minComps: 1, jumpPct: 25, flatDays: 6, bigCutPct: 10, keepDailyDays: 45, skipMaxDays: 3, historyDays: 30, groupDays: 60 };

// ---------- small helpers ----------
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const num = (v) => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : null);
const r1 = (x) => Math.round(x * 10) / 10;
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = (a) => { const s = a.filter((x) => x != null); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
const minOf = (a) => { const s = a.filter((x) => x != null); return s.length ? Math.min(...s) : null; };
const pct = (a, b) => (a == null || b == null || !b ? null : r1(((a - b) / b) * 100));
const dowOf = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const DOW_HE = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9֐-׿]+/g, '');

// Israeli calendar: Shabbat is from the weekday; Jewish holidays from the Hebrew calendar built into Node (no table to maintain).
// Gregorian dates that matter (Christmas, summer, school holidays) are NOT guessed: the owner lists them in the knowledge base.
function holiday(iso) {
  let parts; try { parts = new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'UTC', month: 'long', day: 'numeric' }).formatToParts(new Date(iso + 'T12:00:00Z')); } catch (e) { return ''; }
  const m = (parts.find((p) => p.type === 'month') || {}).value || '', d = +(parts.find((p) => p.type === 'day') || {}).value || 0;
  if (m === 'Tishri') return d <= 2 ? 'ראש השנה' : d === 10 ? 'יום כיפור' : d >= 15 && d <= 21 ? 'סוכות' : d === 22 ? 'שמחת תורה' : '';
  if (m === 'Nisan') return d >= 15 && d <= 21 ? 'פסח' : '';
  if (m === 'Sivan') return d === 6 ? 'שבועות' : '';
  if (m === 'Adar' || m === 'Adar II') return d === 14 ? 'פורים' : '';
  if (m === 'Kislev') return d >= 25 ? 'חנוכה' : '';
  if (m === 'Tevet') return d <= 2 ? 'חנוכה' : '';
  return '';
}

// ---------- data ----------
async function loadHotels() { const s = await db.collection('hotels').get(); return s.docs.map((d) => ({ id: d.id, name: (d.data() || {}).name || d.id })); }
async function loadRuns(hotel, today, days) { // fixed document ids ratesLog/{hotel}__{date}: no index needed
  const ids = []; for (let i = 0; i <= days; i++) ids.push(hotel + '__' + C.addDays(today, -i));
  const snaps = await Promise.all(ids.map((id) => db.doc('ratesLog/' + id).get()));
  return snaps.filter((s) => s.exists).map((s) => s.data()).filter((r) => r && Array.isArray(r.rows)).sort((a, b) => String(a.runDate).localeCompare(String(b.runDate)));
}
const rowsOf = (run) => (run.rows || []).map((r) => ({ src: r.src, ci: String(r.checkin || ''), room: String(r.room || ''), comp: String(r.comp || ''), orig: num(r.orig), price: num(r.price), bf: !!r.bf, left: num(r.left) })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.ci));
async function loadGroups(hotel, today, cfg) {
  const to = C.addDays(today, cfg.groupDays), s = await db.collection('groups').get(), out = {};
  for (const d of s.docs) {
    const g = d.data() || {}; if (g.hotel !== hotel || !['confirmed', 'option'].includes(g.status || '') || !g.ci) continue;
    const co = g.co && g.co > g.ci ? g.co : C.addDays(g.ci, 1), rooms = +g.rooms || Math.ceil((+g.pax || 0) / (+g.ppr || 2));
    for (let x = g.ci < today ? today : g.ci; x < co && x <= to; x = C.addDays(x, 1)) { const o = out[x] || (out[x] = { rooms: 0, groups: [] }); o.rooms += rooms; o.groups.push(clip(g.name, 40) + (g.status === 'option' ? ' (אופציה)' : '')); }
  }
  return Object.entries(out).sort().map(([date, v]) => ({ date, dow: DOW_HE[dowOf(date)], rooms: v.rooms, groups: v.groups.slice(0, 4) }));
}
async function loadOtb(hotel, today) { // optional PMS snapshots otbLog/{hotel}__{runDate}: {rooms, rows:[{date, sold, rev, lySold?, lyRev?}]}
  const snaps = await Promise.all(Array.from({ length: 15 }, (_, i) => db.doc('otbLog/' + hotel + '__' + C.addDays(today, -i)).get()));
  const L = snaps.filter((s) => s.exists).map((s) => s.data()); if (!L.length) return null;
  const cur = L[0], prev = L.find((x) => daysBetween(x.runDate, cur.runDate) >= 6) || L[L.length - 1];
  const P = Object.fromEntries((prev.rows || []).map((r) => [r.date, r])), rooms = +cur.rooms || 0;
  return { runDate: cur.runDate, prevRunDate: prev !== cur ? prev.runDate : '', rooms, dates: (cur.rows || []).slice(0, 60).map((r) => {
    const sold = num(r.sold), rev = num(r.rev), p = P[r.date] && prev !== cur ? num(P[r.date].sold) : null;
    return { date: r.date, sold, occ: rooms && sold != null ? r1((sold / rooms) * 100) : null, adr: sold ? Math.round(rev / sold) : null, revpar: rooms && rev != null ? Math.round(rev / rooms) : null, pickup: sold != null && p != null ? sold - p : null, lySold: num(r.lySold) }; }) };
}

// ---------- the metrics (all numbers come from here, not from the model) ----------
function perDate(rows) { // cheapest per source for each stay date
  const by = {};
  for (const r of rows) {
    if (r.src === 'comp') continue;
    const o = by[r.ci] || (by[r.ci] = { ci: r.ci, rows: 0, sold: true, site: null, siteBf: null, gen: null, genBf: null, orig: null, left: null });
    o.rows++;
    if (r.price != null) {
      o.sold = false;
      if (r.src === 'site' && (o.site == null || r.price < o.site)) { o.site = r.price; o.siteBf = r.bf; }
      if (r.src === 'booking') { if (o.gen == null || r.price < o.gen) { o.gen = r.price; o.genBf = r.bf; } const og = r.orig != null ? r.orig : r.price; if (o.orig == null || og < o.orig) o.orig = og; }
      if (r.left != null && (o.left == null || r.left < o.left)) o.left = r.left;
    }
  }
  return by;
}
function pageCheck(latest, prev, rows, cfg, today) {
  const issues = [], add = (code, severity, text, extra) => issues.push({ code, severity, text, ...(extra || {}) });
  const age = daysBetween(latest.runDate, today);
  if (age > cfg.staleDays) add('stale', age > cfg.staleDays * 2 ? 'high' : 'medium', `הריצה האחרונה של סוכן המחירים היא מלפני ${age} ימים (${latest.runDate})`);
  const dates = [...new Set(rows.map((r) => r.ci))].sort(), want = Array.from({ length: cfg.horizon }, (_, i) => C.addDays(latest.runDate, i)), missing = want.filter((d) => !dates.includes(d));
  if (missing.length) add('missing_dates', missing.length > 3 ? 'high' : 'medium', `חסרים ${missing.length} תאריכים מתוך ${cfg.horizon} בריצה האחרונה`, { dates: missing.slice(0, 10) });
  if (prev) { const a = rowsOf(prev).length; if (a && rows.length < a * 0.7) add('rows_drop', 'medium', `מספר השורות ירד מ-${a} ל-${rows.length} לעומת הריצה הקודמת (${prev.runDate})`); }
  const src = (s) => rows.filter((r) => r.src === s);
  for (const s of ['booking', 'site']) if (!src(s).length) add('no_' + s, 'high', s === 'booking' ? 'אין בכלל נתוני Booking בריצה האחרונה' : 'אין בכלל נתוני אתר הבית בריצה האחרונה');
  const only = []; const pd = perDate(rows.filter((r) => r.src !== 'comp'));
  for (const d of Object.values(pd)) { const b = rows.some((r) => r.ci === d.ci && r.src === 'booking'), s = rows.some((r) => r.ci === d.ci && r.src === 'site'); if (b !== s) only.push(d.ci + (b ? ' (רק Booking)' : ' (רק אתר)')); }
  if (only.length) add('one_source', 'medium', `${only.length} תאריכים עם מקור אחד בלבד`, { dates: only.slice(0, 8) });
  const rb = new Set(src('booking').map((r) => norm(r.room))), rs = new Set(src('site').map((r) => norm(r.room)));
  const onlyB = [...rb].filter((x) => x && !rs.has(x)), onlyS = [...rs].filter((x) => x && !rb.has(x));
  if (rb.size && rs.size && (onlyB.length || onlyS.length)) add('room_names', 'low', 'שמות חדרים שלא מופיעים בשני המקורות, ולכן העמוד לא משווה ביניהם בעמודות החדרים', { booking: src('booking').map((r) => r.room).filter((x, i, a) => onlyB.includes(norm(x)) && a.indexOf(x) === i).slice(0, 6), site: src('site').map((r) => r.room).filter((x, i, a) => onlyS.includes(norm(x)) && a.indexOf(x) === i).slice(0, 6) });
  const zero = rows.filter((r) => r.price === 0); if (zero.length) add('zero_price', 'high', `${zero.length} שורות עם מחיר 0`, { dates: [...new Set(zero.map((r) => r.ci))].slice(0, 6) });
  const gHigh = rows.filter((r) => r.src === 'booking' && r.orig != null && r.price != null && r.price > r.orig); if (gHigh.length) add('genius_over_orig', 'medium', `${gHigh.length} שורות שבהן מחיר Genius גבוה מהמחיר המקורי`, { dates: [...new Set(gHigh.map((r) => r.ci))].slice(0, 6) });
  const dup = {}; let dups = 0; for (const r of rows) { const k = [r.src, r.ci, r.room, r.comp].join('|'); if (dup[k]) dups++; dup[k] = 1; } if (dups) add('duplicates', 'low', `${dups} שורות כפולות (אותו מקור, תאריך וחדר)`);
  const out = [];
  for (const s of ['booking', 'site']) { const by = {}; for (const r of src(s)) if (r.price) (by[r.room] || (by[r.room] = [])).push(r); for (const [room, L] of Object.entries(by)) { const m = median(L.map((r) => r.price)); if (L.length >= 5) for (const r of L) if (r.price > m * cfg.outlierHi || r.price < m * cfg.outlierLo) out.push(`${r.ci} ${s === 'booking' ? 'Booking' : 'אתר'} ${room}: ₪${r.price} (חציון ₪${Math.round(m)})`); } }
  if (out.length) add('outliers', 'medium', `${out.length} מחירים חריגים מאוד לעומת שאר התאריכים של אותו חדר. כדאי לוודא שהקריאה נכונה ולא תקלה בסריקה`, { samples: out.slice(0, 6) });
  const status = issues.some((i) => i.severity === 'high') ? 'bad' : issues.length ? 'warn' : 'ok';
  return { status, runDate: latest.runDate, ageDays: age, rows: rows.length, datesCovered: dates.length, issues: issues.slice(0, 12) };
}
function parity(pd, cfg) {
  // Booking's public price against the website. When Booking includes breakfast and the site does not, the owner can state what that breakfast
  // is worth for two (agentcfg/yield.breakfastValue, default 0): the site is then only a breach when it is dearer by MORE than that.
  const L = Object.values(pd).filter((d) => d.site != null && d.orig != null).sort((a, b) => a.ci.localeCompare(b.ci));
  const direct = [], genius = []; let bfDiff = 0;
  for (const d of L) {
    const bfGap = d.genBf && !d.siteBf, allow = bfGap ? +cfg.breakfastValue || 0 : 0;
    if (bfGap) bfDiff++;
    if (d.site > (d.orig + allow) * (1 + cfg.parityTol)) direct.push({ date: d.ci, dow: DOW_HE[dowOf(d.ci)], site: d.site, bookingPublic: d.orig, gapPct: pct(d.site, d.orig), bookingIncludesBreakfast: !!bfGap });
    if (d.gen != null && d.gen > (d.site + allow) * (1 + cfg.parityTol)) genius.push({ date: d.ci, dow: DOW_HE[dowOf(d.ci)], site: d.site, genius: d.gen, gapPct: pct(d.gen, d.site), bookingIncludesBreakfast: !!bfGap });
  }
  return { datesCompared: L.length, directMoreExpensiveThanBookingPublic: { n: direct.length, worst: direct.sort((a, b) => b.gapPct - a.gapPct).slice(0, 5) }, geniusMoreExpensiveThanSite: { n: genius.length, worst: genius.sort((a, b) => b.gapPct - a.gapPct).slice(0, 5) }, datesWhereOnlyBookingIncludesBreakfast: bfDiff, breakfastValueUsed: +cfg.breakfastValue || 0,
    note: 'לילה אחד, 2 מבוגרים. בתאריכים שבהם רק ב-Booking יש ארוחת בוקר ההשוואה לא שווה לגמרי. ערך ארוחת הבוקר שנלקח בחשבון מופיע ב-breakfastValueUsed (0 = לא הוגדר).' };
}
function shape(pd, rows, cfg) {
  const dates = Object.keys(pd).sort(), series = dates.map((d) => ({ date: d, dow: DOW_HE[dowOf(d)], hol: holiday(d), sold: pd[d].sold, site: pd[d].site, genius: pd[d].gen, bookingPublic: pd[d].orig, left: pd[d].left }));
  const price = (x) => (x.site != null ? x.site : x.genius);
  const byDow = {}; for (const x of series) if (price(x) != null && !x.hol) (byDow[x.dow] || (byDow[x.dow] = [])).push(price(x));
  const dowAvg = Object.fromEntries(Object.entries(byDow).map(([k, v]) => [k, Math.round(avg(v))]));
  const reg = avg(series.filter((x) => !x.hol && price(x) != null).map(price)), hol = series.filter((x) => x.hol && price(x) != null);
  const jumps = [], flat = []; let run = [];
  for (let i = 0; i < series.length; i++) {
    const p = price(series[i]), q = i ? price(series[i - 1]) : null;
    if (p != null && q != null && Math.abs(pct(p, q)) >= cfg.jumpPct) jumps.push({ from: series[i - 1].date, to: series[i].date, was: q, now: p, pct: pct(p, q), note: series[i].hol || series[i - 1].hol || '' });
    if (p != null && run.length && price(run[run.length - 1]) === p) run.push(series[i]); else { if (run.length >= cfg.flatDays) flat.push({ from: run[0].date, to: run[run.length - 1].date, price: price(run[0]) }); run = p != null ? [series[i]] : []; }
  }
  if (run.length >= cfg.flatDays) flat.push({ from: run[0].date, to: run[run.length - 1].date, price: price(run[0]) });
  const tight = series.filter((x) => x.left != null && x.left <= 3 && !x.sold).map((x) => ({ date: x.date, dow: x.dow, left: x.left, price: price(x), vsMedianPct: pct(price(x), median(series.map(price))) }));
  // room ladder: the cheapest-to-dearest order of the room categories on each date, against the usual order
  const byDate = {}; for (const r of rows) if (r.src === 'site' && r.price != null) (byDate[r.ci] || (byDate[r.ci] = {}))[r.room] = r.price;
  const orders = Object.entries(byDate).filter(([, m]) => Object.keys(m).length >= 3).map(([d, m]) => [d, Object.keys(m).sort((a, b) => m[a] - m[b] || a.localeCompare(b))]);
  const cnt = {}; for (const [, o] of orders) cnt[o.join('>')] = (cnt[o.join('>')] || 0) + 1;
  const usual = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  const inversions = usual ? orders.filter(([, o]) => o.join('>') !== usual[0]).map(([d, o]) => ({ date: d, order: o.slice(0, 6) })).slice(0, 5) : [];
  return { series, weekdayAvgSite: dowAvg, regularAvg: reg != null ? Math.round(reg) : null, holidayDates: hol.map((x) => ({ date: x.date, hol: x.hol, price: price(x), vsRegularPct: pct(price(x), reg) })).slice(0, 8), jumps: jumps.slice(0, 6), flatStreaks: flat.slice(0, 3), soldOutDates: series.filter((x) => x.sold).map((x) => x.date), lowInventory: tight.slice(0, 6), usualRoomOrderCheapestFirst: usual ? usual[0].split('>').slice(0, 6) : [], roomOrderExceptions: inversions };
}
function actions(runs, cfg) { // what the revenue manager did: the same stay date across the runs
  const T = runs.map((r) => ({ run: r.runDate, pd: perDate(rowsOf(r)) })), latest = T[T.length - 1];
  const px = (o) => (o ? (o.site != null ? o.site : o.gen) : null);
  let up = 0, down = 0, same = 0; const bigCuts = [], soldNoRise = [], tightNoRise = [];
  for (const date of Object.keys(latest.pd)) {
    const seq = T.map((t) => ({ run: t.run, o: t.pd[date] })).filter((x) => x.o);
    if (seq.length < 2) continue;
    const first = seq[0], last = seq[seq.length - 1], pf = px(first.o), pl = px(last.o);
    for (let i = 1; i < seq.length; i++) { const a = px(seq[i - 1].o), b = px(seq[i].o); if (a == null || b == null) continue; if (b > a) up++; else if (b < a) down++; else same++;
      if (pct(b, a) <= -cfg.bigCutPct) bigCuts.push({ date, run: seq[i].run, was: a, now: b, pct: pct(b, a) }); }
    const rose = seq.some((x, i) => i && px(x.o) != null && px(seq[i - 1].o) != null && px(x.o) > px(seq[i - 1].o));
    if (last.o.sold && !rose) soldNoRise.push({ date, dow: DOW_HE[dowOf(date)], firstSeen: first.run, price: pf });
    if (!last.o.sold && last.o.left != null && last.o.left <= 3 && pf != null && pl != null && pl <= pf) tightNoRise.push({ date, dow: DOW_HE[dowOf(date)], left: last.o.left, firstPrice: pf, nowPrice: pl });
  }
  return { runsCompared: T.length, from: T[0].run, to: latest.run, priceRises: up, priceCuts: down, unchanged: same, bigCuts: bigCuts.sort((a, b) => a.pct - b.pct).slice(0, 6), soldOutWithoutAnyRise: soldNoRise.slice(0, 6), tightWithoutRise: tightNoRise.slice(0, 6),
    note: T.length < 2 ? 'יש רק ריצה אחת, ולכן אי אפשר עדיין לראות מה מנהל התשואה שינה.' : 'ריצות סוכן המחירים הן אחת ל-3 ימים בערך, ולכן שינוי שנעשה והתבטל באמצע לא נראה.' };
}
function market(rows, pd, cfg) {
  const comp = rows.filter((r) => r.src === 'comp'); if (!comp.length) return { available: false, reason: 'אין עדיין שורות מתחרים (src=comp). המלצות על רמת מחיר ינתנו רק כשיהיו לפחות ' + cfg.minComps + ' מתחרים בתאריך.' };
  const by = {}; for (const r of comp) { const name = r.comp || r.room; ((by[r.ci] || (by[r.ci] = {}))[name]) = r.price; }
  const dates = [], names = new Set(comp.map((r) => r.comp || r.room));
  for (const [d, m] of Object.entries(by).sort()) {
    const prices = Object.values(m).filter((x) => x != null), soldOut = Object.values(m).filter((x) => x == null).length;
    const ours = pd[d] ? (pd[d].gen != null ? pd[d].gen : pd[d].site) : null, med = median(prices);
    dates.push({ date: d, dow: DOW_HE[dowOf(d)], hol: holiday(d), comps: prices.length, compsSoldOut: soldOut, compMin: minOf(prices), compMedian: med != null ? Math.round(med) : null, compMax: prices.length ? Math.max(...prices) : null, ourCheapest: ours, ourSoldOut: !!(pd[d] && pd[d].sold), indexVsMedian: ours != null && med ? Math.round((ours / med) * 100) : null, enough: prices.length >= cfg.minComps });
  }
  const ok = dates.filter((x) => x.enough && x.indexVsMedian != null);
  return { available: ok.length > 0, competitors: [...names].slice(0, 12), minCompsRequired: cfg.minComps, dates: dates.slice(0, 16), avgIndexVsMedian: ok.length ? Math.round(avg(ok.map((x) => x.indexVsMedian))) : null, datesTooFewComps: dates.length - ok.length,
    note: 'המחיר שלנו = הזול ביותר ב-Booking (Genius) והמתחרה = המחיר הכי זול שלו ב-Booking. זה לא בהכרח אותו סוג חדר ואותה ארוחה.' };
}
async function metricsOf(scope, today, cfg) {
  const H = scope.hotel ? [{ id: scope.hotel, name: scope.name }] : (scope.hotels || []);
  const per = [];
  for (const h of H) {
    const runs = await loadRuns(h.id, today, cfg.historyDays); if (!runs.length) { per.push({ hotel: h.id, name: h.name, noData: true }); continue; }
    const latest = runs[runs.length - 1], rows = rowsOf(latest), pd = perDate(rows);
    per.push({ hotel: h.id, name: h.name, runs, pageCheck: pageCheck(latest, runs[runs.length - 2], rows, cfg, today), parity: parity(pd, cfg), shape: shape(pd, rows, cfg), rmActions: actions(runs, cfg), market: market(rows, pd, cfg),
      groups: await loadGroups(h.id, today, cfg), otb: await loadOtb(h.id, today) });
  }
  return per;
}
const compact = (m) => { const { runs, ...rest } = m; return rest; };
const digestOf = (per) => crypto.createHash('sha1').update(JSON.stringify(per.map((m) => [m.hotel, m.noData || (m.runs || []).map((r) => r.runDate + ':' + (r.n || (r.rows || []).length)), (m.groups || []).length, m.otb && m.otb.runDate]))).digest('hex').slice(0, 16);

// ---------- the model ----------
const RM_KNOW = `WHAT A HOTEL REVENUE MANAGER DOES (so you know what to check):
- Daily: reads pickup (new bookings overnight) and pace against last year; checks the competitors' public rates; adjusts price and restrictions (minimum stay, closed to arrival, rate plans) for the dates where demand is ahead or behind; keeps rate parity across channels (the direct website must never be dearer than the OTAs); watches cancellations, no-shows and overbooking.
- Weekly: strategy meeting, 30/60/90-day forecast, displacement analysis for groups (does a group at a lower rate block rooms that would sell dearer?), channel mix and commission cost, events and holidays calendar.
- Monthly: budget against actual, ADR / occupancy / RevPAR and their indexes against the compset (ARI, MPI, RGI), rate-plan and promotion review.
- Core idea: sell the right room to the right guest at the right price. Demand ahead of pace -> raise price or close cheap plans; behind pace -> open offers, cut selectively. A date that sells out early was priced too low; a flat price on every date ignores demand.`;
function system(kb, scope, kind) {
  const rules = `Your name is Guy (in Hebrew: גיא). You are the yield-management auditor of the Seven Collection hotels (Israel): an independent second pair of eyes on (a) the human revenue manager's pricing and (b) the "price comparison" page of the app. ${scope.hotel ? 'Scope: the hotel "' + scope.name + '".' : 'Scope: the whole chain; there is one block of metrics per hotel.'}
${RM_KNOW}

YOUR JOB
1. PAGE CHECK: say whether the data on the price comparison page can be trusted today (pageCheck in the metrics) and what must be fixed (stale run, missing dates, one source missing, room names that do not match, outliers, zero prices).
2. AUDIT THE PRICING: parity, price shape (weekday, weekend, holidays), flat streaks, jumps, sold-out and tight dates, ladder exceptions, and what the revenue manager actually changed between runs (rmActions). Compare with the owner's stated rules in the business context, when there are any (floors, targets, fences, parity policy, Genius level).
3. MARKET: ${kind === 'weekly' ? 'weekly report: summarize the week, the biggest risks and opportunities, and up to 3 recommendations.' : 'daily check: what changed since the previous check and what needs attention today. If nothing important changed, say so in one line.'} Price-LEVEL recommendations (raise / cut on specific dates) are allowed ONLY when market.available is true and the date has at least one competitor with a price (enough: true), or when the owner's rules are clearly broken. Otherwise give recommendations about data, parity and process only, and say that price-level advice waits for competitor data.

RULES
- You are READ ONLY. You change nothing. Every recommendation is a suggestion for the revenue manager / the hotel manager to decide.
- Be fair and professional about the revenue manager: write "worth checking" and "ask the revenue manager why", never accuse. Put up to 4 concrete questions in questionsForRm.
- The metrics are computed by the system: use only those numbers, never invent one, quote dates with the weekday letter (א-ש) and ₪.
- You do NOT see occupancy, ADR, RevPAR, pickup or pace unless metrics.otb is present. When it is missing, say so in caveats once, and say which data would unlock it (a daily export of rooms sold and room revenue per stay date, from the PMS).
- The tracker sees PUBLIC online prices for 1 night and 2 adults, not what guests really paid. Booking Genius vs the website is not like-for-like when breakfast differs. Group blocks (groups) remove rooms from public sale; mention them when a date looks cheap while a group is in house.
- Always say how many competitors a market recommendation rests on (comps on the date). With only 1 or 2 competitors it is a weak signal: say so and word it as "worth considering", not as a conclusion.
- Small data is not proof: with one run or few dates, say the picture is thin. The Gregorian holidays and school vacations are not computed; use only those the owner lists below.
- Write in Hebrew, short and concrete: at most 8 findings and 3 recommendations, ranked. Each finding says what, which dates, and the action.
- Finish by calling save_report ONCE. That is what the managers read.`;
  const k = kb.trim() ? '\n\nBUSINESS CONTEXT FROM THE OWNER (the revenue manager, rules, floors, compset, calendar):\n' + kb : '\n\nBUSINESS CONTEXT: none given yet. You do not know the hotel\'s targets, price floors, rate fences or who the competitors are: say so when it matters.';
  return [{ type: 'text', text: rules + k, cache_control: { type: 'ephemeral' } }];
}
const SAVE_REPORT = { name: 'save_report', description: 'Save the report the managers will read. Call it ONCE, at the end.',
  input_schema: { type: 'object', properties: {
    headline: { type: 'string', description: 'One line: the most important thing today' },
    summary: { type: 'string', description: '3-6 short sentences' },
    pageStatus: { type: 'string', enum: ['ok', 'warn', 'bad'], description: 'Can the price comparison page be trusted' },
    pageNotes: { type: 'string', description: 'What to fix on the page / the tracker, short' },
    findings: { type: 'array', items: { type: 'object', properties: { area: { type: 'string', enum: ['data', 'parity', 'pricing', 'inventory', 'market', 'rm'] }, severity: { type: 'string', enum: ['high', 'medium', 'low', 'good'] }, title: { type: 'string' }, detail: { type: 'string' }, dates: { type: 'string' }, action: { type: 'string' } }, required: ['area', 'severity', 'title', 'detail'] } },
    recommendations: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, why: { type: 'string' }, action: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, basis: { type: 'string', enum: ['market', 'rules', 'history', 'parity', 'data'], description: 'What the advice rests on' } }, required: ['title', 'why', 'action', 'basis'] } },
    questionsForRm: { type: 'array', items: { type: 'string' } },
    caveats: { type: 'string' } }, required: ['headline', 'summary', 'pageStatus', 'findings'] } };
const cleanReport = (a, marketOk) => ({
  headline: clip(a.headline, 200), summary: clip(a.summary, 1500), pageStatus: ['ok', 'warn', 'bad'].includes(a.pageStatus) ? a.pageStatus : 'warn', pageNotes: clip(a.pageNotes, 400),
  findings: (Array.isArray(a.findings) ? a.findings : []).slice(0, 8).map((f) => ({ area: ['data', 'parity', 'pricing', 'inventory', 'market', 'rm'].includes(f.area) ? f.area : 'pricing', severity: ['high', 'medium', 'low', 'good'].includes(f.severity) ? f.severity : 'low', title: clip(f.title, 160), detail: clip(f.detail, 500), dates: clip(f.dates, 160), action: clip(f.action, 300) })),
  // price-level advice rests on market data or on the owner's rules; without them it is dropped here, whatever the model wrote
  recommendations: (Array.isArray(a.recommendations) ? a.recommendations : []).filter((r) => r.basis !== 'market' || marketOk).slice(0, 3).map((r) => ({ title: clip(r.title, 160), why: clip(r.why, 400), action: clip(r.action, 400), priority: ['high', 'medium', 'low'].includes(r.priority) ? r.priority : 'medium', basis: ['market', 'rules', 'history', 'parity', 'data'].includes(r.basis) ? r.basis : 'data' })),
  questionsForRm: (Array.isArray(a.questionsForRm) ? a.questionsForRm : []).slice(0, 4).map((q) => clip(q, 250)), caveats: clip(a.caveats, 500) });

function readTools(scope, today) {
  const hotels = scope.hotel ? [{ id: scope.hotel, name: scope.name }] : (scope.hotels || []), pick = (id) => hotels.find((h) => h.id === id || h.name === id) || hotels[0];
  return [
    { name: 'rates_grid', description: 'Prices of the latest tracker run per stay date and room: site price, Booking Genius price, Booking original price, breakfast, rooms left. Max 16 dates.',
      input_schema: { type: 'object', properties: { hotel: { type: 'string', description: 'hotel id (chain scope only)' }, from: { type: 'string' }, to: { type: 'string' } } },
      run: async (a) => { const h = pick(a.hotel), runs = await loadRuns(h.id, today, 10); if (!runs.length) return { rows: [] }; const latest = runs[runs.length - 1], from = a.from || latest.runDate, to = a.to || C.addDays(from, 15);
        const out = {}; for (const r of rowsOf(latest)) if (r.src !== 'comp' && r.ci >= from && r.ci <= to) { const o = out[r.ci] || (out[r.ci] = {}); (o[r.room || '-'] || (o[r.room || '-'] = {}))[r.src] = r.price == null ? 'אזל' : { price: r.price, ...(r.orig != null ? { orig: r.orig } : {}), ...(r.bf ? { breakfast: true } : {}), ...(r.left != null ? { left: r.left } : {}) }; }
        return { run: latest.runDate, dates: Object.fromEntries(Object.entries(out).sort().slice(0, 16)) }; } },
    { name: 'price_history', description: 'How the price of ONE stay date changed across the tracker runs (cheapest site, cheapest Genius, rooms left).',
      input_schema: { type: 'object', properties: { hotel: { type: 'string' }, checkin: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['checkin'] },
      run: async (a) => { const h = pick(a.hotel), runs = await loadRuns(h.id, today, 30); return { checkin: a.checkin, runs: runs.map((r) => { const o = perDate(rowsOf(r))[a.checkin]; return o ? { run: r.runDate, site: o.site, genius: o.gen, bookingPublic: o.orig, left: o.left, soldOut: o.sold } : null; }).filter(Boolean) }; } },
    { name: 'competitor_grid', description: 'Competitor prices of the latest run per stay date (empty until competitor rows exist).',
      input_schema: { type: 'object', properties: { hotel: { type: 'string' } } },
      run: async (a) => { const h = pick(a.hotel), runs = await loadRuns(h.id, today, 10); if (!runs.length) return { rows: [] }; const by = {}; for (const r of rowsOf(runs[runs.length - 1])) if (r.src === 'comp') ((by[r.ci] || (by[r.ci] = {}))[r.comp || r.room] = r.price == null ? 'אזל' : r.price); return { dates: Object.fromEntries(Object.entries(by).sort().slice(0, 16)) }; } },
  ];
}

async function previous(scope, ids) { const s = await Promise.all(ids.map((id) => db.doc('yieldReports/' + id).get())); return s.filter((x) => x.exists).map((x) => { const d = x.data(); return { date: d.date, headline: d.headline, pageStatus: d.pageStatus, findings: (d.findings || []).map((f) => f.title).slice(0, 5) }; }); }
async function runScope(scope, kind, cfg, today, force) {
  const per = await metricsOf(scope, today, cfg);
  if (!per.some((m) => !m.noData)) return { scope: scope.key, skipped: 'no data' };
  const digest = digestOf(per), sref = db.doc('agentState/yield_' + kind + '_' + scope.key), st = (await sref.get()).data() || {};
  if (!force && kind === 'daily' && st.digest === digest && Date.now() - (+st.at || 0) < cfg.skipMaxDays * 864e5) return { scope: scope.key, skipped: 'unchanged' };
  const week = C.weekOf(today), prevIds = kind === 'weekly' ? [C.addDays(week, -7)].map((w) => 'weekly_' + scope.key + '_' + w) : [1, 2, 3].map((i) => 'daily_' + scope.key + '_' + C.addDays(today, -i));
  const prev = await previous(scope, prevIds);
  let saved = null; const tools = [...readTools(scope, today), { ...SAVE_REPORT, run: async (a) => { saved = a || {}; return { saved: true }; } }];
  const model = cfg.model || SMART;
  const out = await C.runLoop({ model, system: [...system(await C.loadKB('yield'), scope, kind), ...(await tasksTxt(scope.hotel).then((t) => t ? [{ type: 'text', text: t }] : []))], tools, messages: [{ role: 'user', content: `${kind === 'weekly' ? 'Weekly report' : 'Daily check'} for ${today}. Previous reports (latest first): ${JSON.stringify(prev)}\n\nMETRICS (computed by the system; one block per hotel):\n${JSON.stringify(per.map(compact))}` }], maxTurns: 8, maxTokens: 12000, mustAnswer: true });
  const marketOk = per.some((m) => m.market && m.market.available);
  let rep = saved ? cleanReport(saved, marketOk) : null;
  if (!rep) { const t = String(out.text || '').trim(); if (!t) { await C.logRun('yield', { scope: scope.key, kind, model, usage: out.U, tools: out.used, stop: out.stop, error: 'no report produced' }); return { scope: scope.key, skipped: 'no report' }; } rep = cleanReport({ headline: t.split('\n')[0], summary: t, pageStatus: 'warn' }, marketOk); }
  const id = kind + '_' + scope.key + '_' + (kind === 'weekly' ? week : today);
  const health = per.map((m) => ({ hotel: m.hotel, name: m.name, status: m.noData ? 'nodata' : m.pageCheck.status, runDate: m.noData ? '' : m.pageCheck.runDate }));
  await db.doc('yieldReports/' + id).set({ kind, hotel: scope.hotel, scopeKey: scope.key, scopeName: scope.name, date: today, week, ...rep, health, market: marketOk, at: Date.now(), model, by: 'ai' });
  await sref.set({ digest, at: Date.now() });
  await C.logRun('yield', { scope: scope.key, kind, model, usage: out.U, tools: out.used, stop: out.stop, report: id });
  return { scope: scope.key, report: id };
}
async function cleanupDaily(cfg) { try { const cut = Date.now() - cfg.keepDailyDays * 864e5, q = await db.collection('yieldReports').where('at', '<', cut).limit(200).get(); for (const d of q.docs) if ((d.data() || {}).kind === 'daily') await d.ref.delete(); } catch (e) { console.error('yield cleanup', e); } }
async function scopes() { const H = await loadHotels(); return [{ key: 'chain', hotel: '', name: 'כל הרשת', hotels: H }, ...H.map((h) => ({ key: h.id, hotel: h.id, name: h.name }))]; }
async function runAll(kind, force) {
  const cfg = { ...DEFAULTS, ...(await C.cfg('yield')) };
  if (cfg.enabled !== true || (!force && cfg[kind] === false)) return [];
  const today = C.ilDate(new Date());
  if (!force && kind === 'daily' && dowOf(today) === 0) return []; // Sunday: the weekly report replaces the daily check
  const done = [];
  for (const s of await scopes()) { try { done.push(await runScope(s, kind, cfg, today, force)); } catch (e) { console.error('yield', kind, s.key, e); await C.logRun('yield', { scope: s.key, kind, error: clip(e.message || e, 300) }); done.push({ scope: s.key, error: clip(e.message || e, 300) }); } }
  if (kind === 'daily') await cleanupDaily(cfg);
  return done;
}
exports.yieldDaily = functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '512MB' }).pubsub.schedule('0 8 * * *').timeZone('Asia/Jerusalem').onRun(async () => { await runAll('daily', false); return null; });
exports.yieldWeekly = functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '512MB' }).pubsub.schedule('0 9 * * 0').timeZone('Asia/Jerusalem').onRun(async () => { await runAll('weekly', false); return null; });
// owner only: run now. POST {kind:'daily'|'weekly', force:true}. Needs public invoker like adsRunNow (the owner's token is checked inside).
exports.yieldRunNow = functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '512MB' }).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).send('method'); return; }
  const who = await C.ownerOnly(req); if (!who) { res.status(403).json({ error: 'owner only' }); return; }
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}), kind = b.kind === 'weekly' ? 'weekly' : 'daily';
  try { res.json({ ok: true, done: await runAll(kind, b.force !== false) }); } catch (e) { console.error('yieldRunNow', e); res.status(500).json({ error: 'failed' }); }
});
// admin-started run (Nov 12): yieldJobs/{id} {kind} is created by functions/yield-run.js (clients cannot write yieldJobs: no rules match);
// the result (report ids / skipped / error text, never report content) is written back to the job doc.
exports.yieldJob = functions.region(REGION).runWith({ timeoutSeconds: 540, memory: '512MB' }).firestore.document('yieldJobs/{id}').onCreate(async (snap) => {
  const ref = snap.ref, j = snap.data() || {};
  try { await ref.set({ status: 'running', startedAt: Date.now() }, { merge: true }); const done = await runAll(j.kind === 'weekly' ? 'weekly' : 'daily', true); await ref.set({ status: 'done', done, doneAt: Date.now() }, { merge: true }); }
  catch (e) { console.error('yieldJob', e); await ref.set({ status: 'error', error: clip(e.message || e, 300) }, { merge: true }); }
});

// ---------- chat with Guy (owner, Nov 12: "I want to be able to talk with him") ----------
// POST {messages:[{role,text}], hotel} with the Firebase ID token. Allowed: the owner, or employees/{uid}.ai.guy for people who may read the
// price page by the rules (ceo, gm, rates app). Hotels: owner / ceo / all-hotel roles = chain + every hotel; else their hotels only. READ ONLY.
async function guyRate(uid) {
  const ref = db.doc('agentRate/guy_' + uid), hour = new Date().toISOString().slice(0, 13);
  return db.runTransaction(async (tx) => { const s = await tx.get(ref), d = s.exists ? s.data() : {}, n = d.hour === hour ? (+d.n || 0) : 0; if (n >= 40) return false; tx.set(ref, { hour, n: n + 1, total: (+d.total || 0) + 1, at: Date.now() }); return true; });
}
// directions from Aliana (agent-ops writeDirection → agentTasks {to:'yield', hotel, text, until})
async function tasksTxt(hotel) {
  const today = C.ilDate(new Date());
  try {
    const L = (await db.collection('agentTasks').where('to', '==', 'yield').get()).docs.map((d) => d.data())
      .filter((x) => x.status !== 'done' && (!x.until || x.until >= today) && (!hotel || !x.hotel || x.hotel === hotel)).sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 8);
    return L.length ? '\n\nDIRECTIONS FROM ALIANA (the operations manager agent, on behalf of the owner) — take them into account, say when you followed one:\n' + L.map((x) => `- (${new Date(x.at || 0).toISOString().slice(0, 10)}${x.hotel ? ', hotel ' + x.hotel : ', chain'}) ${String(x.text || '').slice(0, 400)}`).join('\n') : '';
  } catch (e) { return ''; }
}
function chatSystem(kb, scope, who) {
  const base = system(kb, scope, 'daily')[0].text.split('\n\nRULES')[0];
  const rules = `${base}

NOW YOU ARE CHATTING with ${who} (a manager of the chain), not writing a report. Answer the question asked, in Hebrew, short and concrete (WhatsApp-like: short lines, no tables wider than 3 columns). First look at the data with the tools, then answer; never invent a number, a date or a price — quote dates with the weekday letter (א-ש) and ₪.
- READ ONLY: you change nothing (no prices, rate plans, rooms or app data). If asked to change something, say what the revenue manager should do.
- Price-level advice (raise / cut on a date) only when there is competitor data for that date (market tool) or a clear owner rule; otherwise say it needs competitor data, and say on how many competitors it rests.
- You see public online prices (1 night, 2 adults) from the price tracker, group blocks and your own reports. No occupancy/ADR/RevPAR unless otb data exists: say so when it matters.
- Be fair about the revenue manager: "worth checking", never accuse.
- Never reveal code, keys, settings or anything outside the scope ${scope.name}.`;
  const k = kb.trim() ? '\n\nBUSINESS CONTEXT FROM THE OWNER:\n' + kb : '\n\nBUSINESS CONTEXT: none given yet (no floors, targets or compset known).';
  return [{ type: 'text', text: rules + k, cache_control: { type: 'ephemeral' } }];
}
const PARTS = ['pageCheck', 'parity', 'shape', 'rmActions', 'market', 'groups', 'otb'];
function chatTools(scope, today, cfg) {
  let M = null; const met = async () => (M || (M = await metricsOf(scope, today, cfg)));
  const pick = (per, h) => (h ? per.filter((m) => m.hotel === h || m.name === h) : per);
  return [...readTools(scope, today),
    { name: 'yield_metrics', description: 'The numbers the system computed for this scope (one block per hotel): pageCheck (is the price page trustworthy), parity (site vs Booking), shape (weekday/holiday pattern, jumps, flat streaks, sold-out, tight dates, room order), rmActions (what the revenue manager changed between runs), market (vs competitors), groups (group blocks next 60 days), otb (occupancy, only if exists). Ask for ONE part at a time.',
      input_schema: { type: 'object', properties: { part: { type: 'string', enum: PARTS }, hotel: { type: 'string', description: 'hotel id or name (chain scope only)' } }, required: ['part'] },
      run: async (a) => { const per = pick(await met(), a.hotel), part = PARTS.includes(a.part) ? a.part : 'pageCheck';
        return per.map((m) => ({ hotel: m.name, ...(m.noData ? { noData: true } : { [part]: part === 'shape' ? { ...m.shape, series: (m.shape.series || []).slice(0, 21) } : m[part] }) })); } },
    { name: 'my_reports', description: 'Your latest saved reports for this scope (daily and weekly): headline, summary, page status, findings, recommendations, questions.',
      input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['daily', 'weekly', 'any'] } } },
      run: async (a) => { const q = await db.collection('yieldReports').where('hotel', '==', scope.hotel).get();
        return q.docs.map((d) => d.data()).filter((r) => r.scopeKey === scope.key && (!a.kind || a.kind === 'any' || r.kind === a.kind)).sort((x, y) => y.at - x.at).slice(0, 3)
          .map((r) => ({ kind: r.kind, date: r.date, headline: r.headline, summary: r.summary, pageStatus: r.pageStatus, pageNotes: r.pageNotes, findings: r.findings, recommendations: r.recommendations, questionsForRm: r.questionsForRm, caveats: r.caveats })); } }];
}
const guyOk = (c) => !!(c && !c.denied && (c.owner || (c.ai && c.ai.guy && ['ceo', 'gm', 'rates'].some((k) => c.apps && c.apps[k] === true))));
const GUY_NO = 'אין לך הרשאה לדבר עם גיא. אפשר לבקש אותה בכרטיס העובד ← גישה לסוכני AI (וצריך גם הרשאה לעמוד השוואת מחירים).';
// the scopes this person may ask Guy about: owner / ceo / all-hotel roles = chain + every hotel; else their hotels
async function guyScopes(c) {
  const all = c.owner || (c.apps && c.apps.ceo === true) || !(c.hotels || []).length, sc = await scopes();
  return sc.filter((s) => (s.hotel ? all || c.hotels.includes(s.hotel) : all));
}
// hist = [{role, content}] (last message from the user). extra = more instructions (WhatsApp formatting).
async function guyCore(c, hist, want, extra) {
  const ss = await guyScopes(c), scope = ss.find((s) => s.hotel === String(want || '')) || ss[0];
  if (!scope) return { error: 'אין לך מלון בהרשאה.' };
  const cfg = { ...DEFAULTS, ...(await C.cfg('yield')) }, today = C.ilDate(new Date()), model = cfg.chatModel || SMART;
  const sys = chatSystem(await C.loadKB('yield'), scope, c.name || 'a manager');
  { const tt = await tasksTxt(scope.hotel); if (tt) sys.push({ type: 'text', text: tt }); }
  if (extra) sys.push({ type: 'text', text: extra });
  const out = await C.runLoop({ model, system: sys, tools: chatTools(scope, today, cfg), messages: hist, maxTurns: 8, maxTokens: 8000, mustAnswer: true });
  await C.logRun('guy-chat', { uid: c.uid, scope: scope.key, model, usage: out.U, tools: out.used, stop: out.stop || '', textLen: (out.text || '').length, via: extra ? 'wa' : 'app' });
  return { text: out.text || 'לא הצלחתי לענות על זה. אפשר לנסח אחרת?', scope };
}
exports.guyChat = functions.region(REGION).runWith({ timeoutSeconds: 300, memory: '1GB' }).https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.set('Access-Control-Allow-Methods', 'POST');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const c = await require('./assistant.js')._t.caller(req);
    if (!guyOk(c)) { res.status(403).json({ error: GUY_NO }); return; }
    if (!(await guyRate(c.uid))) { res.status(429).json({ error: 'הגעת למגבלת ההודעות לשעה. נסו שוב מאוחר יותר.' }); return; }
    const hist = (Array.isArray((req.body || {}).messages) ? req.body.messages : []).slice(-12)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()).map((m) => ({ role: m.role, content: m.text.slice(0, 3000) }));
    while (hist.length && hist[0].role !== 'user') hist.shift();
    if (!hist.length || hist[hist.length - 1].role !== 'user') { res.status(400).json({ error: 'empty' }); return; }
    const r = await guyCore(c, hist, (req.body || {}).hotel);
    if (r.error) { res.status(403).json({ error: r.error }); return; }
    res.json({ text: r.text, scope: r.scope.key });
  } catch (e) { console.error('guyChat', e); res.status(500).json({ error: 'משהו השתבש. נסו שוב בעוד רגע.' }); }
});
exports._t = { guyOk, guyCore, guyRate, guyScopes, GUY_NO, holiday, perDate, pageCheck, parity, shape, actions, market, cleanReport, digestOf, rowsOf, runAll, DEFAULTS };
