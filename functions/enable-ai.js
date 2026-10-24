// Runs from the deploy workflow: makes sure invoice scanning (Gemini on Vertex AI) can work.
// 1) enables the Vertex AI API, 2) gives the functions' runtime account the Vertex AI User role, 3) probes the models. Prints notices only.
const admin = require('firebase-admin');
const P = 'hotel-shifts', SA = `serviceAccount:${P}@appspot.gserviceaccount.com`, ROLE = 'roles/aiplatform.user';
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 400)}`);
(async () => {
  const { access_token: t } = await admin.credential.applicationDefault().getAccessToken(), H = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  const st = await (await fetch(`https://serviceusage.googleapis.com/v1/projects/${P}/services/aiplatform.googleapis.com`, { headers: H })).json();
  if (st.state !== 'ENABLED') { const r = await (await fetch(`https://serviceusage.googleapis.com/v1/projects/${P}/services/aiplatform.googleapis.com:enable`, { method: 'POST', headers: H, body: '{}' })).json(); note('Vertex AI API', r.error ? 'enable failed: ' + r.error.message : 'enabling…'); await new Promise((x) => setTimeout(x, 30000)); }
  else note('Vertex AI API', 'enabled');
  const pol = await (await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${P}:getIamPolicy`, { method: 'POST', headers: H, body: '{}' })).json();
  if (pol.error) note('AI role', 'getIamPolicy: ' + pol.error.message);
  else {
    const has = (pol.bindings || []).some((b) => (b.role === ROLE || b.role === 'roles/editor' || b.role === 'roles/owner') && (b.members || []).includes(SA));
    if (has) note('AI role', 'runtime account already allowed');
    else { const b = (pol.bindings || []).find((x) => x.role === ROLE); const bindings = (pol.bindings || []).filter((x) => x.role !== ROLE).concat([{ role: ROLE, members: [...new Set([...(b ? b.members : []), SA])] }]);
      const r = await (await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${P}:setIamPolicy`, { method: 'POST', headers: H, body: JSON.stringify({ policy: { ...pol, bindings } }) })).json(); note('AI role', r.error ? 'setIamPolicy: ' + r.error.message : 'granted Vertex AI User to the runtime account'); }
  }
  for (const m of ['gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-flash-latest']) {
    const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/${P}/locations/global/publishers/google/models/${m}:generateContent`, { method: 'POST', headers: H, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }] }) });
    const j = await r.json().catch(() => ({})); note('AI probe ' + m, r.ok ? 'OK' : (r.status + ' ' + (j.error && j.error.message || '')));
    if (r.ok) break;
  }
})().catch((e) => note('AI setup error', e.message));
