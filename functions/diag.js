const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);
(async()=>{const qs=await db.collection('quotes').get();let m=1000;const byV={};qs.forEach(d=>{const x=d.data();m=Math.max(m,+x.num||0);const v=(x.event||{}).venue||'-';byV[v]=(byV[v]||0)+1});
 const ref=db.doc('qcounter/main'),c=(await ref.get()).data()||{};const nn=Math.max(m,c.n||0);await ref.set({n:nn,at:Date.now()});n('max num '+m+' counter '+nn+' quotes by venue '+JSON.stringify(byV));
})().catch(e=>n('ERR '+e.message));
