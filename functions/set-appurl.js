// Sets orgcfg/main.appUrl (push links / WhatsApp links use it). Usage: node set-appurl.js https://app.example.com/
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
(async () => {
  const u = process.argv[2]; const ref = admin.firestore().doc('orgcfg/main'); const d = await ref.get();
  const old = d.exists ? d.data().appUrl : '';
  if (old !== u) await ref.set({ appUrl: u }, { merge: true });
  console.log(`::notice title=appUrl::${old || '(none)'} -> ${u}`);
})().catch((e) => console.log('::notice title=appUrl::failed ' + e.message));
