// Arsona alert e-mails (owner, Nov 17): fixed layout, flattened to one line by the mail script:
// "<logo> <Hotel name> <Type> <Type> <description…> <dd/mm/yyyy, h:mm:ss AM>" — Type = Request for Agent | Agent Required | Potential Lead | Missing Information.
const TY = /(request for agent|agent required|potential lead|missing information)/i;
function arsMailParse(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim().replace(/^(?:a|e)?rsona\b\s*/i, '');
  const m = TY.exec(s); if (!m) return null;
  const key = m[1].toLowerCase(), hotelTxt = s.slice(0, m.index).replace(/^[-–|\s]+|[-–|\s]+$/g, '').slice(0, 80);
  let rest = s.slice(m.index + m[0].length).trim();
  if (rest.toLowerCase().startsWith(key)) rest = rest.slice(key.length).trim();
  let when = '';
  const w = /(?:\s\S{1,20}\s*[-–]\s*)?(\d{1,2}\/\d{1,2}\/\d{4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s*$/i.exec(rest);
  if (w) { when = w[1]; rest = rest.slice(0, w.index).trim(); } else rest = rest.replace(/\s\S{1,20}\s*[-–]\s*[-–]?\s*$/, '').replace(/[\s\-–]+$/, '').trim();
  rest = rest.replace(/\s*[-–]\s*$/, '').trim();
  const g = /\bGuest\s+([^()]{2,60}?)\s*\(/.exec(rest), gw = g ? g[1].trim().split(/\s+/) : [], guest = gw.length && gw.length <= 5 && gw.every((x) => /^[A-Z֐-׿][\w'’.-]*$/.test(x)) ? gw.join(' ') : '';
  const c = /\breservation\s*(?:no\.?|number|#)?\s*:?\s*([\w-]*\d[\w-]{3,})/i.exec(rest), ch = /(Booking\.com|Expedia|Airbnb|Agoda|Hotels\.com|Trip\.com)/i.exec(rest), r = /\broom\s*#?\s*(\d{2,5})\b/i.exec(rest);
  return { key, typeTxt: m[1], hotelTxt, summary: rest.slice(0, 1500), guest, conf: c ? c[1] : '', channel: ch ? ch[1] : '', room: r ? r[1] : '', when };
}
module.exports = { arsMailParse };
