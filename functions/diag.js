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
  const pub=(await db.doc('wapub/main').get()).data()||{},t=(pub.templates||[]).find(x=>x.name==='gutman_lead_reply');if(!t)throw new Error('no template');
  const now=Date.now(),cref=db.doc('waChats/'+to);
  if(!c)await cref.set({waId:to,phone:'0'+to.slice(3),name:l.name||'',leadId:d.id,createdAt:now,createdBy:'auto',unread:0,status:'open'});else if(!c.data().leadId)await cref.set({leadId:d.id},{merge:true});
  await cref.collection('msgs').add({dir:'out',type:'template',tpl:{name:t.name,lang:t.lang,params:[]},text:String(t.body||''),status:'queued',by:'auto',byName:'הודעה אוטומטית',at:now,src:'auto'});
  await d.ref.update({waAutoAt:now,acts:admin.firestore.FieldValue.arrayUnion({at:now,by:'auto',byName:'אוטומטי',kind:'whatsapp',text:'נשלחה הודעת וואטסאפ (gutman_lead_reply) · שליחה ללידים קיימים'})});
  send++;await new Promise(r=>setTimeout(r,400));
 }
 n('sent='+send+' skip='+JSON.stringify(skip));
})().catch(e=>n('ERR '+e.message));
