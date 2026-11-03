const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const n=s=>console.log('::notice::'+String(s).replace(/\n/g,' '));const GO=process.env.MODE==='go';
const norm=s=>String(s||'').toLowerCase().replace(/[\s\-_"'״׳.]+/g,'');
const score=g=>(g.source==='import'?0:100)+((g.lines||[]).some(l=>+l.rooms)?20:0)+(g.plId?10:0)+(+g.deposit?10:0)+((g.halls||[]).length?10:0)+(g.notes?5:0)+(g.contact?3:0)+(g.origin?3:0);
(async()=>{
  const all=(await db.collection('groups').get()).docs.map(d=>({id:d.id,...d.data()}));
  const sets={};all.forEach(g=>{const k=(g.hotel||'')+'|'+norm(g.name);if(!norm(g.name))return;(sets[k]=sets[k]||[]).push(g)});
  const add1=d=>{const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+1);return t.toISOString().slice(0,10)};
  const dup=[];let del=0;const upd=[],rm=[];
  for(const a of Object.values(sets)){if(a.length<2)continue;const s2=[...a].filter(g=>g.ci&&g.co).sort((x,y)=>x.ci<y.ci?-1:1);let cl=[];
    const flush=()=>{if(cl.length>1)dup.push(cl);cl=[]};
    for(const g of s2){if(cl.length&&g.ci<=add1(cl.reduce((m,x)=>x.co>m?x.co:m,''))){cl.push(g)}else{flush();cl=[g]}}flush()}
  for(const a of dup){a.sort((x,y)=>score(y)-score(x)||(x.createdAt||0)-(y.createdAt||0));const keep=a[0];
    const ci=a.map(g=>g.ci).sort()[0],co=a.map(g=>g.co).sort().pop();
    upd.push([keep.id,{ci,co,mergedFrom:a.slice(1).map(g=>g.id),updatedAt:Date.now(),updatedBy:'dedupe'}]);a.slice(1).forEach(g=>{rm.push(g);del++});
    n(`merge ${a.length}: ${a.map(g=>(g.source==='import'?'imp':'man')+' '+g.ci+'..'+g.co+' rooms='+(g.rooms||0)).join(' | ')} -> ${ci}..${co}`)}
  n(`groups ${all.length}, merged sets ${dup.length}, to delete ${del}`+(GO?'':' (dry)'));
  if(!GO)return;
  const ops=[...upd.map(([id,d])=>b=>b.set(db.doc('groups/'+id),d,{merge:true})),...rm.map(g=>b=>b.delete(db.doc('groups/'+g.id)))];
  for(const g of rm)for(const h of g.halls||[])if(h.qid)ops.push(b=>b.delete(db.doc('quotes/'+h.qid)));
  for(let i=0;i<ops.length;i+=400){const b=db.batch();ops.slice(i,i+400).forEach(f=>f(b));await b.commit()}
  n('done '+ops.length);
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
