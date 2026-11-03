const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const n=s=>console.log('::notice::'+String(s).replace(/\n/g,' '));
(async()=>{
  const ag=(await db.collection('agents').get()).docs.map(d=>({id:d.id,...d.data()}));
  ag.forEach(a=>n(`AG ${a.id} "${a.name}" active=${a.active} src=${a.createdBy||''}`));
  const gs=(await db.collection('groups').where('name','==','TL VL 55-633').get()).docs;gs.forEach(d=>{const g=d.data();n(`G ${d.id} hotel=${g.hotel} agent=${g.agentId} ${g.ci}..${g.co} pl=${g.plId||''}`)});
  (await db.collection('priceLists').get()).forEach(d=>{const l=d.data();n(`PL ${d.id} "${l.name}" hotel=${l.hotel||''} ${l.from||''}..${l.to||''} active=${l.active} agentIds=${JSON.stringify(l.agentIds||null)} agentId=${l.agentId||''}`)});
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
