// one-off diag: inventory counts per hotel and source (counts only)
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
(async()=>{const hs={};(await db.collection('hotels').get()).forEach(d=>hs[d.id]=d.data().name||d.id);const m={};
(await db.collection('inventory').get()).forEach(d=>{const v=d.data();const k=(hs[v.hotel]||v.hotel)+' | '+(v.source||'manual')+' | '+(v.dept||'');m[k]=(m[k]||0)+1});
Object.keys(m).sort().forEach(k=>console.log('::notice::'+k+' = '+m[k]))})().catch(e=>{console.error(e.message);process.exit(1)});
