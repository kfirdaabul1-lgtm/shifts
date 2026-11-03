const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const n=s=>console.log('::notice::'+String(s).replace(/\n/g,' '));
(async()=>{
  const ag={};(await db.collection('agents').get()).forEach(d=>ag[d.id]=d.data().name);
  (await db.collection('priceLists').get()).forEach(d=>{const l=d.data();n(`PL ${d.id} "${l.name}" hotel=${l.hotel||''} ${l.from||''}..${l.to||''} active=${l.active} agents=${JSON.stringify((l.agentIds||[]).map(a=>ag[a]||a))} legacy=${l.agentId||''} grid=${Object.keys(l.grid||{}).join(',')} mgrid=${Object.keys(l.mgrid||{}).join(',')} rows=${(l.rows||[]).length}`)});
  const hs={};(await db.collection('hotels').get()).forEach(d=>hs[d.id]=d.data().name);n('hotels '+JSON.stringify(hs));
  const gs=(await db.collection('groups').get()).docs.map(d=>d.data()).filter(g=>g.source!=='import');gs.forEach(g=>n(`G manual hotel=${g.hotel} agent=${ag[g.agentId]||g.agentId} ${g.ci}..${g.co} pl=${g.plId||''} noPl=${g.noPl}`));
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
