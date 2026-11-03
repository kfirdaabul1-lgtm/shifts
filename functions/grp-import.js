const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();const zlib=require('zlib'),crypto=require('crypto');
const n=s=>console.log('::notice::'+String(s).replace(/\n/g,' '));
const GO=process.env.MODE==='go';
const norm=s=>String(s||'').toLowerCase().replace(/["'״׳.\s]+/g,' ').trim();
(async()=>{
  const kref=db.doc('backupcfg/importKey');
  if(process.env.MODE==='keygen'){const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
    await kref.set({priv:privateKey.export({type:'pkcs8',format:'pem'}),at:Date.now()});
    console.log(publicKey.export({type:'spki',format:'pem'}));return}
  const E=JSON.parse(require('fs').readFileSync(__dirname+'/grp-import.enc.json','utf8'));const priv=(await kref.get()).data().priv;
  const ak=crypto.privateDecrypt({key:priv,oaepHash:'sha256'},Buffer.from(E.k,'base64'));
  const dc=crypto.createDecipheriv('aes-256-gcm',ak,Buffer.from(E.iv,'base64'));dc.setAuthTag(Buffer.from(E.tag,'base64'));
  const G=JSON.parse(zlib.gunzipSync(Buffer.concat([dc.update(Buffer.from(E.d,'base64')),dc.final()])).toString());
  const hs=(await db.collection('hotels').get()).docs.map(d=>({id:d.id,name:String(d.data().name||'')}));
  const find=(re,not)=>{const h=hs.find(h=>re.test(h.name.toLowerCase())&&!(not&&not.test(h.name.toLowerCase())));return h&&h.id};
  const H={'7seas':find(/seas|סיז/),gutman:find(/gutman|גוטמן/),'7even':find(/7even|סבן|seven/,/seas|סיז/)};
  n('hotels '+JSON.stringify(hs.map(h=>h.id+'='+h.name))+' -> '+JSON.stringify(H));
  if(Object.values(H).some(x=>!x))throw new Error('hotel not found');
  const ags={};(await db.collection('agents').get()).forEach(d=>{ags[norm(d.data().name)]=d.id});
  const ex=new Set();(await db.collection('groups').get()).forEach(d=>{const g=d.data();ex.add([g.hotel,g.ci,g.co,norm(g.name)].join('|'))});
  n('existing agents '+Object.keys(ags).length+', groups '+ex.size);
  const now=Date.now();let newAg=0,add=0,skip=0;const batch=[];
  for(const g of G){
    const hotel=H[g.hotel];let aid=ags[norm(g.agent)];
    if(!aid){aid='ag_'+crypto.createHash('md5').update(norm(g.agent)).digest('hex').slice(0,16);ags[norm(g.agent)]=aid;newAg++;
      batch.push(['agents/'+aid,{name:g.agent,company:'',contact:'',phone:'',email:'',country:'',comm:0,terms:'',termsNote:'',notes:'',active:true,createdAt:now,createdBy:'import',createdByName:'ייבוא מקובץ'}])}
    const key=[hotel,g.ci,g.co,norm(g.name)].join('|');if(ex.has(key)){skip++;continue}ex.add(key);
    const id='imp_'+crypto.createHash('md5').update(key+'|'+g.order).digest('hex').slice(0,20);
    batch.push(['groups/'+id,{name:g.name,hotel,agentId:aid,agentName:g.agent,contact:'',ci:g.ci,co:g.co,lines:[],rooms:0,pax:0,cur:'ils',board:'',boardPrice:0,extras:0,extrasNote:'',comm:0,plId:'',plName:'',noPl:false,dueDate:'',deposit:0,origin:'',freeEvery:0,ilDisc:0,vat:18,status:'confirmed',optUntil:'',notes:'',source:'import',createdAt:now,createdBy:'import',createdByName:'ייבוא מקובץ',updatedAt:now,updatedBy:'import'}]);add++;
  }
  n(`rows ${G.length}: new agents ${newAg}, new groups ${add}, already there ${skip}`+(GO?'':' (dry run)'));
  if(!GO)return;
  for(let i=0;i<batch.length;i+=400){const b=db.batch();batch.slice(i,i+400).forEach(([p,d])=>b.set(db.doc(p),d));await b.commit()}
  n('written '+batch.length);await kref.delete();
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
