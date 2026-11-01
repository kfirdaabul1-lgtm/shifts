const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);
const G='https://graph.facebook.com/v23.0/';
async function g(p,t,q={}){const u=new URL(G+p);u.searchParams.set('access_token',t);for(const[k,v]of Object.entries(q))u.searchParams.set(k,typeof v==='string'?v:JSON.stringify(v));const r=await fetch(u);return r.json();}
(async()=>{
 const m=(await db.doc('metacfg/main').get()).data()||{};
 for(const [id,c] of Object.entries(m.conns||{})){
  const a=await g('me/adaccounts',c.token,{fields:'account_id,name,account_status',limit:'50'});
  n(c.name+' adaccounts: '+(a.error?'ERR '+a.error.message:JSON.stringify((a.data||[]).map(x=>[x.account_id,x.name,x.account_status]))));
  for(const acc of String(c.adAccount||'').split(/[^0-9]+/).filter(Boolean)){
   const r=await g('act_'+acc+'/insights',c.token,{level:'campaign',date_preset:'last_30d',fields:'campaign_name,spend',limit:'100'});
   n(c.name+' act_'+acc+': '+(r.error?'ERR '+r.error.message:(r.data||[]).length+' rows '+JSON.stringify((r.data||[]).map(x=>x.campaign_name.slice(0,25)+':'+x.spend)).slice(0,500)));
   const cp=await g('act_'+acc+'/campaigns',c.token,{fields:'name,effective_status',limit:'100'});
   n(c.name+' campaigns: '+(cp.error?'ERR '+cp.error.message:JSON.stringify((cp.data||[]).filter(x=>x.effective_status==='ACTIVE').map(x=>x.name.slice(0,30))).slice(0,600)));
  }
 }
})().catch(e=>n('ERR '+e.message));
