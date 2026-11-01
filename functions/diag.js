const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);
(async()=>{const cs=await db.collection('waChats').get();const st={},err={};
 for(const c of cs.docs){const ms=await c.ref.collection('msgs').get();ms.forEach(m=>{const x=m.data();if(x.src!=='auto')return;st[x.status]=(st[x.status]||0)+1;const e=x.err||x.error;if(e)err[String(e).slice(0,120)]=(err[String(e).slice(0,120)]||0)+1})}
 n('status '+JSON.stringify(st)+' errs '+JSON.stringify(err));})().catch(e=>n('ERR '+e.message));
