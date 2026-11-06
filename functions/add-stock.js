const admin = require('firebase-admin'); admin.initializeApp(); const db = admin.firestore();
const HK = ['אקונומיקה','ספריי ניקוי חלונות','קולבים','מטאטא','מקל מטאטא','מגב','יעה','נוזל ניקוי אסלה','נוזל ניקוי פרקט','נוזל ניקוי רצפה','נייר תעשייתי','מטלית מיקרופייבר קטנה','מטלית מיקרופייבר גדולה','כוסות חד״פ חם','סוכר מנות','סוכר חום מנות','סוכרזית מנות'];
const REC = ['כרטיסים לחדרים'];
(async () => {
  const hs = (await db.collection('hotels').get()).docs.map((d) => d.id).filter((h) => h !== 'chain');
  const inv = await db.collection('inventory').get(), have = new Set(inv.docs.map((d) => { const x = d.data(); return x.hotel + '|' + x.dept + '|' + String(x.name || '').trim(); }));
  let n = 0, b = db.batch(); const now = Date.now();
  for (const h of hs) for (const [dept, list] of [['housekeeping', HK], ['reception', REC]]) for (const name of list) {
    if (have.has(h + '|' + dept + '|' + name)) continue;
    b.set(db.collection('inventory').doc('k' + now.toString(36) + Math.random().toString(36).slice(2, 8)), { hotel: h, dept, name, unit: '', qty: 0, min: 0, price: 0, supplier: '', supplierName: '', createdAt: now, updatedAt: now, updatedBy: 'admin' }); n++;
  }
  await b.commit(); console.log('hotels', hs.length, 'added', n);
})().catch((e) => { console.error(e.message); process.exit(1); });
