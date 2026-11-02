const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const n=(s)=>console.log('::notice::'+String(s).replace(/\n/g,' '));
const waIdFrom=(p)=>{let d=String(p||'').replace(/\D/g,'');if(d.startsWith('0'))d='972'+d.slice(1);return d.length>=11&&d.length<=13?d:''};
(async()=>{
 const pub=(await db.doc('wapub/main').get()).data()||{};const t=(pub.templates||[]).find(x=>x.name==='gutman_spa');if(!t)throw new Error('no tpl');
 for(const id of ['meta_29008554892104169','meta_2261550558039055']){
  const ref=db.doc('leads/'+id),l=(await ref.get()).data();const to=waIdFrom(l.phone),now=Date.now();if(!to){n(id+' bad phone');continue}
  const cref=db.doc('waChats/'+to),cs=await cref.get();
  if(cs.exists){const ms=await cref.collection('msgs').where('src','==','auto').get();if(!ms.empty){n(id+' already has auto msg, skip');continue}}
  if(!cs.exists)await cref.set({waId:to,phone:'0'+to.slice(3),name:l.name||'',leadId:id,createdAt:now,createdBy:'auto',unread:0,status:'open',cat:'spa'});
  else await cref.set({leadId:cs.data().leadId||id,cat:'spa'},{merge:true});
  await cref.collection('msgs').add({dir:'out',type:'template',tpl:{name:t.name,lang:t.lang,params:[]},text:t.body,status:'queued',by:'auto',byName:'הודעה אוטומטית',at:now,src:'auto'});
  await ref.update({cat:'spa',waAutoAt:now,acts:admin.firestore.FieldValue.arrayUnion({at:now,by:'auto',byName:'אוטומטי',kind:'whatsapp',text:'נשלחה הודעת וואטסאפ אוטומטית (gutman_spa)'})});
  n(id+' queued to '+to);
 }
 await new Promise(r=>setTimeout(r,25000));
 for(const to of ['972544999456','972509754213']){const ms=await db.collection('waChats/'+to+'/msgs').where('src','==','auto').get();ms.forEach(d=>n(to+' status='+d.data().status+(d.data().error?' err='+d.data().error:'')))}
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
