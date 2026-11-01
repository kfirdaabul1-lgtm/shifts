const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);
(async()=>{
 const hs=await db.collection('hotels').get();for(const h of hs.docs){const s=(await db.doc('settings/'+h.id).get()).data()||{};n('hotel '+h.id+' '+h.data().name+' venues='+JSON.stringify(s.venues||[])+' spaces='+JSON.stringify(s.spaces||[]))}
 const o=(await db.doc('orgcfg/main').get()).data()||{};n('org venues '+JSON.stringify((o.venues||[]).map(v=>[v.id,v.name])));
 const rs=await db.collection('roles').get();for(const r of rs.docs){const d=r.data();if(!(d.apps&&(d.apps.events||d.apps.mkt)))continue;const e=(await db.doc('employees/'+r.id).get()).data()||{};n('role '+(e.name||d.name||r.id.slice(0,5))+' home='+(e.hotel||'')+' hotels='+JSON.stringify(d.hotels||[])+' job='+(d.jobName||'')+' events='+!!d.apps.events+' mkt='+!!d.apps.mkt)}
 const ls=await db.collection('leads').get();const v={};ls.forEach(d=>{const x=d.data().venue||'-';v[x]=(v[x]||0)+1});n('lead venues '+JSON.stringify(v));
})().catch(e=>n('ERR '+e.message));
