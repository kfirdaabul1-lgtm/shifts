const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);const SEND=process.env.SEND==='1'||false;
const waIdFrom = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '972' + d.slice(1); else if (d.length === 9 && d[0] === '5') d = '972' + d; return d.length >= 11 && d.length <= 15 ? d : ''; };
(async()=>{
 const cs=await db.collection('waChats').get();
 for(const c of cs.docs){const ms=await c.ref.collection('msgs').get();n('chat '+c.id.slice(-4)+' name='+(c.data().name||'')+' lead='+(c.data().leadId||'')+' msgs='+ms.size+' out='+ms.docs.filter(m=>m.data().dir==='out').length)}
 const ls=await db.collection('leads').where('venue','==','boheme').get();const seen=new Set();let send=0,skip=[];
 for(const d of ls.docs){const l=d.data(),to=waIdFrom(l.phone);
  if(!to){skip.push(l.name+' (no phone)');continue}
  if(seen.has(to)){skip.push(l.name+' (dup phone)');continue}seen.add(to);
  const c=cs.docs.find(x=>x.id===to);
  if(c){const ms=await c.ref.collection('msgs').where('dir','==','out').get();if(!ms.empty){skip.push(l.name+' (already messaged)');continue}}
  send++;
 }
 n('would send='+send+' skip='+JSON.stringify(skip));
})().catch(e=>n('ERR '+e.message));
