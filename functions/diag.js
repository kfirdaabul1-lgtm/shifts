const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);
(async()=>{
 const ref=db.doc('metacfg/main'),m=(await ref.get()).data()||{};
 const fix={cmvxmpgij:['61596331071334','557151920186636'],cmvjf4ls4:['1018241800217422','757094116968041']};
 const up={};for(const [id,[from,to]] of Object.entries(fix)){const c=(m.conns||{})[id];if(c&&String(c.adAccount)===from){up['conns.'+id+'.adAccount']=to;n('fix '+c.name+' '+from+' -> '+to)}}
 if(Object.keys(up).length){up.syncReq=Date.now();await ref.update(up)}
 await new Promise(r=>setTimeout(r,60000));
 const cs=await db.collection('campaigns').where('week','==','2026-11-01').get();n('this week '+cs.size+' '+cs.docs.map(d=>(d.data().name||'').slice(0,25)+':'+Math.round(d.data().spend||0)).join(' | '));
 const all=await db.collection('campaigns').get();n('total campaign reports '+all.size);
 const m2=(await ref.get()).data()||{};for(const [id,c] of Object.entries(m2.cst||{}))n('st '+id+' '+JSON.stringify({c:c.status&&c.status.campaigns,r:c.status&&c.status.reports,e:c.status&&c.status.insErr}));
})().catch(e=>n('ERR '+e.message));
