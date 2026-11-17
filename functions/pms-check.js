// PMS bookings status check — prints ids/counts/booleans only (public Actions logs).
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
(async()=>{
  const c=(await db.doc('bkcfg/main').get()).data()||{};
  console.log('bkcfg: on='+!!c.on+' key='+(c.key?String(c.key).length+' chars':'none')+' lastAt='+(c.lastAt?new Date(c.lastAt).toISOString():'never')+' stats='+JSON.stringify(c.stats||{})+' aiModel='+(c.aiModel||'auto'));
  const m=await db.collection('bkMails').get();console.log('bkMails: '+m.size);
  m.docs.sort((a,b)=>(b.data().at||0)-(a.data().at||0)).slice(0,10).forEach(d=>{const x=d.data();console.log('  mail '+new Date(x.at||0).toISOString()+' ok='+!!x.ok+' by='+(x.by||'')+' why='+(x.why||'')+' hotel='+(x.hotel||'')+' conf='+(x.conf?'yes':'no'))});
  const sk=m.docs.map(d=>d.data()).filter(x=>x.skel).sort((a,b)=>(b.at||0)-(a.at||0))[0];if(sk)console.log('SKELETON (no data, letters→A digits→9) len='+sk.len+'\n'+sk.skel);
  if(process.env.CLEAN==='1'){const all=await db.collection('bookings').get();let n=0;for(const d of all.docs){const x=d.data();if(x.by==='ai'&&x.status!=='cancelled'&&(!x.co||!(x.people>0))){await d.ref.delete();n++}}console.log('cleaned incomplete AI bookings: '+n)}
  {const r0=await db.doc('hkcfg/main').get();if(r0.exists&&r0.data().dorms==='101-111 -108,110'){await db.doc('hkcfg/main').update({dorms:'101-111 -108 -110'});console.log('fixed hostel dorms')}}
  {const hc=await db.doc('hkcfg/main').get();console.log('hkcfg main: '+(hc.exists?JSON.stringify({rooms:hc.data().rooms,dorms:hc.data().dorms,beds:hc.data().beds}):'none'))}
  {const all=await db.collection('bookings').get();for(const d of all.docs){const x=d.data(),h=x.hist||[];const c=h.filter(e=>e.action==='cancel');if(c.length&&x.status!=='cancelled'){await d.ref.update({status:'cancelled',cancelMt:Math.max(...c.map(e=>e.at||0))});console.log('re-cancelled one booking')}}}
  if(process.env.CLEAN==='bkhk'){const hs=await db.collection('hotels').get();for(const hd of hs.docs){const h=hd.id;const dd=await db.doc('hkday/'+h).get();const day=(dd.exists&&dd.data().date)||new Date().toISOString().slice(0,10);
    const q=await db.collection('bookings').where('hotel','==',h).get();const bk={};q.forEach(d=>{const x=d.data();if(x.status!=='cancelled'&&/booking/i.test(String(x.channel||''))&&x.ci&&x.ci<=day&&(x.co?day<x.co:day===x.ci))(x.rooms||[]).forEach(r=>{const n=String(r.room||'').trim();if(/^[\w-]{1,10}$/.test(n))bk[n]=true})});
    if(Object.keys(bk).length)await db.doc('hk/'+h+'__'+day).set({hotel:h,date:day,updatedAt:Date.now(),lastBy:'bk',bk},{merge:true});console.log('bk tags '+h+' '+day+': '+Object.keys(bk).length)}}
  const b=await db.collection('bookings').get();const per={};b.docs.forEach(d=>{const x=d.data();per[x.hotel||'?']=(per[x.hotel||'?']||0)+1});
  console.log('bookings: '+b.size+' '+JSON.stringify(per));
  b.docs.slice(0,10).forEach(d=>{const x=d.data();console.log('  bk hotel='+x.hotel+' status='+x.status+' ci='+x.ci+' co='+x.co+' rooms='+(x.rooms||[]).length+' people='+x.people+' board='+x.board+' guest='+(x.guest?'yes':'no'))});
})().catch(e=>{console.error('ERR '+e.message);process.exit(1)});
