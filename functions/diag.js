const admin=require('firebase-admin');admin.initializeApp({projectId:'hotel-shifts'});const db=admin.firestore();
const n=(s)=>console.log('::notice::'+s);
(async()=>{const w=(await db.doc('wacfg/main').get()).data()||{};n('wacfg appSecret set='+!!w.appSecret+' verify set='+!!w.verify);
 const rs=await db.collection('roles').get();let sh=[],ev=[];rs.forEach(d=>{const r=d.data();if(r.station)return;const a=r.apps||{shifts:true};if(a.shifts&&(r.hotels||[]).length)sh.push(r.name||d.id.slice(0,4));if(a.events)ev.push((r.name||d.id.slice(0,4))+':'+((r.hotels||[]).length?'scoped':'all'))});
 n('scoped shifts managers='+sh.length+' events users='+ev.join(','));
 const u=await db.collection('usernames').get();n('usernames='+u.size);
})().catch(e=>n('ERR '+e.message));
