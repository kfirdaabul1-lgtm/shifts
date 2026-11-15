// one-off diag: invoice COUNTS per hotel per month (no amounts, no names of suppliers)
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
(async()=>{const hs={};(await db.collection('hotels').get()).forEach(d=>hs[d.id]=d.data().name||d.id);
const m={};(await db.collection('invoices').get()).forEach(d=>{const v=d.data();const h=hs[v.hotel]||v.hotel||'?';const mo=String(v.date||'').slice(0,7)||'no-date';const src=v.source==='import-tlv-aug26'?'import':(v.source||'manual');const k=h+' | '+mo;m[k]=m[k]||{n:0};m[k].n++;m[k][src]=(m[k][src]||0)+1;});
Object.keys(m).sort().forEach(k=>console.log(k,JSON.stringify(m[k])));})().catch(e=>{console.error(e.message);process.exit(1)});
