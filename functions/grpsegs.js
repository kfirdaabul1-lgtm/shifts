// group date segments (owner, Nov 25): a series group can come in several stays with the same rooms. groups.segs [{ci,co}] (2+ entries),
// groups.ci/co = first arrival / last departure. Same logic as the client grpSegs / grpSegOn / grpSegCi / grpSegCo in index.html.
function grpSegs(g) {
  const s = Array.isArray(g && g.segs) ? g.segs.filter((x) => x && x.ci && x.co && x.co > x.ci).slice().sort((a, b) => (a.ci < b.ci ? -1 : 1)) : [];
  return s.length > 1 ? s : (g && g.ci ? [{ ci: g.ci, co: g.co && g.co > g.ci ? g.co : g.ci }] : []);
}
// the segment that is current on day (ci ≤ day ≤ co), else null
const segOn = (g, day) => grpSegs(g).find((s) => s.ci <= day && day <= s.co) || null;
// the segment that day is a night of (ci ≤ day < co)
const segNight = (g, day) => grpSegs(g).find((s) => s.ci <= day && day < s.co) || null;
const msIso = (ms) => { const x = new Date(+ms); return isNaN(x) ? '' : x.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); };
const segCi = (g, s) => !!(g.ciAt && s && msIso(g.ciAt) >= s.ci);
const segCo = (g, s) => !!(g.coAt && s && msIso(g.coAt) >= s.ci);
module.exports = { grpSegs, segOn, segNight, segCi, segCo };
