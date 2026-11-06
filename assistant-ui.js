/* Managers' assistant chat (owner, Nov 6). Load after the Firebase scripts: <script src="assistant-ui.js?v=1" defer></script>
   A round button bottom-left opens a chat; questions go to the Cloud Function "assistant" with the signed-in user's ID token.
   The button appears only for the owner and role holders (not reception desk accounts or plain employees).
   The server checks permissions again on every question, so hiding the button is only for comfort, not security. */
(function () {
  const PID = () => ((window.APP_CONFIG || {}).firebase || {}).projectId || '';
  const URL_ = () => 'https://europe-west1-' + PID() + '.cloudfunctions.net/assistant';
  const KEY = 'scAsstHist';
  let hist = [], busy = false, root = null, me = '';
  // the conversation is kept per signed-in user for this tab only
  const load = (uid) => { me = uid || ''; hist = []; try { const o = JSON.parse(sessionStorage.getItem(KEY) || '{}'); if (o.uid === me) hist = (o.hist || []).slice(-20); } catch (e) { } };
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ uid: me, hist: hist.slice(-20) })); } catch (e) { } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // light formatting: **bold**, "- " list lines, line breaks
  const fmt = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-•] (.*)$/gm, '• $1').replace(/\n/g, '<br>');

  const css = `
  #asst-btn{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:9998;width:52px;height:52px;border-radius:50%;border:0;
    background:#14213D;color:#D9B66C;font-size:22px;border:1px solid #B08D57;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer}
  #asst{position:fixed;inset:auto 12px calc(12px + env(safe-area-inset-bottom)) 12px;max-width:440px;height:min(72vh,620px);z-index:9999;
    background:#fff;color:#111;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;direction:rtl;font:15px/1.45 system-ui,sans-serif}
  #asst[hidden],#asst-btn[hidden]{display:none}
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
  #asst form{display:flex;gap:8px;padding:10px;border-top:1px solid #eee}
  #asst textarea{flex:1;resize:none;border:1px solid #ddd;border-radius:10px;padding:8px 10px;font:inherit;height:42px;max-height:120px}
  #asst form button{border:0;background:#14213D;color:#fff;border-radius:10px;padding:0 14px;font:inherit;cursor:pointer}
  #asst form button:disabled{opacity:.5}
  @media (prefers-color-scheme:dark){#asst{background:#1b1d21;color:#eee}#asst .a{background:#2a2d33}#asst header,#asst form{border-color:#333}
    #asst textarea,#asst .chips button{background:#24272c;color:#eee;border-color:#3a3d43}}`;

  const SUGG = ['מי במשמרת היום?', 'אילו חדרים עדיין VD?', 'תקלות פתוחות', 'מה במינימום במלאי?', 'מה יש היום בספא?'];

  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const b = document.createElement('button'); b.id = 'asst-btn'; b.type = 'button'; b.title = 'עוזר למנהלים'; b.textContent = '✦'; b.hidden = true;
    const w = document.createElement('div'); w.id = 'asst'; w.hidden = true;
    w.innerHTML = `<header><span><span style="color:#D9B66C">✦</span> <span>עוזר למנהלים</span></span><span><button type="button" data-a="clear" title="שיחה חדשה">↺</button><button type="button" data-a="close" title="סגירה">✕</button></span></header>
      <div class="log" aria-live="polite"></div>
      <form><textarea rows="1" placeholder="לשאול על משמרות, חדרים, תקלות, מלאי…" maxlength="1500"></textarea><button type="submit">שליחה</button></form>`;
    document.body.append(b, w);
    b.onclick = () => { w.hidden = false; b.hidden = true; draw(); w.querySelector('textarea').focus(); };
    w.querySelector('[data-a=close]').onclick = () => { w.hidden = true; b.hidden = false; };
    w.querySelector('[data-a=clear]').onclick = () => { hist = []; save(); draw(); };
    const ta = w.querySelector('textarea');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); w.querySelector('form').requestSubmit(); } });
    w.querySelector('form').onsubmit = (e) => { e.preventDefault(); const t = ta.value.trim(); if (t) { ta.value = ''; ask(t); } };
    root = w; return b;
  }
  function draw(err) {
    const log = root.querySelector('.log');
    let h = hist.map((m) => `<div class="m ${m.role === 'user' ? 'u' : 'a'}">${fmt(m.text)}</div>`).join('');
    if (!hist.length) h = `<div class="hint">אפשר לשאול על הנתונים של המלונות שבהרשאה שלך. העוזר רק קורא, לא משנה כלום.</div><div class="chips">${SUGG.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`;
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
      const r = await fetch(URL_(), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await u.getIdToken()) }, body: JSON.stringify({ messages: hist.slice(-8) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) err = j.error && j.error.length > 8 ? j.error : 'העוזר לא זמין כרגע (' + r.status + ').';
      else hist.push({ role: 'assistant', text: String(j.text || '') });
    } catch (e) { err = 'אין חיבור לשרת. נסו שוב.'; }
    if (err) hist.pop(); // the question was not answered: let the person send it again
    busy = false; save(); draw(err);
  }
  // show the button only for the owner / role holders (not reception desks)
  async function gate(btn, user) {
    btn.hidden = true; if (root) root.hidden = true; if (!user) return;
    try {
      const em = String(user.email || '').toLowerCase(), cfg = window.APP_CONFIG || {};
      let ok = user.emailVerified && (em === 'kfirdaabul1@gmail.com' || em === String(cfg.ownerEmail || '').toLowerCase());
      const db = firebase.firestore();
      if (!ok) { try { const o = await db.doc('orgcfg/main').get(); ok = user.emailVerified && !!em && em === String((o.data() || {}).ownerEmail || '').toLowerCase(); } catch (e) { } }
      if (!ok) { const r = await db.doc('roles/' + user.uid).get(); ok = r.exists && !r.data().station; }
      btn.hidden = !ok;
    } catch (e) { btn.hidden = true; }
  }
  function start() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) { setTimeout(start, 500); return; }
    const btn = build();
    firebase.auth().onAuthStateChanged((u) => { load(u && u.uid); if (root && !root.hidden) draw(); gate(btn, u); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
