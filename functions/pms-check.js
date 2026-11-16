// PMS bookings status check — prints ids/counts/booleans only (public Actions logs).
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
(async()=>{
  const c=(await db.doc('bkcfg/main').get()).data()||{};
  console.log('bkcfg: on='+!!c.on+' key='+(c.key?String(c.key).length+' chars':'none')+' lastAt='+(c.lastAt?new Date(c.lastAt).toISOString():'never')+' stats='+JSON.stringify(c.stats||{})+' aiModel='+(c.aiModel||'auto'));
  const m=await db.collection('bkMails').get();console.log('bkMails: '+m.size);
  m.docs.sort((a,b)=>(b.data().at||0)-(a.data().at||0)).slice(0,10).forEach(d=>{const x=d.data();console.log('  mail '+new Date(x.at||0).toISOString()+' ok='+!!x.ok+' by='+(x.by||'')+' why='+(x.why||'')+' hotel='+(x.hotel||'')+' conf='+(x.conf?'yes':'no'))});
  const sk=m.docs.map(d=>d.data()).filter(x=>x.skel).sort((a,b)=>(b.at||0)-(a.at||0))[0];if(sk)console.log('SKELETON (no data, letters→A digits→9) len='+sk.len+'\n'+sk.skel);
  if(process.env.CLEAN==='1'){const all=await db.collection('bookings').get();let n=0;for(const d of all.docs){const x=d.data();if(x.by==='ai'&&x.status!=='cancelled'&&(!x.co||!(x.people>0))){await d.ref.delete();n++}}console.log('cleaned incomplete AI bookings: '+n)}
  {const hc=await db.doc('hkcfg/main').get();console.log('hkcfg main: '+(hc.exists?JSON.stringify({rooms:hc.data().rooms,dorms:hc.data().dorms,beds:hc.data().beds}):'none'))}
  const b=await db.collection('bookings').get();const per={};b.docs.forEach(d=>{const x=d.data();per[x.hotel||'?']=(per[x.hotel||'?']||0)+1});
  console.log('bookings: '+b.size+' '+JSON.stringify(per));
  b.docs.slice(0,10).forEach(d=>{const x=d.data();console.log('  bk hotel='+x.hotel+' status='+x.status+' ci='+x.ci+' co='+x.co+' rooms='+(x.rooms||[]).length+' people='+x.people+' board='+x.board+' guest='+(x.guest?'yes':'no'))});
})().catch(e=>{console.error('ERR '+e.message);process.exit(1)});
