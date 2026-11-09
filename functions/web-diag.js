// temporary diag (Nov 9): is web search/fetch accepted for our Anthropic key? prints status/errors only
const admin = require('firebase-admin'); admin.initializeApp();
const db = admin.firestore();
(async () => {
  const pid = JSON.parse(require('fs').readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)).project_id;
  const q = await db.collection('agentLog').where('agent', '==', 'adam-chat').get().catch((e) => ({ docs: [], e }));
  const rows = q.docs.map((d) => d.data()).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 5);
  for (const r of rows) console.log('log', new Date(r.at || 0).toISOString(), 'tools=', JSON.stringify(r.tools || []), 'stop=', r.stop, 'len=', r.textLen, 'model=', r.model);
  const { access_token: t } = await admin.credential.applicationDefault().getAccessToken();
  const lr = await fetch('https://logging.googleapis.com/v2/entries:list', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ resourceNames: ['projects/' + pid], filter: 'textPayload:"web tools off" AND timestamp>="' + new Date(Date.now() - 6 * 3600e3).toISOString() + '"', pageSize: 5 }) });
  const lj = await lr.json().catch(() => ({}));
  console.log('logs', lr.status, (lj.entries || []).map((e) => String(e.textPayload || '').slice(0, 300)).join(' || ') || 'none', lj.error ? lj.error.message : '');
  const sr = await fetch(`https://secretmanager.googleapis.com/v1/projects/${pid}/secrets/ANTHROPIC_API_KEY/versions/latest:access`, { headers: { Authorization: 'Bearer ' + t } });
  const sj = await sr.json().catch(() => ({}));
  if (!sr.ok) { console.log('secret', sr.status, sj.error && sj.error.message); return; }
  const key = Buffer.from(sj.payload.data, 'base64').toString('utf8').trim();
  for (const tool of [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 1 }]) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 300, tools: [tool], messages: [{ role: 'user', content: tool.name === 'web_search' ? 'Search the web: weather Tel Aviv today. One line.' : 'Fetch https://example.com and say its title.' }] }) });
    const j = await r.json().catch(() => ({}));
    console.log(tool.name, r.status, j.error ? j.error.message : ('stop=' + j.stop_reason + ' blocks=' + (j.content || []).map((b) => b.type).join(',')));
  }
})().catch((e) => { console.log('fail', e.message); process.exit(0); });
