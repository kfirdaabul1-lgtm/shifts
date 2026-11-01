const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);
(async()=>{await db.doc('metacfg/main').update({syncReq:Date.now()});await new Promise(r=>setTimeout(r,70000));
 const cs=await db.collection('campaigns').where('week','==','2026-11-01').get();n(cs.docs.map(d=>(d.data().name||'').slice(0,22)+' → '+(d.data().venue||'-')+'/'+(d.data().metaConnName||'-')).join(' | '));
})().catch(e=>n('ERR '+e.message));
