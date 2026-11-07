// temporary: check a won lead's link to the weekly social report (prints no client names/phones)
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const loc=t=>{const d=new Date(new Date(t||0).toLocaleString('en-US',{timeZone:'Asia/Jerusalem'}));return d.toISOString().slice(0,10)};
const weekOf=iso=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-d.getUTCDay());return d.toISOString().slice(0,10)};
(async()=>{const q=await db.collection('leads').get();const hits=q.docs.filter(d=>{const l=d.data();return +l.value===3990||+l.wonValue===3990});
 const camps=(await db.collection('campaigns').get()).docs.map(d=>({id:d.id,...d.data()}));
 for(const d of hits){const l=d.data(),w=l.wonAt?weekOf(loc(l.wonAt)):'';
  console.log(JSON.stringify({id:d.id,stage:l.stage,venue:l.venue,cat:l.cat||'',value:l.value,wonValue:l.wonValue||null,wonAt:l.wonAt?loc(l.wonAt):null,week:w,campaign:l.campaign||'(ריק)',source:l.source}));
  const same=camps.filter(c=>(c.week||weekOf(c.start||'2000-01-01'))===w);
  console.log(' reports that week:',same.length,'· with same name:',same.filter(c=>String(c.name||'').trim()===String(l.campaign||'').trim()).map(c=>c.id).join(',')||'none');
  console.log(' names that week (venue',l.venue+'):',same.filter(c=>!c.venue||c.venue===l.venue).map(c=>c.name).join(' | '));}
 if(!hits.length)console.log('no lead with 3990');process.exit(0)})().catch(e=>{console.error(e.message);process.exit(1)});
