/* Managers' assistant chat (owner, Nov 6). Load after the Firebase scripts: <script src="assistant-ui.js?v=1" defer></script>
   A round button bottom-left opens a chat; questions go to the Cloud Function "assistant" with the signed-in user's ID token.
   The button appears only for the owner and role holders (not reception desk accounts or plain employees).
   The server checks permissions again on every question, so hiding the button is only for comfort, not security. */
(function () {
  const PID = () => ((window.APP_CONFIG || {}).firebase || {}).projectId || '';
  const URL_ = () => 'https://europe-west1-' + PID() + '.cloudfunctions.net/' + (agent === 'ads' ? 'adsAgent' : 'assistant');
  const KEY = 'scAsstHist';
  // two agents (owner, Nov 7): the general assistant and the ads agent (Haiku chat about campaigns, by hotel); each keeps its own conversation
  let H = { gen: [], ads: [] }, agent = 'gen', adsH = null, adsScopes = [], busy = false, root = null, me = '';
  let hist = H.gen;
  // the conversation is kept per signed-in user for this tab only
  const load = (uid) => { me = uid || ''; H = { gen: [], ads: [] }; agent = 'gen'; adsH = null; try { const o = JSON.parse(sessionStorage.getItem(KEY) || '{}'); if (o.uid === me) { H.gen = (o.hist || o.gen || []).slice(-20); H.ads = (o.ads || []).slice(-20); if (o.agent === 'ads') agent = 'ads'; if (typeof o.adsH === 'string') adsH = o.adsH; } } catch (e) { } hist = H[agent]; };
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ uid: me, gen: H.gen.slice(-20), ads: H.ads.slice(-20), agent, adsH })); } catch (e) { } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // light formatting: **bold**, "- " list lines, line breaks
  const fmt = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-•] (.*)$/gm, '• $1').replace(/\n/g, '<br>');

  const css = `
  #asst-btn{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:9998;width:52px;height:52px;border-radius:50%;border:0;
    background:#14213D;color:#D9B66C;font-size:22px;border:1px solid #B08D57;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer}
  #asst{position:fixed;inset:auto 12px calc(12px + env(safe-area-inset-bottom)) 12px;max-width:440px;height:min(72vh,620px);z-index:9999;
    background:#fff;color:#111;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;direction:rtl;font:15px/1.45 system-ui,sans-serif}
  #asst[hidden],#asst-btn[hidden]{display:none}
  #asst .log{overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
  html.asst-open,html.asst-open body{overflow:hidden!important;touch-action:none}
  html.asst-open #asst{touch-action:auto}
  @media (max-width:720px){
    #asst{inset:0;max-width:none;width:100%;height:100dvh;bottom:auto;border-radius:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);box-sizing:border-box;overflow:hidden}
    #asst header{border-radius:0}
    #asst textarea,#asst .ag select,#asst .ag button{font-size:16px}
  }
  #asst header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:2px solid #B08D57;font-weight:600;background:#14213D;color:#fff;border-radius:16px 16px 0 0}
  #asst header button{color:#e8e1d2!important}
  body:has(.sheet:not([hidden])) #asst-btn{display:none}
  #asst header button{border:0;background:none;font-size:18px;cursor:pointer;color:#555;padding:4px 8px}
  #asst .log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
  #asst .m{max-width:85%;padding:8px 11px;border-radius:12px;white-space:normal;word-wrap:break-word}
  #asst .u{align-self:flex-start;background:#14213D;color:#fff}
  #asst .a{align-self:flex-end;background:#f2f3f5}
  #asst .e{align-self:center;color:#b42318;font-size:13px}
  #asst .hint{color:#666;font-size:13px}
  #asst .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  #asst .chips button{border:1px solid #ddd;background:#fff;border-radius:999px;padding:5px 10px;font-size:13px;cursor:pointer}
  #asst .ag{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid #eee;flex-wrap:wrap}
  #asst .ag button{border:1px solid #ddd;background:#fff;border-radius:6px;padding:5px 10px;font:inherit;font-size:13px;cursor:pointer}
  #asst .ag button.on{background:#B08D57;border-color:#B08D57;color:#fff}
  #asst .ag select{margin-inline-start:auto;font:inherit;font-size:13px;border:1px solid #ddd;border-radius:6px;padding:4px 6px;max-width:45%}
  #asst .ag[hidden]{display:none}
  #asst form{display:flex;gap:8px;padding:10px;border-top:1px solid #eee}
  #asst textarea{flex:1;resize:none;border:1px solid #ddd;border-radius:10px;padding:8px 10px;font:inherit;height:42px;max-height:120px}
  #asst form button{border:0;background:#14213D;color:#fff;border-radius:10px;padding:0 14px;font:inherit;cursor:pointer}
  #asst form button:disabled{opacity:.5}
  @media (prefers-color-scheme:dark){#asst{background:#1b1d21;color:#eee}#asst .a{background:#2a2d33}#asst header,#asst form{border-color:#333}
    #asst textarea,#asst .chips button,#asst .ag button,#asst .ag select{background:#24272c;color:#eee;border-color:#3a3d43}#asst .ag{border-color:#333}#asst .ag button.on{background:#B08D57;color:#fff}}`;

  const SUGG = ['מי במשמרת היום?', 'אילו חדרים עדיין VD?', 'תקלות פתוחות', 'סיכום החודש במלון', 'תשלחי לעובד האחזקה את התקלות הפתוחות', 'מה במינימום במלאי?'];
  const SUGG_ADS = ['איך הלכו הקמפיינים השבוע?', 'איזה קמפיין הכי משתלם?', 'איזו מודעה עובדת הכי טוב?', 'איזה קהל מביא את הלידים הכי זולים?'];

  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const b = document.createElement('button'); b.id = 'asst-btn'; b.type = 'button'; b.title = 'שרון · עוזרת כללית'; b.textContent = '✦'; b.hidden = true;
    const w = document.createElement('div'); w.id = 'asst'; w.hidden = true;
    w.innerHTML = `<header><span><span style="color:#D9B66C">✦</span> <span>שרון · עוזרת כללית</span></span><span><button type="button" data-a="clear" title="שיחה חדשה">↺</button><button type="button" data-a="close" title="סגירה">✕</button></span></header>
      <div class="ag" hidden><button type="button" data-ag="gen">✦ שרון · עוזרת כללית</button><button type="button" data-ag="ads">📣 אליאנה · קמפיינים</button><select aria-label="איזה מלון" data-agh></select></div>
      <div class="log" aria-live="polite"></div>
      <form><textarea rows="1" placeholder="לשאול על משמרות, חדרים, תקלות, מלאי…" maxlength="1500"></textarea><button type="submit">שליחה</button></form>`;
    document.body.append(b, w);
    b.onclick = () => { w.hidden = false; b.hidden = true; document.documentElement.classList.add('asst-open'); draw(); if (!matchMedia('(max-width:720px)').matches) w.querySelector('textarea').focus(); };
    const vv = window.visualViewport;
    if (vv) { const fit = () => { if (w.hidden || !matchMedia('(max-width:720px)').matches) { w.style.height = ''; w.style.top = ''; return; } w.style.height = vv.height + 'px'; w.style.top = vv.offsetTop + 'px'; const l = w.querySelector('.log'); if (l) l.scrollTop = l.scrollHeight; }; vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); b.addEventListener('click', () => setTimeout(fit, 0)); }
    w.querySelector('[data-a=close]').onclick = () => { w.hidden = true; b.hidden = false; document.documentElement.classList.remove('asst-open'); };
    w.querySelector('[data-a=clear]').onclick = () => { hist = H[agent] = []; save(); draw(); };
    w.querySelectorAll('[data-ag]').forEach((x) => { x.onclick = () => { if (busy) return; agent = x.dataset.ag; hist = H[agent]; save(); draw(); }; });
    w.querySelector('[data-agh]').onchange = (e) => { adsH = e.target.value; hist = H.ads = []; save(); draw(); };
    const ta = w.querySelector('textarea');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); w.querySelector('form').requestSubmit(); } });
    w.querySelector('form').onsubmit = (e) => { e.preventDefault(); const t = ta.value.trim(); if (t) { ta.value = ''; ask(t); } };
    root = w; return b;
  }
  function draw(err) {
    const log = root.querySelector('.log');
    const ag = root.querySelector('.ag'), sel = root.querySelector('[data-agh]'), ads = agent === 'ads' && adsScopes.length;
    ag.hidden = !adsScopes.length; if (!adsScopes.length && agent === 'ads') { agent = 'gen'; hist = H.gen; }
    ag.querySelectorAll('[data-ag]').forEach((x) => x.classList.toggle('on', x.dataset.ag === agent));
    if (adsH === null || !adsScopes.some((x) => x.id === adsH)) adsH = adsScopes.length ? adsScopes[0].id : '';
    sel.hidden = !ads; sel.innerHTML = adsScopes.map((x) => `<option value="${esc(x.id)}" ${x.id === adsH ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    root.querySelector('header span span:last-child').textContent = ads ? 'אליאנה · קמפיינים' : 'שרון · עוזרת כללית';
    root.querySelector('textarea').placeholder = ads ? 'לשאול על הקמפיינים, הקהלים, המודעות…' : 'לשאול על משמרות, חדרים, תקלות, מלאי…';
    let h = hist.map((m) => `<div class="m ${m.role === 'user' ? 'u' : 'a'}">${fmt(m.text)}</div>`).join('');
    if (!hist.length) h = ads ? `<div class="hint">אליאנה עונה על הקמפיינים, הקהלים והמודעות של ${esc((adsScopes.find((x) => x.id === adsH) || {}).name || '')}. היא רק קוראת, לא משנה קמפיינים.</div><div class="chips">${SUGG_ADS.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`
      : `<div class="hint">אפשר לשאול את שרון על הנתונים של המלונות שבהרשאה שלך, לבקש סיכום, או לבקש שתשלח הודעה לעובדים. לפני כל שליחה היא מראה לך את ההודעה ומחכה לאישור.</div><div class="chips">${SUGG.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`;
    if (busy) h += '<div class="m a">…</div>';
    if (err) h += `<div class="e">${esc(err)}</div>`;
    log.innerHTML = h; log.scrollTop = log.scrollHeight;
    log.querySelectorAll('.chips button').forEach((x) => { x.onclick = () => ask(x.textContent); });
    root.querySelector('form button').disabled = busy;
  }
  async function ask(text) {
    if (busy) return;
    const u = window.firebase && firebase.auth().currentUser; if (!u) { draw('צריך להתחבר קודם.'); return; }
    hist.push({ role: 'user', text }); busy = true; save(); draw();
    let err = '';
    try {
      const r = await fetch(URL_(), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await u.getIdToken()) }, body: JSON.stringify(agent === 'ads' ? { messages: hist.slice(-8), hotel: adsH || '' } : { messages: hist.slice(-8) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) err = j.error && j.error.length > 8 ? j.error : (agent === 'ads' ? 'אליאנה' : 'שרון') + ' לא זמינה כרגע (' + r.status + ').';
      else hist.push({ role: 'assistant', text: String(j.text || '') });
    } catch (e) { err = 'אין חיבור לשרת. נסו שוב.'; }
    if (err) hist.pop(); // the question was not answered: let the person send it again
    busy = false; save(); draw(err);
  }
  // show the button only for the owner / role holders (not reception desks)
  async function gate(btn, user) {
    btn.hidden = true; if (root) root.hidden = true; document.documentElement.classList.remove('asst-open'); if (!user) return;
    try {
      const em = String(user.email || '').toLowerCase(), cfg = window.APP_CONFIG || {};
      let ok = user.emailVerified && (em === 'kfirdaabul1@gmail.com' || em === String(cfg.ownerEmail || '').toLowerCase());
      const db = firebase.firestore();
      if (!ok) { try { const o = await db.doc('orgcfg/main').get(); ok = user.emailVerified && !!em && em === String((o.data() || {}).ownerEmail || '').toLowerCase(); } catch (e) { } }
      const owner = ok; let role = null;
      if (!ok) { const r = await db.doc('roles/' + user.uid).get(); role = r.exists ? r.data() : null; ok = !!role && !role.station; }
      btn.hidden = !ok;
      // ads agent scopes: owner / CEO / all-hotel social media = whole chain + every hotel; hotel managers and social media = their hotels
      adsScopes = [];
      if (ok) {
        const ap = owner ? {} : ((role && role.apps) || {}), rh = owner ? [] : ((role && role.hotels) || []);
        if (owner || ap.ceo || ap.gm || ap.mkt) {
          const hs = (await db.collection('hotels').get()).docs.map((d) => ({ id: d.id, name: (d.data() || {}).name || d.id }));
          const chain = owner || ap.ceo || (ap.mkt && !rh.length);
          adsScopes = [...(chain ? [{ id: '', name: 'כל הרשת' }] : []), ...hs.filter((x) => owner || ap.ceo || !rh.length || rh.includes(x.id))];
        }
      }
      if (root && !root.hidden) draw();
    } catch (e) { btn.hidden = true; }
  }
  function start() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) { setTimeout(start, 500); return; }
    const btn = build();
    firebase.auth().onAuthStateChanged((u) => { load(u && u.uid); if (root && !root.hidden) draw(); gate(btn, u); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
