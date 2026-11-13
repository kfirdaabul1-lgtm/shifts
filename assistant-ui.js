/* Managers' assistant chat (owner, Nov 6). Load after the Firebase scripts: <script src="assistant-ui.js?v=1" defer></script>
   A round button bottom-left opens a chat; questions go to the Cloud Function "assistant" with the signed-in user's ID token.
   The button appears only for the owner and role holders (not reception desk accounts or plain employees).
   The server checks permissions again on every question, so hiding the button is only for comfort, not security. */
(function () {
  const PID = () => ((window.APP_CONFIG || {}).firebase || {}).projectId || '';
  const URL_ = () => 'https://europe-west1-' + PID() + '.cloudfunctions.net/' + (agent === 'ads' ? 'adsAgent' : agent === 'adam' ? 'adamChat' : agent === 'guy' ? 'guyChat' : agent === 'ops' ? 'opsChat' : 'assistant');
  const KEY = 'scAsstHist';
  // two agents (owner, Nov 7): the general assistant and the ads agent (Haiku chat about campaigns, by hotel); each keeps its own conversation
  let opsOk = false, H = { gen: [], ads: [], adam: [], guy: [], ops: [] }, guyScopes = [], guyH = null, adamOk = false, adamSt = '', genOk = false, agent = 'gen', adsH = null, adsScopes = [], busy = false, root = null, me = '', helpOnly = false;
  let hist = H.gen;
  // the conversation is kept per signed-in user for this tab only
  const load = (uid) => { me = uid || ''; H = { gen: [], ads: [], adam: [], guy: [], ops: [] }; agent = 'gen'; adsH = null; guyH = null; try { const o = JSON.parse(sessionStorage.getItem(KEY) || '{}'); if (o.uid === me) { H.gen = (o.hist || o.gen || []).slice(-20); H.ads = (o.ads || []).slice(-20); H.adam = (o.adam || []).slice(-20); H.guy = (o.guy || []).slice(-20); if (['ads', 'adam', 'guy'].includes(o.agent)) agent = o.agent; if (typeof o.adsH === 'string') adsH = o.adsH; if (typeof o.guyH === 'string') guyH = o.guyH; } } catch (e) { } hist = H[agent]; };
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ uid: me, gen: H.gen.slice(-20), ads: H.ads.slice(-20), adam: H.adam.slice(-60), guy: H.guy.slice(-20), ops: H.ops.slice(-30), agent, adsH, guyH })); } catch (e) { } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // light formatting: **bold**, "- " list lines, line breaks
  // numbered lines ("1. ...") become step rows (owner, Nov 9: how-to answers as steps)
  const fmt = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-•] (.*)$/gm, '• $1')
    .replace(/^(\d{1,2})[.)] (.*)$/gm, '<span class="st"><span class="sn">$1</span><span>$2</span></span>').replace(/\n/g, '<br>').replace(/<\/span><br>/g, '</span>');

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
  #asst .st{display:flex;gap:8px;align-items:flex-start;margin:4px 0}
  #asst .sn{flex:0 0 22px;height:22px;border-radius:50%;background:#B08D57;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:600}
  #asst .shw{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
  #asst .shw button{border:0;border-radius:8px;padding:7px 12px;font:inherit;font-size:14px;cursor:pointer;background:#14213D;color:#fff}
  #asst .shw button.g{background:none;border:1px solid #B08D57;color:#7A5C2E}
  #asst-ring{position:fixed;z-index:10000;border:3px solid #F59E0B;border-radius:10px;box-shadow:0 0 0 4000px rgba(10,15,30,.45);pointer-events:none;transition:all .25s}
  #asst-tip{position:fixed;z-index:10001;max-width:min(340px,calc(100vw - 24px));background:#14213D;color:#fff;border:1px solid #B08D57;border-radius:12px;padding:12px 14px;direction:rtl;font:15px/1.45 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35)}
  #asst-tip .tn{color:#D9B66C;font-size:12px;margin-bottom:4px}
  #asst-tip .tb{display:flex;gap:6px;margin-top:10px;justify-content:flex-end}
  #asst-tip button{border:1px solid #B08D57;background:none;color:#fff;border-radius:8px;padding:6px 12px;font:inherit;font-size:14px;cursor:pointer}
  #asst-tip button.p{background:#B08D57;color:#14213D;font-weight:600}
  #asst-tip .miss{color:#FCD34D;font-size:13px;margin-top:6px}
  #asst form{display:flex;gap:8px;padding:10px;border-top:1px solid #eee}
  #asst textarea{flex:1;resize:none;border:1px solid #ddd;border-radius:10px;padding:8px 10px;font:inherit;height:42px;max-height:120px}
  #asst form button{border:0;background:#14213D;color:#fff;border-radius:10px;padding:0 14px;font:inherit;cursor:pointer}
  #asst form button:disabled{opacity:.5}
  #asst form label.att{display:flex;align-items:center;justify-content:center;width:38px;border:1px solid #ddd;border-radius:10px;cursor:pointer;font-size:18px}
  #asst .fchip{display:flex;gap:8px;align-items:center;margin:0 10px;padding:6px 10px;border:1px dashed #B08D57;border-radius:10px;font-size:13px}
  #asst .fchip button{border:0;background:none;cursor:pointer;font-size:15px;color:inherit;margin-inline-start:auto}
  @media (prefers-color-scheme:dark){#asst{background:#1b1d21;color:#eee}#asst .a{background:#2a2d33}#asst header,#asst form{border-color:#333}
    #asst textarea,#asst .chips button,#asst .ag button,#asst .ag select{background:#24272c;color:#eee;border-color:#3a3d43}#asst .ag{border-color:#333}#asst .ag button.on{background:#B08D57;color:#fff}}`;

  const SUGG = ['איך עושים…? (שרון תראה לך על המסך)', 'מי במשמרת היום?', 'אילו חדרים עדיין VD?', 'תקלות פתוחות', 'סיכום החודש במלון', 'תשלחי לעובד האחזקה את התקלות הפתוחות', 'מה במינימום במלאי?'];
  const SUGG_HELP = ['איך מגישים זמינות?', 'איך מבקשים החלפת משמרת?', 'איך מפעילים התראות?'];
  const SUGG_ADAM = ['מה אתה יודע עכשיו?', 'מה חסר לך כדי לענות טוב ללקוחות?', 'תעבור על ההצעות, התפריטים והשיחות ותציע מה להוסיף לידע שלך', 'לקוח שואל: אפשר לעשות יום הולדת ל-40 איש בגוטמן?', 'תלמד: סיורים במקום בימים א׳–ה׳ בין 10:00 ל-17:00'];
  const SUGG_OPS = ['מה דחוף היום בכל המלונות?', 'מה חסר לצ׳ק אין היום?', 'איך עובדים שאר הסוכנים?', 'מה מצב הסידור לשבוע הבא?'];
  const SUGG_GUY = ['מה המצב השבוע?', 'אפשר לסמוך על עמוד השוואת המחירים היום?', 'מה מנהל התשואה שינה מאז הריצה הקודמת?', 'איפה האתר יקר מ-Booking?'];
  const SUGG_ADS = ['איך הלכו הקמפיינים השבוע?', 'איזה קמפיין הכי משתלם?', 'איזו מודעה עובדת הכי טוב?', 'איזה קהל מביא את הלידים הכי זולים?'];

  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const b = document.createElement('button'); b.id = 'asst-btn'; b.type = 'button'; b.title = 'שרון · עוזרת כללית'; b.textContent = '✦'; b.hidden = true;
    const w = document.createElement('div'); w.id = 'asst'; w.hidden = true;
    w.innerHTML = `<header><span><span style="color:#D9B66C">✦</span> <span>שרון · עוזרת כללית</span></span><span><button type="button" data-a="clear" title="שיחה חדשה">↺</button><button type="button" data-a="close" title="סגירה">✕</button></span></header>
      <div class="ag" hidden><button type="button" data-ag="gen">✦ שרון · עוזרת כללית</button><button type="button" data-ag="ads">📣 עדי · קמפיינים</button><button type="button" data-ag="adam" hidden>🤵 אדם · אירועים</button><button type="button" data-ag="guy" hidden>📈 גיא · תשואה</button><button type="button" data-ag="ops" hidden>🗂 אליאנה · אופרציה</button><select aria-label="איזה מלון" data-agh></select></div>
      <div class="log" aria-live="polite"></div>
      <div class="fchip" hidden></div>
      <form><label class="att" hidden title="צירוף קובץ וורד, PDF, תמונה או ייצוא צ׳אט מוואטסאפ">📎<input type="file" accept=".docx,.pdf,.txt,.zip,image/*" hidden></label><textarea rows="1" placeholder="לשאול על משמרות, חדרים, תקלות, מלאי…" maxlength="1500"></textarea><button type="submit">שליחה</button></form>`;
    document.body.append(b, w);
    b.onclick = () => { w.hidden = false; b.hidden = true; document.documentElement.classList.add('asst-open'); draw(); if (!matchMedia('(max-width:720px)').matches) w.querySelector('textarea').focus(); };
    const vv = window.visualViewport;
    if (vv) { const fit = () => { if (w.hidden || !matchMedia('(max-width:720px)').matches) { w.style.height = ''; w.style.top = ''; return; } w.style.height = vv.height + 'px'; w.style.top = vv.offsetTop + 'px'; const l = w.querySelector('.log'); if (l) l.scrollTop = l.scrollHeight; }; vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); b.addEventListener('click', () => setTimeout(fit, 0)); }
    w.querySelector('[data-a=close]').onclick = () => { w.hidden = true; b.hidden = false; document.documentElement.classList.remove('asst-open'); };
    w.querySelector('[data-a=clear]').onclick = () => { hist = H[agent] = []; save(); draw(); };
    w.querySelectorAll('[data-ag]').forEach((x) => { x.onclick = () => { if (busy) return; agent = x.dataset.ag; hist = H[agent]; save(); draw(); }; });
    w.querySelector('[data-agh]').onchange = (e) => { if (agent === 'guy') { guyH = e.target.value; hist = H.guy = []; } else { adsH = e.target.value; hist = H.ads = []; } save(); draw(); };
    const ta = w.querySelector('textarea');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); w.querySelector('form').requestSubmit(); } });
    w.querySelector('form').onsubmit = (e) => { e.preventDefault(); const t = ta.value.trim(); if (t || pend) { ta.value = ''; ask(t || 'מה יש בקובץ, ומה כדאי להוסיף לידע שלך?'); } };
    // a file for Adam (owner, Nov 9): Word / PDF / text as is (up to 6MB), pictures shrunk to JPEG ≤1600px
    w.querySelector('.att input').onchange = async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      try { pend = /^image\//.test(f.type) ? await shrink(f) : await asB64(f); } catch (er) { pend = null; draw(er.message || 'לא הצלחתי לקרוא את הקובץ.'); return; }
      draw();
    };
    w.querySelector('.fchip').onclick = (e) => { if (e.target.closest('button')) { pend = null; draw(); } };
    root = w; return b;
  }
  let pend = null; // {name, mime, data} waiting to go with the next message to Adam
  function asB64(f) {
    return new Promise((ok, no) => {
      if (/\.zip$/i.test(f.name)) { unzipTxt(f).then(ok, no); return; }
      if (f.size > 6e6) { no(new Error('הקובץ גדול מדי (עד 6MB).')); return; }
      if (!/\.(docx|pdf|txt)$/i.test(f.name)) { no(new Error('אפשר לצרף קובץ וורד (‎.docx), PDF, תמונה, קובץ טקסט או ייצוא צ׳אט מוואטסאפ (‎.zip).')); return; }
      const r = new FileReader(); r.onload = () => ok({ name: f.name, mime: f.type || '', data: String(r.result).split(',')[1] || '' }); r.onerror = () => no(new Error('')); r.readAsDataURL(f);
    });
  }
  // WhatsApp "Export chat" .zip (owner, Nov 10): take only the chat .txt in the browser (the zip may carry media), send it as text
  async function unzipTxt(f) {
    const bad = () => new Error('לא הצלחתי לפתוח את קובץ ה-zip. בוואטסאפ: ייצוא צ׳אט ← בלי מדיה, ושלחו את הקובץ שנוצר.');
    if (f.size > 120e6) throw new Error('הקובץ גדול מדי. בוואטסאפ בחרו "ייצוא צ׳אט" ← "בלי מדיה".');
    const buf = new Uint8Array(await f.arrayBuffer()), dv = new DataView(buf.buffer);
    let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw bad();
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), fl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + fl)); p += 46 + fl + xl + cl;
      if (!/\.txt$/i.test(name)) continue;
      const ds = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), data = buf.subarray(ds, ds + csize);
      let out = data;
      if (method === 8) { if (!window.DecompressionStream) throw bad(); out = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
      else if (method !== 0) throw bad();
      if (out.length > 6e6) out = out.subarray(out.length - 6e6);
      let bin = ''; for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
      return { name: f.name.replace(/\.zip$/i, '') + '.txt', mime: 'text/plain', data: btoa(bin) };
    }
    throw bad();
  }
  function shrink(f) {
    return new Promise((ok, no) => {
      const u = URL.createObjectURL(f), im = new Image();
      im.onload = () => { const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok({ name: f.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.82).split(',')[1] }); };
      im.onerror = () => { URL.revokeObjectURL(u); no(new Error('לא הצלחתי לפתוח את התמונה.')); }; im.src = u;
    });
  }
  function draw(err) {
    const log = root.querySelector('.log');
    const ag = root.querySelector('.ag'), sel = root.querySelector('[data-agh]');
    // which agents this person has: Sharon (gen), Aliana (ads), Adam (adam: owner or employees/{uid}.ai.adam, Nov 9)
    const avail = { gen: genOk, ads: !!adsScopes.length, adam: adamOk, guy: !!guyScopes.length, ops: opsOk };
    if (!avail[agent]) { agent = ['gen', 'ads', 'adam', 'guy', 'ops'].find((k) => avail[k]) || 'gen'; hist = H[agent]; }
    ag.hidden = Object.values(avail).filter(Boolean).length < 2;
    ag.querySelectorAll('[data-ag]').forEach((x) => { x.hidden = !avail[x.dataset.ag]; });
    const adam = agent === 'adam', ops = agent === 'ops';
    const ads = agent === 'ads' && adsScopes.length;
    ag.querySelectorAll('[data-ag]').forEach((x) => x.classList.toggle('on', x.dataset.ag === agent));
    if (adsH === null || !adsScopes.some((x) => x.id === adsH)) adsH = adsScopes.length ? adsScopes[0].id : '';
    const guy = agent === 'guy' && guyScopes.length;
    if (guyH === null || !guyScopes.some((x) => x.id === guyH)) guyH = guyScopes.length ? guyScopes[0].id : '';
    const scs = guy ? guyScopes : adsScopes, cur = guy ? guyH : adsH;
    sel.hidden = !(ads || (guy && guyScopes.length > 1)); sel.innerHTML = scs.map((x) => `<option value="${esc(x.id)}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    root.querySelector('header span span:last-child').textContent = ops ? 'אליאנה · מנהלת האופרציה' : adam ? 'אדם · סוכן מכירת אירועים' : guy ? 'גיא · סוכן תשואה' : ads ? 'עדי · קמפיינים' : 'שרון · עוזרת כללית';
    root.querySelector('textarea').placeholder = ops ? 'לשאול על התפעול במלונות, לצרף קובץ או ייצוא צ׳אט 📎…' : adam ? 'ללמד את אדם משהו, לצרף קובץ או ייצוא צ׳אט 📎, או לכתוב "לקוח שואל: …"' : guy ? 'לשאול על המחירים, הפריטי, מה מנהל התשואה שינה…' : ads ? 'לשאול על הקמפיינים, הקהלים, המודעות…' : helpOnly ? 'לשאול איך עושים משהו באפליקציה…' : 'לשאול על משמרות, חדרים, תקלות, מלאי, או איך עושים משהו…';
    let h = hist.map((m, i) => `<div class="m ${m.role === 'user' ? 'u' : 'a'}">${fmt(m.text)}${m.show && m.show.steps ? `<div class="shw"><button type="button" data-show="${i}">👀 הראי לי על המסך</button>${m.show.page !== 'events' ? `<button type="button" class="g" data-open="${i}">פתיחת העמוד</button>` : ''}</div>` : ''}</div>`).join('');
    if (!hist.length) h = ops ? `<div class="hint">אליאנה, מנהלת האופרציה, בודקת כל בוקר את כל המלונות (משמרות, 10days, משק, אחזקה, קבוצות, אירועים) ומפקחת על שאר הסוכנים. אפשר לשאול אותה, לצרף קובץ, תמונה או ייצוא צ׳אט, והיא יכולה לחפש באינטרנט. היא רק קוראת, לא משנה כלום.</div><div class="chips">${SUGG_OPS.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`
      : adam ? `<div class="hint">כאן מדברים עם אדם ומלמדים אותו. ספר לו עובדות על האירועים והוא יציע איך לכתוב אותן בידע שלו, וישמור רק אחרי שתאשר. כתוב "לקוח שואל: …" כדי לראות מה הוא היה עונה. שום דבר לא נשלח ללקוחות מכאן.${adamSt ? `<br><b>${esc(adamSt)}</b>` : ''}</div><div class="chips">${SUGG_ADAM.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`
      : guy ? `<div class="hint">גיא בודק את המחירים של <b>${esc((guyScopes.find((x) => x.id === guyH) || {}).name || '')}</b>. הוא עובר על עמוד השוואת המחירים, על פערים בין האתר ל-Booking ועל מה שמנהל התשואה שינה. הוא רק קורא נתונים ולא משנה מחירים.</div><div class="chips">${SUGG_GUY.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`
      : ads ? `<div class="hint">עדי עונה על הקמפיינים, הקהלים והמודעות של ${esc((adsScopes.find((x) => x.id === adsH) || {}).name || '')}. היא רק קוראת, לא משנה קמפיינים.</div><div class="chips">${SUGG_ADS.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`
      : helpOnly ? `<div class="hint">אפשר לשאול את שרון איך עושים דברים באפליקציה. היא מסבירה בשלבים ויכולה להראות לך על המסך על מה ללחוץ. את הלחיצות עושים בעצמך.</div><div class="chips">${SUGG_HELP.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`
      : `<div class="hint">אפשר לשאול את שרון איך עושים דברים באפליקציה (היא תראה לך על המסך), על הנתונים של המלונות שבהרשאה שלך, לבקש סיכום, או לבקש שתשלח הודעה לעובדים. לפני כל שליחה היא מראה לך את ההודעה ומחכה לאישור.</div><div class="chips">${SUGG.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`;
    if (busy) h += '<div class="m a">…</div>';
    if (err) h += `<div class="e">${esc(err)}</div>`;
    log.innerHTML = h; log.scrollTop = log.scrollHeight;
    log.querySelectorAll('.chips button').forEach((x) => { x.onclick = () => { if (/…/.test(x.textContent)) { const ta = root.querySelector('textarea'); ta.value = 'איך '; ta.focus(); return; } ask(x.textContent); }; });
    log.querySelectorAll('[data-show]').forEach((x) => { x.onclick = () => tour((hist[+x.dataset.show] || {}).show, true); });
    log.querySelectorAll('[data-open]').forEach((x) => { x.onclick = () => tour((hist[+x.dataset.open] || {}).show, false); });
    root.querySelector('form button').disabled = busy;
    root.querySelector('.att').hidden = !(adam || ops); if (!(adam || ops)) pend = null;
    const fc = root.querySelector('.fchip'); fc.hidden = !pend; fc.innerHTML = pend ? `📎 <span>${esc(pend.name)}</span><button type="button" title="הסרה">✕</button>` : '';
  }
  async function ask(text) {
    if (busy) return;
    const u = window.firebase && firebase.auth().currentUser; if (!u) { draw('צריך להתחבר קודם.'); return; }
    const file = agent === 'adam' || agent === 'ops' ? pend : null; pend = null;
    hist.push({ role: 'user', text: file ? '📎 ' + file.name + '\n' + text : text }); busy = true; save(); draw();
    let err = '';
    try {
      const r = await fetch(URL_(), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await u.getIdToken()) }, body: JSON.stringify(agent === 'ads' ? { messages: hist.slice(-8).map(({ role, text }) => ({ role, text })), hotel: adsH || '' } : agent === 'guy' ? { messages: hist.slice(-12).map(({ role, text }) => ({ role, text })), hotel: guyH || '' } : { messages: hist.slice(agent === 'adam' ? -40 : agent === 'ops' ? -20 : -8).map(({ role, text }) => ({ role, text })), ...(file ? { file } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) err = j.error && j.error.length > 8 ? j.error : (agent === 'ops' ? 'אליאנה לא זמינה' : agent === 'ads' ? 'עדי לא זמינה' : agent === 'adam' ? 'אדם לא זמין' : agent === 'guy' ? 'גיא לא זמין' : 'שרון לא זמינה') + ' כרגע (' + r.status + ').';
      else hist.push({ role: 'assistant', text: String(j.text || ''), ...(j.show && j.show.page && Array.isArray(j.show.steps) ? { show: j.show } : {}) });
    } catch (e) { err = 'אין חיבור לשרת. נסו שוב.'; }
    if (err) { hist.pop(); if (file) pend = file; } // the question was not answered: let the person send it again (with the file)
    busy = false; save(); draw(err);
  }
  // ---------- on-screen guide (owner, Nov 9) ----------
  // Opens an allowed page and draws a ring around each button with Sharon's line. It only NAVIGATES (a whitelist of menu
  // actions) and never clicks anything else: the person presses the buttons themselves.
  const NAV = { avail: ['tab', 'avail'], mine: ['tab', 'mine'], profile: ['tab', 'profile'], sched: ['tab', 'sched'], shifts: ['tab', 'shifts'], costs: ['tab', 'costs'] };
  ['hr', 'org', 'cfg', 'front', 'brief', 'gm', 'ceo', 'fin', 'exp', 'mkt', 'rates', 'hk', 'pub', 'bar', 'maint', 'stock', 'cmp', 'vch', 'spa', 'grp', 'leads'].forEach((p) => { NAV[p] = ['app-' + p]; });
  const fire = (act, t) => { const b = document.createElement('button'); b.type = 'button'; b.hidden = true; b.dataset.act = act; if (t) b.dataset.t = t; document.body.appendChild(b); try { b.click(); } finally { b.remove(); } };
  // the events app is a separate page (events.html): a tour that needs the other page is saved and resumed there after it loads
  const onEv = () => /events\.html$/.test(location.pathname);
  const TKEY = 'scAsstTour';
  function goPage(page, show, steps) {
    if (page === 'events' ? !onEv() : onEv()) {
      try { sessionStorage.setItem(TKEY, JSON.stringify({ at: Date.now(), steps: !!steps, show })); } catch (e) { }
      location.href = page === 'events' ? 'events.html' : 'index.html'; return false;
    }
    if (page === 'events') return true;
    const n = NAV[page]; if (!n) return false;
    if (n[0] === 'tab') { fire('app-shifts'); setTimeout(() => fire('tab', n[1]), 60); } else fire(n[0]);
    return true;
  }
  const vis = (el) => { if (!el || el.closest('#asst,#asst-tip,#asst-btn')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  function findEl(f) {
    f = String(f || '');
    if (f.startsWith('id:')) { const e = document.getElementById(f.slice(3).replace(/[^A-Za-z0-9_-]/g, '')); return vis(e) ? e : null; }
    if (f.startsWith('act:')) { const a = f.slice(4); return [...document.querySelectorAll('[data-act="' + a.replace(/[^a-z0-9-]/g, '') + '"]')].find(vis) || null; }
    if (f.startsWith('text:')) {
      const he = f.slice(5).trim(); if (!he) return null; const tr = window.i18n ? window.i18n(he) : he;
      const c = [...document.querySelectorAll('button,a,summary,label,[data-act],[data-tab],h2,h3,.item,.dchip,th')].filter((x) => { const t = (x.textContent || '').trim(); return t && (t.includes(he) || (tr && t.includes(tr))) && vis(x); });
      c.sort((a, b) => a.textContent.length - b.textContent.length); return c[0] || null;
    }
    return null;
  }
  let T = null;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && T) tourEnd(); });
  function tourEnd() { if (T) { clearInterval(T.iv); window.removeEventListener('resize', T.pos); window.removeEventListener('scroll', T.pos, true); } T = null; ['asst-ring', 'asst-tip'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); }); }
  function tour(show, steps) {
    if (!show || !show.page) return;
    tourEnd();
    root.hidden = true; document.documentElement.classList.remove('asst-open'); document.getElementById('asst-btn').hidden = false;
    if (!goPage(show.page, show, steps) || !steps) return;
    T = { s: show.steps || [], i: 0, el: null, iv: 0 };
    const ring = document.createElement('div'); ring.id = 'asst-ring';
    const tip = document.createElement('div'); tip.id = 'asst-tip'; tip.setAttribute('role', 'dialog'); tip.setAttribute('aria-live', 'polite');
    document.body.append(ring, tip);
    T.pos = () => {
      if (!T) return; const el = T.el && document.contains(T.el) && vis(T.el) ? T.el : (T.el = findEl(T.s[T.i].find));
      tip.querySelector('.miss').hidden = !!el || !T.s[T.i].find;
      if (!el) { ring.style.display = 'none'; tip.style.left = '50%'; tip.style.transform = 'translateX(-50%)'; tip.style.top = ''; tip.style.bottom = 'calc(90px + env(safe-area-inset-bottom))'; return; }
      const r = el.getBoundingClientRect(), p = 6; ring.style.display = '';
      Object.assign(ring.style, { left: (r.left - p) + 'px', top: (r.top - p) + 'px', width: (r.width + 2 * p) + 'px', height: (r.height + 2 * p) + 'px' });
      const th = tip.offsetHeight || 120, below = r.bottom + 14 + th < innerHeight;
      tip.style.transform = ''; tip.style.bottom = '';
      tip.style.top = (below ? r.bottom + 14 : Math.max(10, r.top - 14 - th)) + 'px';
      tip.style.left = Math.max(12, Math.min(innerWidth - tip.offsetWidth - 12, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
    };
    const step = () => {
      const s = T.s[T.i], last = T.i === T.s.length - 1;
      tip.innerHTML = `<div class="tn">✦ שרון · ${T.i + 1}/${T.s.length}</div><div>${esc(s.say)}</div><div class="miss" hidden>לא מוצאת את זה במסך כרגע. אולי צריך לגלול או לפתוח קודם את השלב הקודם.</div>
        <div class="tb">${T.i ? '<button type="button" data-t="prev">הקודם</button>' : ''}<button type="button" class="p" data-t="${last ? 'end' : 'next'}">${last ? 'סיום' : 'הבא'}</button><button type="button" data-t="end" aria-label="סגירה">✕</button></div>`;
      tip.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { const a = b.dataset.t; if (a === 'end') { tourEnd(); return; } T.i += a === 'next' ? 1 : -1; T.el = null; step(); }; });
      T.el = findEl(s.find);
      if (T.el) try { T.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
      T.pos(); setTimeout(() => T && T.pos(), 400);
    };
    window.addEventListener('resize', T.pos); window.addEventListener('scroll', T.pos, true);
    T.iv = setInterval(() => T && T.pos(), 600); // the app re-renders: keep the ring on the button
    setTimeout(() => T && step(), 450);
  }
  // a tour saved before moving between index.html and events.html continues once the page is ready
  let resumed = false;
  function resume() {
    if (resumed) return; resumed = true;
    let p = null; try { p = JSON.parse(sessionStorage.getItem(TKEY) || 'null'); sessionStorage.removeItem(TKEY); } catch (e) { }
    if (!p || !p.show || Date.now() - (+p.at || 0) > 60e3) return;
    const t0 = Date.now(), ready = () => onEv() ? document.querySelector('[data-tab="board"]') : document.querySelector('[data-act="menu"]');
    const wait = () => { if (ready() || Date.now() - t0 > 15e3) setTimeout(() => tour(p.show, p.steps), 500); else setTimeout(wait, 300); };
    wait();
  }
  // show the button only for the owner / role holders (not reception desks)
  async function gate(btn, user) {
    btn.hidden = true; if (root) root.hidden = true; document.documentElement.classList.remove('asst-open'); if (!user) return;
    try {
      const em = String(user.email || '').toLowerCase(), cfg = window.APP_CONFIG || {};
      let ok = user.emailVerified && (em === 'kfirdaabul1@gmail.com' || em === String(cfg.ownerEmail || '').toLowerCase());
      const db = firebase.firestore();
      if (!ok) { try { const o = await db.doc('orgcfg/main').get(); ok = user.emailVerified && !!em && em === String((o.data() || {}).ownerEmail || '').toLowerCase(); } catch (e) { } }
      const owner = ok;
      // agents are given per person on the employee card (employees/{uid}.ai {help, sharon, aliana}, owner Nov 9); the owner has all.
      // help (default on) = Sharon only explains how to use the app; sharon = Sharon with hotel data; reception desks get help only
      let ai = { help: owner, sharon: owner, aliana: owner, adam: owner, guy: owner }, eh = '';
      if (!owner) {
        let station = false; try { const r = await db.doc('roles/' + user.uid).get(); station = !!(r.exists && r.data().station); } catch (e) { }
        if (station) ai = { help: true, sharon: false, aliana: false, adam: false, guy: false };
        else { try { const e = await db.doc('employees/' + user.uid).get(); if (e.exists) { const d = e.data() || {}, a = d.ai || {}; ai = { help: a.help !== false, sharon: a.sharon === true, aliana: a.aliana === true, adam: a.adam === true, guy: a.guy === true }; eh = d.hotel || ''; } } catch (e) { } }
      }
      genOk = !!(ai.sharon || ai.help); helpOnly = !owner && !ai.sharon; guyScopes = [];
      if (ai.guy) { // Guy (yield agent, Nov 12): owner, or ai.guy + a role that may read the price page (ceo / gm / rates)
        let ra = {}, xh = []; if (!owner) { try { const r = await db.doc('roles/' + user.uid).get(); const d = r.exists ? r.data() || {} : {}; ra = d.apps || {}; xh = d.extraHotels || []; } catch (e) { } }
        if (owner || ra.ceo || ra.gm || ra.rates) {
          const hs = (await db.collection('hotels').get()).docs.map((d) => ({ id: d.id, name: (d.data() || {}).name || d.id }));
          const all = owner || ra.ceo || eh === 'chain';
          guyScopes = [...(all ? [{ id: '', name: 'כל הרשת' }] : []), ...hs.filter((x) => all || x.id === eh || xh.includes(x.id))];
        }
      }
      ok = !!(genOk || ai.aliana || ai.adam || guyScopes.length || owner);
      btn.hidden = !ok;
      // Aliana's scopes: owner / chain staff = whole chain + every hotel; everyone else = their own hotel
      adsScopes = [];
      if (ai.aliana) {
        const hs = (await db.collection('hotels').get()).docs.map((d) => ({ id: d.id, name: (d.data() || {}).name || d.id }));
        const chain = owner || eh === 'chain';
        let xh = []; if (!chain) { try { const r = await db.doc('roles/' + user.uid).get(); xh = (r.exists && r.data().extraHotels) || []; } catch (e) { } }
        adsScopes = [...(chain ? [{ id: '', name: 'כל הרשת' }] : []), ...hs.filter((x) => chain || x.id === eh || xh.includes(x.id))];
      }
      adamOk = !!ai.adam; adamSt = ''; opsOk = owner; // Aliana, operations manager (Nov 13): owner only for now
      if (owner) { try { const a = await db.doc('agentcfg/reply').get(), d = a.exists ? a.data() || {} : {}; adamSt = 'מצב: ' + (d.enabled === true ? 'פעיל' : 'כבוי, לא עונה ללקוחות') + ' · ' + (d.mode === 'auto' ? 'אוטומטי' : 'טיוטה'); } catch (e) { } }
      if (root && !root.hidden) draw();
    } catch (e) { btn.hidden = true; }
  }
  function start() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) { setTimeout(start, 500); return; }
    const btn = build();
    firebase.auth().onAuthStateChanged((u) => { load(u && u.uid); if (root && !root.hidden) draw(); gate(btn, u); if (u) resume(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
