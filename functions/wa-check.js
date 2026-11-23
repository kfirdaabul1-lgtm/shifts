// WhatsApp chat diagnosis (Nov 22): prints booleans/counts/venue ids only (public Actions logs).
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
(async()=>{
  let id=process.env.CHAT||'972545241110';
  if(id==='owner'){ // Nov 23: which name sources exist for the owner (booleans only) + failed agent_name messages
    const o=(await db.doc('orgcfg/main').get()).data()||{},em=String(o.ownerEmail||'kfirdaabul1@gmail.com').toLowerCase();
    const u=await admin.auth().getUserByEmail(em).catch(()=>null);console.log('owner auth='+!!u+' verified='+!!(u&&u.emailVerified)+' displayName='+!!(u&&u.displayName));
    if(u){const e=await db.doc('employees/'+u.uid).get(),r=await db.doc('roles/'+u.uid).get();console.log('employee doc='+e.exists+' emp name='+!!(e.exists&&e.data().name)+' role doc='+r.exists+' role name='+!!(r.exists&&r.data().name)+' orgcfg ownerName='+!!o.ownerName)}
    const ch=await db.collection('waChats').orderBy('lastAt','desc').limit(80).get();let f=0;for(const d of ch.docs){const m=await d.ref.collection('msgs').where('status','==','failed').get();m.forEach(x=>{if(/agent_name/.test(String(x.data().error||'')))f++})}
    console.log('failed agent_name msgs (last 80 chats)='+f);process.exit(0)}
  if(id.startsWith('name:')){const q=id.slice(5).toLowerCase();const all0=await db.collection('waChats').get();const f=all0.docs.find(d=>String((d.data()||{}).name||'').toLowerCase().includes(q));id=f?f.id:'none';console.log('found by name='+(f?'yes':'no'))}
  const s=await db.doc('waChats/'+id).get();
  console.log('chat exists='+s.exists);
  if(s.exists){const c=s.data()||{};const ag=c.agent;
    console.log('catAuto='+(c.catAuto||'')+' adRef='+(c.adRef?'yes':'no')+' catBy='+(c.catBy?'set':'')+' catAt='+(c.catAt?new Date(c.catAt).toISOString():'')+' aiAgent='+JSON.stringify(Object.keys(c.aiAgent||{})));console.log('keys='+Object.keys(c).sort().join(','));
    console.log('agent='+(ag===undefined?'MISSING':ag===''?'empty':'set')+' venue='+JSON.stringify(c.venue===undefined?'MISSING':c.venue)+' leadId='+(c.leadId?'yes':'no')+' cat='+(c.cat||'')+' recruit='+!!c.recruit+' aiAgent='+(c.aiAgent?'yes':'no')+' createdBy='+(c.createdBy?(String(c.createdBy).length>20?'uid':c.createdBy):'none'));
    if(c.leadId){const l=await db.doc('leads/'+c.leadId).get();console.log('lead exists='+l.exists+(l.exists?' leadVenue='+JSON.stringify(l.data().venue||'')+' cat='+(l.data().cat||'')+' src='+(l.data().source||'')+' camp='+(l.data().campaign?'yes':'no')+' type='+(l.data().type?'yes':'no'):''))}
    const m=await db.collection('waChats/'+id+'/msgs').get();const st={};m.forEach(d=>{const x=d.data();const k=(x.dir||'')+'/'+(x.status||'')+'/'+(x.type||'');st[k]=(st[k]||0)+1});console.log('msgs='+m.size+' '+JSON.stringify(st));
  }
  const all=await db.collection('waChats').get();let miss=0,noVen=0;all.forEach(d=>{const x=d.data();if(x.agent===undefined)miss++;if(x.venue===undefined)noVen++});
  console.log('all chats='+all.size+' missing agent='+miss+' missing venue='+noVen);
  const rs=await db.collection('roles').get();let lh=0,lhAll=0;rs.forEach(d=>{const r=d.data()||{};if(r.station)return;if((r.apps||{}).leads){lh++;if(!(r.hotels||[]).length)lhAll++}});
  console.log('roles with leads='+lh+' (all-hotel '+lhAll+')');
  process.exit(0)})().catch(e=>{console.log('ERR '+String(e.message).slice(0,200));process.exit(1)});
