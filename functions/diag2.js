// Rules test (firebaserules :test) of a housekeeping worker's "started cleaning" write, with real docs mocked. Prints the verdict and the failing expression.
const admin = require('firebase-admin'); const fs = require('fs'); admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 1500)}`);
const P = 'hotel-shifts', base = '/databases/(default)/documents/';
(async () => {
  const uid = process.env.UID || 'QRRVpmxie5WBDOanKPUgdQPURJ12', h = 'hezj3h4cj';
  const hd = (await db.doc('hkday/' + h).get()).data().date, hkId = h + '__' + hd;
  const docs = {}; for (const p of ['roles/' + uid, 'employees/' + uid, 'orgcfg/main', 'hk/' + hkId]) { const s = await db.doc(p).get(); docs[p] = s.exists ? s.data() : null; }
  const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v && v._seconds !== undefined ? v._seconds * 1000 : v)));
  const mocks = [];
  for (const [p, d] of Object.entries(docs)) {
    mocks.push({ function: 'exists', args: [{ exactValue: base + p }], result: { value: !!d } });
    if (d) mocks.push({ function: 'get', args: [{ exactValue: base + p }], result: { value: { data: clean(d) } } });
  }
  const user = await admin.auth().getUser(uid);
  const token = { email: user.email || null, email_verified: !!user.emailVerified, firebase: { sign_in_provider: (user.providerData[0] || {}).providerId || 'password' } };
  note('User', `${user.email} verified=${user.emailVerified} providers=${user.providerData.map((x) => x.providerId).join(',')}`);
  const cur = clean(docs['hk/' + hkId]), room = Object.keys(cur.asg || {}).find((k) => cur.asg[k] === uid) || '401', now = Date.now();
  const next = JSON.parse(JSON.stringify(cur)); next.updatedAt = now; next.lastBy = uid; next.start = Object.assign({}, next.start || {}, { [room]: now });
  const src = fs.readFileSync(__dirname + '/../firestore.rules', 'utf8');
  const { access_token: t } = await admin.credential.applicationDefault().getAccessToken();
  const mk = (u, tok, method, data, res, path) => ({ expectation: 'ALLOW', request: { auth: { uid: u, token: tok }, path: '/databases/(default)/documents/' + (path || 'hk/' + hkId), method, time: new Date().toISOString(), resource: { data } }, resource: res ? { data: res } : undefined, functionMocks: mocks, expressionReportLevel: 'NONE' });
  const done = JSON.parse(JSON.stringify(next)); done.clean[room] = 'vi'; done.done = Object.assign({}, done.done || {}, { [room]: now }); done.doneBy = Object.assign({}, done.doneBy || {}, { [room]: uid });
  const asg = JSON.parse(JSON.stringify(cur)); asg.asg[room] = 'someone'; asg.updatedAt = now;
  const occ = JSON.parse(JSON.stringify(cur)); occ.occ = Object.assign({}, occ.occ || {}, { [room]: 'zzz' + now }); occ.updatedAt = now;
  const cases = [['worker start', mk(uid, token, 'update', next, cur)], ['worker done', mk(uid, token, 'update', done, cur)], ['worker asg (should DENY)', Object.assign(mk(uid, token, 'update', asg, cur), { expectation: 'DENY' })], ['worker occ (should DENY)', Object.assign(mk(uid, token, 'update', occ, cur), { expectation: 'DENY' })],
    ['fault hk create', mk(uid, token, 'create', { hotel: h, room: room, desc: 'x', status: 'open', openedBy: uid, source: 'hk' }, null, 'faults/hk_test')],
    ['call done', mk(uid, token, 'update', { hotel: h, to: uid, status: 'done', doneAt: 2, mins: 3, room: room }, { hotel: h, to: uid, status: 'open', room: room }, 'hkCalls/test')],
    ['push token', mk(uid, token, 'create', { uid, tokens: {} }, null, 'pushTokens/' + uid)],
    ['worker create', mk(uid, token, 'create', { hotel: h, date: '2099-01-01', start: { 1: 1 }, updatedAt: 1, lastBy: uid }, null, 'hk/' + h + '__2099-01-01')]];
  for (const [lbl, file] of [['NEW', src], ['OLD', fs.readFileSync(__dirname + '/old.rules', 'utf8')]]) {
  const body = { source: { files: [{ name: 'firestore.rules', content: file }] }, testSuite: { testCases: cases.map((c) => c[1]) } };
  const r = await (await fetch(`https://firebaserules.googleapis.com/v1/projects/${P}:test`, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (r.error) return note('Test API error', r.error.message);
  note(lbl, r.testResults.map((tr, i) => cases[i][0] + ': ' + tr.state + ' ' + (tr.debugMessages || []).join(' | ').slice(0, 160)).join(' || '));
  }
  return;
  if (r.error) return note('Test API error', r.error.message);
  const tr = r.testResults[0];
  note('Verdict', tr.state + ' · ' + (tr.debugMessages || []).join(' | '));
  note('Calls', (tr.functionCalls || []).map((c) => c.function + '(' + JSON.stringify(c.args).slice(60, 140) + ')').join(' ; '));
  const ex = (tr.visitedExpressions || []).filter((e) => e.value && e.value.boolValue === false).slice(0, 40).map((e) => e.sourcePosition.line + ':' + e.sourcePosition.column).join(' ');
  note('False expressions (line:col)', ex);
  if (tr.errorPosition) note('Error at', JSON.stringify(tr.errorPosition));
})().catch((e) => note('Diag2 error', e.message));
