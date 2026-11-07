// ================= Shared helpers for the two new agents: lead replies + paid ads (owner, Nov 7) =================
// STATUS: NOT CONNECTED. Nothing requires this file yet and nothing here is exported to functions/index.js,
// so deploying the app as it is does not run any of it. See claude/agents-setup.md for how to connect.
//
// Rules shared by both agents:
//  - every agent is OFF until agentcfg/{reply|ads}.enabled === true (a Firestore doc only the owner can write)
//  - the agents only write to their own collections (agentLog, agentRate, agentClaims, waDrafts, adRecs, adReports),
//    plus, for the reply agent in auto mode, ONE queued message into waChats/{chat}/msgs (the same document the app writes
//    when a person sends a message; the existing onWaOut function sends it)
//  - the Claude key is the same Secret Manager secret as the managers' assistant (ANTHROPIC_API_KEY)
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const db = admin.firestore();
const PLATFORM = 'kfirdaabul1@gmail.com';

// ---------- dates (Israel) ----------
const ilDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekOf = (iso) => addDays(iso, -new Date(iso + 'T12:00:00Z').getUTCDay()); // weeks start on Sunday, like the app
const isoOk = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- config + knowledge ----------
async function cfg(name) { const d = await db.doc('agentcfg/' + name).get(); return d.exists ? d.data() || {} : {}; }
// the knowledge the owner gives the agent: Firestore agentKB/{name}.text first, else the bundled file functions/kb/{name}.md
async function loadKB(name) {
  try { const d = await db.doc('agentKB/' + name).get(); if (d.exists && d.data().text) return String(d.data().text).slice(0, 40000); } catch (e) { }
  try { return fs.readFileSync(path.join(__dirname, 'kb', name + '.md'), 'utf8').slice(0, 40000); } catch (e) { return ''; }
}

// ---------- Claude ----------
let keyC = '', keyAt = 0;
async function apiKey() {
  if (keyC && Date.now() - keyAt < 3600e3) return keyC;
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const pid = process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
  const { access_token: t } = await admin.credential.applicationDefault().getAccessToken();
  const r = await fetch(`https://secretmanager.googleapis.com/v1/projects/${pid}/secrets/ANTHROPIC_API_KEY/versions/latest:access`, { headers: { Authorization: 'Bearer ' + t } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('secret: ' + ((j.error && j.error.message) || r.status));
  keyC = Buffer.from(j.payload.data, 'base64').toString('utf8').trim(); keyAt = Date.now(); return keyC;
}
async function claude(body) {
  for (let i = 0; ; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': await apiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    if (i < 1 && (r.status === 429 || r.status >= 500)) { await sleep(2000); continue; } // one retry on overload
    throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
  }
}

// One conversation with tools. `system` = array of text blocks (put the big stable part FIRST with cache_control).
// Tools: [{name, description, input_schema, run: async (input) => object}]. Returns {text, used, U}.
async function runLoop({ model, system, tools, messages, maxTurns = 5, maxTokens = 900 }) {
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  const api = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  if (api.length) api[api.length - 1].cache_control = { type: 'ephemeral' };
  const msgs = messages.slice(), used = [], U = { in: 0, out: 0, cr: 0, cw: 0 }; let text = '';
  for (let turn = 0; turn < maxTurns; turn++) {
    const last = msgs[msgs.length - 1], send = msgs.slice(0, -1);
    const lc = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content.map((b) => ({ ...b }));
    lc[lc.length - 1] = { ...lc[lc.length - 1], cache_control: { type: 'ephemeral' } };
    send.push({ role: last.role, content: lc });
    const body = { model, max_tokens: maxTokens, system, messages: send };
    if (api.length) body.tools = api;
    const j = await claude(body);
    const u = j.usage || {}; U.in += u.input_tokens || 0; U.out += u.output_tokens || 0; U.cr += u.cache_read_input_tokens || 0; U.cw += u.cache_creation_input_tokens || 0;
    const blocks = j.content || [];
    text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const calls = blocks.filter((b) => b.type === 'tool_use');
    if (j.stop_reason !== 'tool_use' || !calls.length) break;
    msgs.push({ role: 'assistant', content: blocks });
    const results = [];
    for (const b of calls) {
      const t = by[b.name]; let out;
      try { out = t ? await t.run(b.input || {}) : { error: 'unknown tool' }; } catch (e) { console.error('agent tool', b.name, e); out = { error: 'tool failed' }; }
      used.push(b.name);
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out).slice(0, 12000) });
    }
    msgs.push({ role: 'user', content: results });
  }
  return { text, used, U };
}

// ---------- who is asking (owner only) ----------
async function ownerOnly(req) {
  const m = String(req.get('authorization') || '').match(/^Bearer (.+)$/); if (!m) return null;
  let tok; try { tok = await admin.auth().verifyIdToken(m[1], true); } catch (e) { return null; }
  if (tok.email_verified !== true) return null;
  const em = String(tok.email || '').toLowerCase();
  let ok = em === PLATFORM;
  if (!ok) { try { const o = await db.doc('orgcfg/main').get(); ok = !!(o.exists && String(o.data().ownerEmail || '').toLowerCase() === em); } catch (e) { } }
  return ok ? { uid: tok.uid, email: em } : null;
}

// one line per run in agentLog (admin only): who, what, tokens. Never throws.
const logRun = (agent, data) => db.collection('agentLog').add({ agent, at: Date.now(), ...data }).catch(() => { });

module.exports = { db, admin, PLATFORM, ilDate, addDays, weekOf, isoOk, sleep, cfg, loadKB, claude, runLoop, ownerOnly, logRun };
