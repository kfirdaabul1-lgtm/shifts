// WhatsApp chat diagnosis (Nov 22): prints booleans/counts/venue ids only (public Actions logs).
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
(async()=>{
  const id=process.env.CHAT||'972545241110';
  const s=await db.doc('waChats/'+id).get();
  console.log('chat exists='+s.exists);
  if(s.exists){const c=s.data()||{};const ag=c.agent;
    console.log('keys='+Object.keys(c).sort().join(','));
    console.log('agent='+(ag===undefined?'MISSING':ag===''?'empty':'set')+' venue='+JSON.stringify(c.venue===undefined?'MISSING':c.venue)+' leadId='+(c.leadId?'yes':'no')+' cat='+(c.cat||'')+' recruit='+!!c.recruit+' aiAgent='+(c.aiAgent?'yes':'no')+' createdBy='+(c.createdBy?(String(c.createdBy).length>20?'uid':c.createdBy):'none'));
    if(c.leadId){const l=await db.doc('leads/'+c.leadId).get();console.log('lead exists='+l.exists+(l.exists?' leadVenue='+JSON.stringify(l.data().venue||'')+' cat='+(l.data().cat||''):''))}
    const m=await db.collection('waChats/'+id+'/msgs').get();const st={};m.forEach(d=>{const x=d.data();const k=(x.dir||'')+'/'+(x.status||'')+'/'+(x.type||'');st[k]=(st[k]||0)+1});console.log('msgs='+m.size+' '+JSON.stringify(st));
  }
  const all=await db.collection('waChats').get();let miss=0,noVen=0;all.forEach(d=>{const x=d.data();if(x.agent===undefined)miss++;if(x.venue===undefined)noVen++});
  console.log('all chats='+all.size+' missing agent='+miss+' missing venue='+noVen);
  const rs=await db.collection('roles').get();let lh=0,lhAll=0;rs.forEach(d=>{const r=d.data()||{};if(r.station)return;if((r.apps||{}).leads){lh++;if(!(r.hotels||[]).length)lhAll++}});
  console.log('roles with leads='+lh+' (all-hotel '+lhAll+')');
  process.exit(0)})().catch(e=>{console.log('ERR '+String(e.message).slice(0,200));process.exit(1)});
