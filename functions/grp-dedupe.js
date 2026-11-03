const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const n=s=>console.log('::notice::'+String(s).replace(/\n/g,' '));const GO=process.env.MODE==='go';
const norm=s=>String(s||'').toLowerCase().replace(/[\s\-_"'״׳.]+/g,'');
const score=g=>(g.source==='import'?0:100)+((g.lines||[]).some(l=>+l.rooms)?20:0)+(g.plId?10:0)+(+g.deposit?10:0)+((g.halls||[]).length?10:0)+(g.notes?5:0)+(g.contact?3:0)+(g.origin?3:0);
(async()=>{
  const all=(await db.collection('groups').get()).docs.map(d=>({id:d.id,...d.data()}));
  const sets={};all.forEach(g=>{const k=(g.hotel||'')+'|'+norm(g.name);if(!norm(g.name))return;(sets[k]=sets[k]||[]).push(g)});
  const dup=Object.values(sets).filter(a=>a.length>1);let del=0,adj=0,gap=0,man=0;const upd=[],rm=[];
  for(const a of dup){a.sort((x,y)=>score(y)-score(x)||(x.createdAt||0)-(y.createdAt||0));const keep=a[0];
    const ci=a.map(g=>g.ci).filter(Boolean).sort()[0]||keep.ci,co=a.map(g=>g.co).filter(Boolean).sort().pop()||keep.co;
    const byCi=[...a].sort((x,y)=>(x.ci||'')<(y.ci||'')?-1:1);let contiguous=true;for(let i=1;i<byCi.length;i++)if((byCi[i].ci||'')>(byCi[i-1].co||''))contiguous=false;
    contiguous?adj++:gap++;if(a.some(g=>g.source!=='import'))man++;
    upd.push([keep.id,{ci,co,mergedFrom:a.slice(1).map(g=>g.id),updatedAt:Date.now(),updatedBy:'dedupe'}]);a.slice(1).forEach(g=>{rm.push(g);del++});
    n(`set ${a.length}: ${a.map(g=>(g.source==='import'?'imp':'man')+' '+g.ci+'..'+g.co+' st='+g.status+' rooms='+(g.rooms||0)+(g.halls&&g.halls.length?' halls':'')).join(' | ')} -> keep ${keep.id.slice(0,8)} ${ci}..${co}`)}
  n(`groups ${all.length}, duplicate sets ${dup.length}, contiguous ${adj}, with gaps ${gap}, sets with manual docs ${man}, to delete ${del}`+(GO?'':' (dry)'));
  if(!GO)return;
  const ops=[...upd.map(([id,d])=>b=>b.set(db.doc('groups/'+id),d,{merge:true})),...rm.map(g=>b=>b.delete(db.doc('groups/'+g.id)))];
  for(const g of rm)for(const h of g.halls||[])if(h.qid)ops.push(b=>b.delete(db.doc('quotes/'+h.qid)));
  for(let i=0;i<ops.length;i+=400){const b=db.batch();ops.slice(i,i+400).forEach(f=>f(b));await b.commit()}
  n('done '+ops.length);
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
