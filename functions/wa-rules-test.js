// Rules test (Nov 22): can each kind of user create a queued template message in a WhatsApp chat?
// Uses the Firebase Rules test API with real docs as mocks — nothing is written. Prints PASS/FAIL + role shape only.
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();const fs=require('fs');
const P='hotel-shifts',D='/databases/(default)/documents/';
(async()=>{
  const tok=(await admin.credential.applicationDefault().getAccessToken()).access_token;
  const src=fs.readFileSync(__dirname+'/../firestore.rules','utf8');
  const chatId=process.env.CHAT||'972545241110';
  const org=(await db.doc('orgcfg/main').get()).data()||{};const owner=org.ownerEmail||'kfirdaabul1@gmail.com';
  const cs=await db.doc('waChats/'+chatId).get();const chat=cs.exists?cs.data():null;
  const sets={};(await db.collection('settings').get()).forEach(d=>{sets[d.id]={venues:(d.data()||{}).venues||[]}});
  const roles=[];(await db.collection('roles').get()).forEach(d=>{const r=d.data()||{};if(!r.station&&(r.apps||{}).leads)roles.push({uid:d.id,r})});
  const clean=o=>JSON.parse(JSON.stringify(o,(k,v)=>(v&&v.toMillis)?v.toMillis():v));
  const base=[{function:'get',args:[{exactValue:D+'orgcfg/main'}],result:{value:{data:clean(org)}}},
    ...Object.entries(sets).map(([h,s])=>({function:'get',args:[{exactValue:D+'settings/'+h}],result:{value:{data:s}}})),
    {function:'exists',args:[{exactValue:D+'waChats/'+chatId}],result:{value:!!chat}},
    ...(chat?[{function:'get',args:[{exactValue:D+'waChats/'+chatId}],result:{value:{data:clean(chat)}}}]:[])];
  const msg={dir:'out',type:'template',tpl:{name:'x',lang:'he',params:['a']},text:'t',status:'queued',at:1,src:'system',byName:'x'};
  const cases=[];const lab=[];
  const add=(name,uid,token,role)=>{const mocks=[...base,{function:'exists',args:[{exactValue:D+'roles/'+uid}],result:{value:!!role}},...(role?[{function:'get',args:[{exactValue:D+'roles/'+uid}],result:{value:{data:clean(role)}}}]:[])];
    const req={auth:{uid,token},path:D+'waChats/'+chatId+'/msgs/ztest1',method:'create',resource:{data:{...msg,by:uid}},time:new Date().toISOString()};
    cases.push({expectation:'ALLOW',request:req,functionMocks:mocks});lab.push(name);
    const r2={auth:{uid,token},path:D+'waChats/'+chatId,method:'get',time:new Date().toISOString()};
    cases.push({expectation:'ALLOW',request:r2,resource:chat?{data:clean(chat)}:undefined,functionMocks:mocks});lab.push(name+' · read chat');};
  add('owner','ownerUid',{email:owner,email_verified:true},null);
  roles.forEach((x,i)=>add('role'+(i+1)+' (hotels '+((x.r.hotels||[]).length||'all')+', events='+!!(x.r.apps||{}).events+', leadCats='+JSON.stringify(x.r.leadCats||[])+')',x.uid,{email:'x@y.z',email_verified:true},x.r));
  const r=await fetch('https://firebaserules.googleapis.com/v1/projects/'+P+':test',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({source:{files:[{name:'firestore.rules',content:src}]},testSuite:{testCases:cases}})});
  const j=await r.json();if(!r.ok){console.log('API '+r.status+' '+JSON.stringify(j).slice(0,400));process.exit(1)}
  console.log('chat venue='+JSON.stringify(chat&&chat.venue)+' agent='+(chat?(chat.agent===''?'empty':'set'):'none')+' cat='+(chat&&chat.cat));
  (j.testResults||[]).forEach((t,i)=>console.log((t.state==='SUCCESS'?'PASS ':'FAIL ')+lab[i]+(t.state!=='SUCCESS'?' · '+String((t.debugMessages||[]).join(' | ')).slice(0,300)+' · '+JSON.stringify(t.errorPosition||{}):'')));
  process.exit(0)})().catch(e=>{console.log('ERR '+String(e.message).slice(0,300));process.exit(1)});
