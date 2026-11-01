const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);
(async()=>{const ms=await db.collectionGroup('msgs').where('src','==','auto').get();const st={},err={};
 ms.forEach(m=>{const x=m.data();st[x.status]=(st[x.status]||0)+1;if(x.err||x.error)err[String(x.err||x.error).slice(0,120)]=(err[String(x.err||x.error).slice(0,120)]||0)+1});
 n('status '+JSON.stringify(st)+' errs '+JSON.stringify(err));})().catch(e=>n('ERR '+e.message));
