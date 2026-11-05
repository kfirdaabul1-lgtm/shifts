// Adds a domain to Firebase Authentication's authorised domains (Google sign-in popup / e-mail links need it). Usage: node auth-domain.js app.example.com
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 400)}`);
(async () => {
  const dom = process.argv[2]; if (!dom) return note('Auth domain', 'no domain');
  const { access_token: t } = await admin.credential.applicationDefault().getAccessToken();
  const U = 'https://identitytoolkit.googleapis.com/admin/v2/projects/hotel-shifts/config', H = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', 'x-goog-user-project': 'hotel-shifts' };
  const c = await (await fetch(U, { headers: H })).json();
  if (c.error) return note('Auth domain', 'get config: ' + c.error.message);
  const list = c.authorizedDomains || [];
  if (list.includes(dom)) return note('Auth domain', 'already authorised: ' + list.join(', '));
  const r = await (await fetch(U + '?updateMask=authorizedDomains', { method: 'PATCH', headers: H, body: JSON.stringify({ authorizedDomains: [...list, dom] }) })).json();
  note('Auth domain', r.error ? 'update: ' + r.error.message : 'added · now: ' + (r.authorizedDomains || []).join(', '));
})().catch((e) => note('Auth domain', 'failed: ' + e.message));
