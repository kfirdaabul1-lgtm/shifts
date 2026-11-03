const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const n=s=>console.log('::notice::'+String(s).replace(/\n/g,' '));
const M=[['amvkmhad9igho','טללים',['ag_c2ddc9a275478c57']],['amw0nsqgr6i4q','החוויה הישראלית',['ag_c21f8a17c6ad109d']],['amw0q4wvouzi6','מסע יהודי',['ag_7dd33b3c7bda9818']],
['amw0q2ujgih3l','ISRAEL WAY',['ag_8d6364c7f83573b7']],['amw0qb34w6xl5','SAR EL',['ag_8271a04c25e39418']],['amw0qanc081so','מרכז קשת',['ag_da3f3ffc95dc59d6']],
['amw0qeb2gvnkp','S.K',['ag_275a47e2e37e2fe6']],['amw0qethf80j8','יהודה הצעיר',['ag_b24e95e3b1ae2193']]];
const PLMOVE={plmw0u7rb3tv92:'amw0nsqgr6i4q'};
(async()=>{
  const map={},name={};M.forEach(([k,nm,fr])=>{name[k]=nm;fr.forEach(f=>map[f]=k)});
  for(const [k] of M){const s=await db.doc('agents/'+k).get();if(!s.exists)throw new Error('missing '+k)}
  const ops=[];let gN=0,pN=0;
  (await db.collection('groups').get()).forEach(d=>{const g=d.data(),to=map[g.agentId]||(name[g.agentId]?g.agentId:null);if(to){ops.push(b=>b.update(d.ref,{agentId:to,agentName:name[to]}));gN++}});
  (await db.collection('priceLists').get()).forEach(d=>{const l=d.data();let a=Array.isArray(l.agentIds)&&l.agentIds.length?l.agentIds:(l.agentId?[l.agentId]:[]);
    let b2=a.map(x=>map[x]||x);if(PLMOVE[d.id])b2=[PLMOVE[d.id]];b2=[...new Set(b2)];
    if(JSON.stringify(b2)!==JSON.stringify(l.agentIds||null)||l.agentId){ops.push(b=>b.update(d.ref,{agentIds:b2,agentId:''}));pN++}});
  M.forEach(([k,nm,fr])=>{ops.push(b=>b.update(db.doc('agents/'+k),{name:nm,updatedAt:Date.now()}));fr.forEach(f=>ops.push(b=>b.delete(db.doc('agents/'+f))))});
  for(let i=0;i<ops.length;i+=400){const b=db.batch();ops.slice(i,i+400).forEach(f=>f(b));await b.commit()}
  n(`groups updated ${gN}, price lists updated ${pN}, agents renamed ${M.length}, agents deleted ${M.reduce((a,x)=>a+x[2].length,0)}`);
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
