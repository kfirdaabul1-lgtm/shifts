const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);
(async()=>{
 const m=(await db.doc('metacfg/main').get()).data()||{};
 for(const [id,c] of Object.entries(m.conns||{}))n('conn '+id+' '+c.name+' ad='+(c.adAccount||'-')+' venue='+(c.venue||'')+' st='+JSON.stringify(((m.cst||{})[id]||{}).status||{}).slice(0,300)+' insAt='+(((m.cst||{})[id]||{}).insAt||''));
 const cs=await db.collection('campaigns').get();const by={};cs.forEach(d=>{const x=d.data();const k=x.week||'?';(by[k]=by[k]||[]).push((x.name||'').slice(0,30)+':'+Math.round(x.spend||0))});
 for(const w of Object.keys(by).sort().slice(-3))n('week '+w+' n='+by[w].length+' '+by[w].join(' | ').slice(0,700));
})().catch(e=>n('ERR '+e.message));
