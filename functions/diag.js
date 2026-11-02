const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const n=(s)=>console.log('::notice::'+String(s).replace(/\n/g,' '));
(async()=>{
 const p=(await db.doc('wapub/main').get()).data()||{};n('wapub at '+new Date(p.at||0).toISOString()+' on='+p.on+' tpls='+(p.templates||[]).map(t=>t.name+'/'+t.lang).join(', '));
 const c=(await db.doc('wacfg/main').get()).data()||{};const st=c.status||{};n('status '+JSON.stringify({at:new Date(st.at||0).toISOString(),ok:st.ok,msg:st.msg,templates:st.templates,phone:st.phone}));
 if(c.token&&c.wabaId){const r=await fetch('https://graph.facebook.com/v23.0/'+c.wabaId+'/message_templates?fields=name,language,status,category,rejected_reason&limit=200',{headers:{Authorization:'Bearer '+c.token}});const j=await r.json();
  if(j.error)n('graph err '+j.error.message);else n('graph: '+(j.data||[]).map(t=>t.name+'/'+t.language+'='+t.status+(t.rejected_reason&&t.rejected_reason!=='NONE'?'('+t.rejected_reason+')':'')).join(', '));}
 await db.doc('wacfg/main').set({syncReq:Date.now()},{merge:true});n('sync requested');
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
