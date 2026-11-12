// Runs from the deploy workflow (owner, Nov 6): sets up the managers' assistant (function `assistant`).
// 1) the Secret Manager secret ANTHROPIC_API_KEY exists (never prints it), 2) the functions' runtime account may read it,
// 3) the HTTP functions assistant, adsRunNow, adsAgent are public (their code checks the Firebase ID token itself), probe: GET → our 405 {"error":"method"}.
const admin = require('firebase-admin');
const P = 'hotel-shifts', SA = `serviceAccount:${P}@appspot.gserviceaccount.com`, ROLE = 'roles/secretmanager.secretAccessor', SEC = 'ANTHROPIC_API_KEY';
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 400)}`);
(async () => {
  const { access_token: t } = await admin.credential.applicationDefault().getAccessToken(), H = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  const sm = `https://secretmanager.googleapis.com/v1/projects/${P}/secrets/${SEC}`;
  const s = await (await fetch(sm, { headers: H })).json();
  if (s.error) note('Assistant key', 'secret ' + SEC + ': ' + s.error.message);
  else {
    const v = await (await fetch(sm + '/versions/latest', { headers: H })).json();
    note('Assistant key', v.error ? 'no version: ' + v.error.message : 'secret found, latest version ' + String(v.name || '').split('/').pop() + ' ' + (v.state || ''));
    const pol = await (await fetch(sm + ':getIamPolicy', { headers: H })).json();
    if (pol.error) note('Assistant key access', 'getIamPolicy: ' + pol.error.message);
    else {
      const b = (pol.bindings || []).find((x) => x.role === ROLE);
      if (b && (b.members || []).includes(SA)) note('Assistant key access', 'runtime account already allowed');
      else {
        const bindings = (pol.bindings || []).filter((x) => x.role !== ROLE).concat([{ role: ROLE, members: [...new Set([...(b ? b.members : []), SA])] }]);
        const r = await (await fetch(sm + ':setIamPolicy', { method: 'POST', headers: H, body: JSON.stringify({ policy: { ...pol, bindings } }) })).json();
        if (!r.error) note('Assistant key access', 'granted the runtime account access to the key');
        else { // no rights on the secret itself: grant the role on the project (the runtime account already has broad project access)
          const pp = await (await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${P}:getIamPolicy`, { method: 'POST', headers: H, body: '{}' })).json();
          if (pp.error) note('Assistant key access', 'secret: ' + r.error.message + ' · project getIamPolicy: ' + pp.error.message);
          else if ((pp.bindings || []).some((x) => x.role === ROLE && (x.members || []).includes(SA))) note('Assistant key access', 'runtime account allowed on the project');
          else {
            const pb = pp.bindings.find((x) => x.role === ROLE), nb = (pp.bindings || []).filter((x) => x.role !== ROLE).concat([{ role: ROLE, members: [...new Set([...(pb ? pb.members : []), SA])] }]);
            const r2 = await (await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${P}:setIamPolicy`, { method: 'POST', headers: H, body: JSON.stringify({ policy: { ...pp, bindings: nb } }) })).json();
            note('Assistant key access', r2.error ? 'project setIamPolicy: ' + r2.error.message : 'granted the runtime account Secret Accessor on the project');
          }
        }
      }
    }
  }
  // HTTP functions whose own code checks the caller (Firebase ID token): Google must let the request reach them.
  // assistant (managers' assistant), adsRunNow / adsAgent (paid-ads agent, owner only, Nov 7). Probe: GET → our 405 {"error":"method"}.
  for (const fn of ['assistant', 'adsRunNow', 'adsAgent', 'fxRunNow', 'adamChat', 'yieldRunNow', 'guyChat']) {
    const url = 'https://europe-west1-hotel-shifts.cloudfunctions.net/' + fn;
    const probe = () => fetch(url).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 60) })).catch((e) => ({ s: 0, b: e.message }));
    let p = await probe(); note('Invoker ' + fn, 'probe status ' + p.s + ' · ' + p.b);
    if (p.s === 405) continue;
    const base = `https://cloudfunctions.googleapis.com/v1/projects/${P}/locations/europe-west1/functions/${fn}`;
    const pol = await (await fetch(base + ':getIamPolicy', { headers: H })).json();
    if (pol.error) { note('Invoker ' + fn, 'getIamPolicy: ' + pol.error.message); continue; }
    const b = (pol.bindings || []).find((x) => x.role === 'roles/cloudfunctions.invoker');
    const bindings = (pol.bindings || []).filter((x) => x.role !== 'roles/cloudfunctions.invoker').concat([{ role: 'roles/cloudfunctions.invoker', members: [...new Set([...(b ? b.members : []), 'allUsers'])] }]);
    const r = await (await fetch(base + ':setIamPolicy', { method: 'POST', headers: H, body: JSON.stringify({ policy: { ...pol, bindings } }) })).json();
    note('Invoker ' + fn, r.error ? 'setIamPolicy: ' + r.error.message : 'made public');
    if (!r.error) { await new Promise((x) => setTimeout(x, 20000)); p = await probe(); note('Invoker ' + fn, 'probe again ' + p.s + ' · ' + p.b); }
  }
})().catch((e) => note('Assistant setup error', e.message));
