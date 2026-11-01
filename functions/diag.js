const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);
(async()=>{
 const a=(await db.doc('waauto/main').get()).data()||{};
 n('waauto on='+a.on+' metaOnly='+a.metaOnly+' rules='+JSON.stringify(Object.fromEntries(Object.entries(a.rules||{}).map(([k,v])=>[k,{tpl:v.tpl,lang:v.lang,params:(v.params||[]).map(p=>p.src)}]))));
 const p=(await db.doc('wapub/main').get()).data()||{};
 n('wapub on='+p.on+' tpls='+JSON.stringify((p.templates||[]).map(t=>[t.name,t.lang,t.n])));
 const ls=await db.collection('leads').get();const st={};let ph=0,auto=0,tot=0;const conns={};
 ls.forEach(d=>{const l=d.data();conns[(l.venue||'-')+'|'+(l.metaConnName||'-')]=(conns[(l.venue||'-')+'|'+(l.metaConnName||'-')]||0)+1;
  if(l.venue!=='boheme')return;tot++;st[l.stage]=(st[l.stage]||0)+1;if(l.phone)ph++;if(l.waAutoAt)auto++;});
 n('by venue|conn '+JSON.stringify(conns));
 n('boheme total='+tot+' phone='+ph+' alreadyAuto='+auto+' stages='+JSON.stringify(st));
 const cs=await db.collection('waChats').get();n('chats='+cs.size);
})().catch(e=>n('ERR '+e.message));
