const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const n=(s)=>console.log('::notice::'+String(s).replace(/\n/g,' '));
const SEND=process.env.SEND==='1'||false;
const g=(x)=>/ספא|spa|עיסוי|massage|טיפולי|טיפול זוגי|wellness/i.test(x)?'spa':/חדר|חדרים|room|לינה|נופש|חופש|stay|night|לילה|לילות|סוויט|suite|booking|הזמנת מלון/i.test(x)?'rooms':'';
(async()=>{
 const a=(await db.doc('waauto/main').get()).data()||{};n('waauto rules: '+JSON.stringify(a.rules||{}).slice(0,600));
 const pub=(await db.doc('wapub/main').get()).data()||{};const t=(pub.templates||[]).find(x=>x.name==='gutman_spa');n('tpl: '+JSON.stringify(t));
 const m=((await db.doc('leadcats/main').get()).data()||{}).campCat||{};n('campCat: '+JSON.stringify(m));
 const ls=await db.collection('leads').get();const spa=[];
 ls.forEach(d=>{const l=d.data();let c=l.cat||m[String(l.campaign||'').trim()]||g(String(l.campaign||''))||g([l.type,l.notes].join(' '))||'events';if(c==='spa')spa.push([d.id,l])});
 n('spa leads: '+spa.length);
 for(const [id,l] of spa){const acts=(l.acts||[]).filter(x=>x.kind==='whatsapp').map(x=>x.text).join(' | ');n(id+' · '+(l.name||'')+' · '+(l.phone||'')+' · venue='+(l.venue||'')+' · stage='+(l.stage||'')+' · camp='+(l.campaign||'')+' · wa: '+acts.slice(0,120))}
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
