// one-off: Tel-Aviv Beach invoices, all other months (Jun 2024 – Nov 2026) → suppliers, invoices, inventory, per hotel (owner, Nov 15). Removed after use.
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();const zlib=require('zlib'),crypto=require('crypto');
const n=s=>console.log('::notice::'+String(s).replace(/\n/g,' '));
const GO=process.env.MODE==='go';
const norm=s=>String(s||'').replace(/בע["״']?מ/g,'').replace(/["'״׳\s.,\-]+/g,'').toLowerCase();
const md5=s=>crypto.createHash('md5').update(s).digest('hex');
const CAT={'F&B COS':'מזון ומשקאות',Rooms:'משק',Maintenance:'אחזקה',Services:'שירותים'};
const DRINK=/משקאות|הכורמים|חינאווי|ג׳וני/;
const top=o=>Object.entries(o).sort((a,b)=>b[1]-a[1])[0][0];
(async()=>{
  const kref=db.doc('backupcfg/importKey');
  if(process.env.MODE==='keygen'){const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
    await kref.set({priv:privateKey.export({type:'pkcs8',format:'pem'}),at:Date.now()});console.log(publicKey.export({type:'spki',format:'pem'}));return}
  const E=JSON.parse(require('fs').readFileSync(__dirname+'/tlv-import.enc.json','utf8'));const priv=(await kref.get()).data().priv;
  const ak=crypto.privateDecrypt({key:priv,oaepHash:'sha256'},Buffer.from(E.k,'base64'));
  const dc=crypto.createDecipheriv('aes-256-gcm',ak,Buffer.from(E.iv,'base64'));dc.setAuthTag(Buffer.from(E.tag,'base64'));
  const D=JSON.parse(zlib.gunzipSync(Buffer.concat([dc.update(Buffer.from(E.d,'base64')),dc.final()])).toString());
  const hs=(await db.collection('hotels').get()).docs.map(d=>({id:d.id,name:String(d.data().name||'')}));
  const find=re=>(hs.find(h=>re.test(h.name))||{}).id;
  const HID={'7EVEN':(hs.find(h=>/7even|סבן|seven/i.test(h.name)&&!/seas|סיז/i.test(h.name))||{}).id,'7SEAS':find(/seas|סיז/i),'Hostel 180':find(/הוסטל|hostel|180/i),'The Gutman':find(/gutman|גוטמן/i)};
  for(const k in HID){if(!HID[k])throw new Error('hotel not found: '+k)}
  const HN={};for(const k in HID)HN[HID[k]]=k;
  n('hotels: '+Object.entries(HID).map(([k,v])=>k+'='+v+' ('+(hs.find(h=>h.id===v).name)+')').join(', '));
  const hOf=x=>HID[x.hotel||'7EVEN'];
  const inv=D.inv;const now=Date.now(),W=[];const C={};const c=(h,k)=>{C[h]=C[h]||{};C[h][k]=(C[h][k]||0)+1};
  // 1) suppliers
  const sups={};(await db.collection('suppliers').get()).forEach(d=>{sups[norm(d.data().name)]={id:d.id,...d.data()}});
  const supId={},names=[...new Set(inv.map(i=>i.supplier))];let supNew=0,supHad=0,supHotel=0;
  for(const name of names){const k=norm(name),mine=inv.filter(i=>i.supplier===name),myH=[...new Set(mine.map(hOf))],ex=sups[k];
    if(ex){supId[name]=ex.id;supHad++;const hl=Array.isArray(ex.hotels)?ex.hotels:[];const add=myH.filter(h=>!hl.includes(h));if(hl.length&&add.length){W.push(['u','suppliers/'+ex.id,{hotels:admin.firestore.FieldValue.arrayUnion(...add),updatedAt:now}]);supHotel++}continue}
    const dc={},pc={};mine.forEach(i=>{dc[i.dept]=(dc[i.dept]||0)+1;pc[i.pay]=(pc[i.pay]||0)+1});
    const id='stlv_'+md5(k).slice(0,16);supId[name]=id;sups[k]={id,hotels:myH};supNew++;myH.forEach(h=>c(h,'supNew'));
    W.push(['s','suppliers/'+id,{name,category:CAT[top(dc)]||'',companyId:'',contact:'',phone:'',email:'',address:'',bank:'',branch:'',account:'',notes:'',hotels:myH,terms:'eom30',payMethod:top(pc)==='card'?'card':'cash',active:true,createdAt:now,updatedAt:now,updatedBy:'import'}])}
  // 2) invoices (skip same supplier + number, also against August and anything already there)
  const have=new Set();(await db.collection('invoices').get()).forEach(d=>{const x=d.data();have.add(x.supplier+'|'+String(x.number||'').trim())});
  let lines=0;const sum={};
  for(const i of inv){const H=hOf(i),sid=supId[i.supplier],num=String(i.number).trim();if(have.has(sid+'|'+num)){c(H,'invDup');continue}have.add(sid+'|'+num);
    const items=i.items.map(x=>({name:x.name,qty:+x.qty||0,unit:x.unit||'',price:x.price==null?0:+x.price,...(x.deposit?{deposit:true}:{})}));lines+=items.length;sum[H]=(sum[H]||0)+i.total;
    const aug=!!i.aug;
    W.push(['s','invoices/itlv_'+md5(sid+'|'+num).slice(0,20),{supplier:sid,hotel:H,date:i.date,dueDate:i.date,number:num,status:'paid',paidAt:i.date,
      payMethod:i.pay==='card'?'card':i.pay==='cash'?'cash':'transfer',payRef:'',vatIncluded:!!i.vatIncluded,vat:+i.vat||18,items,net:i.net,total:i.total,
      notes:(aug?'ייבוא TEL_AVIV · '+i.week+' · '+i.dept:'ייבוא דרייב')+(i.note?' · '+i.note:''),hasImg:false,imgPages:0,sentAt:null,
      source:aug?'import-tlv-aug26':'import-tlv-all',createdBy:'import',updatedBy:'import',createdAt:now,updatedAt:now}]);c(H,'invNew')}
  // 3) inventory (only names not already in that hotel)
  const items={};(await db.collection('inventory').get()).forEach(d=>{const x=d.data();(items[x.hotel]=items[x.hotel]||new Set()).add(norm(x.name))});
  for(const p of D.prod){const H=hOf(p),k=norm(p.name),S=(items[H]=items[H]||new Set());if(S.has(k)){c(H,'prHad');continue}S.add(k);
    const dept=p.dept==='Rooms'?'housekeeping':p.dept==='Maintenance'?'maintenance':p.dept==='Services'?'reception':DRINK.test(p.supplier)?'bar':'kitchen';
    const price=p.last==null?0:Math.round((p.vatInc?p.last/1.18:p.last)*100)/100;
    W.push(['s','inventory/ptlv_'+md5(H+'|'+k).slice(0,20),{hotel:H,dept,name:p.name,unit:p.unit,qty:0,min:0,price,supplier:supId[p.supplier]||'',supplierName:p.supplier,createdAt:now,updatedAt:now,updatedBy:'import',source:'import-tlv-all'}]);c(H,'prNew')}
  n(`suppliers: new ${supNew}, existing ${supHad} (hotels added to ${supHotel}) | invoice lines ${lines}`+(GO?'':' (dry run)'));
  for(const h in C)n(HN[h]+': suppliers new '+(C[h].supNew||0)+' | invoices new '+(C[h].invNew||0)+' (₪'+Math.round((sum[h]||0)*100)/100+'), duplicates skipped '+(C[h].invDup||0)+' | products new '+(C[h].prNew||0)+', already there '+(C[h].prHad||0));
  if(!GO)return;
  for(let i=0;i<W.length;i+=400){const b=db.batch();W.slice(i,i+400).forEach(([t,p,d])=>t==='u'?b.update(db.doc(p),d):b.set(db.doc(p),d));await b.commit()}
  n('written '+W.length);await kref.delete();
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
