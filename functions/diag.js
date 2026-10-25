const admin = require('firebase-admin'); admin.initializeApp({ projectId: 'hotel-shifts' }); const db = admin.firestore();
(async () => { const b = (await db.doc('backupcfg/main').get()).data() || {};
console.log(`::notice title=Backup::lastAt ${b.lastAt ? new Date(b.lastAt).toISOString() : 'never'} · lastCount ${b.lastCount || '-'}`); })();
