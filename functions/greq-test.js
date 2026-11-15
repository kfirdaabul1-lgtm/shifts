// one-off test of the Arsona → guestReqs path (owner, Nov 15): posts the patch's sample alert to waWebhook as a WhatsApp message
// from a fake test number, then prints what was stored (test data only) and cleans up. Removed after use.
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const n=s=>console.log('::notice::'+String(s).replace(/\n/g,' '));
(async()=>{
  const cfg=(await db.doc('wacfg/main').get()).data()||{};const FROM='972500000099',id='wamid.TESTARSONA'+Date.now();
  const body=['🔔 Potential Lead | The Gutman Hotel | לטיפול','🏨 מלון: The Gutman Hotel','📌 סוג הפנייה: בקשה להזמנת חדר','📝 סיבת הפנייה ופרטי המקרה: האורחת מבקשת הצעה לשני לילות','👤 שם האורח: Danielle Ofir','📞 טלפון: -','📧 אימייל: 6500066723','🔢 מספר הזמנה: -','🛏 חדר או יחידה: Artist Terrace / Gutman Balcony','💬 ערוץ השיחה: MAIL','🕒 מועד האירוע: 11/13/2026 8:58:57','💡 סיכום התעניינות: מתעניינת בחבילה זוגית'].join('\n');
  const payload={object:'whatsapp_business_account',entry:[{id:String(cfg.wabaId||''),changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:String(cfg.phoneId||''),display_phone_number:''},contacts:[{wa_id:FROM,profile:{name:'Arsona test'}}],messages:[{from:FROM,id,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body}}]}}]}]};
  const r=await fetch('https://europe-west1-hotel-shifts.cloudfunctions.net/waWebhook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  n('webhook answered '+r.status);
  await new Promise(x=>setTimeout(x,8000));
  const ref=db.doc('guestReqs/ars_'+id.replace(/[^A-Za-z0-9_-]/g,'').slice(-60)),d=await ref.get();
  if(!d.exists){n('FAIL: no guestReqs doc');}else{const x=d.data();const hn=x.hotel?((await db.doc('hotels/'+x.hotel).get()).data()||{}).name:'';
    n(`guestReqs: type=${x.type} hotel=${x.hotel} (${hn}) guest=${x.guest} room=${x.room} channel=${x.channel} conf=${x.conf} email=${x.email||'(empty)'} phone=${x.phone||'(empty)'} status=${x.status}`)}
  const chat=await db.doc('waChats/'+FROM).get(),lead=await db.doc('leads/wa_'+FROM).get();
  n('chat created: '+chat.exists+' · lead created: '+lead.exists);
  // who got the push (by role, names only)
  if(d.exists){const h=d.data().hotel;const rs=await db.collection('roles').get();const names=[];for(const doc of rs.docs){const ro=doc.data()||{};if(ro.station||!(ro.apps||{}).greq)continue;const hs=ro.hotels||[];if(hs.length&&!hs.includes(h))continue;const e=(await db.doc('employees/'+doc.id).get()).data()||{};names.push(e.name||doc.id)}n('greq holders notified (besides the owner): '+(names.join(', ')||'none'))}
  await ref.delete().catch(()=>{});if(chat.exists)await db.doc('waChats/'+FROM).delete();if(lead.exists)await db.doc('leads/wa_'+FROM).delete();n('test data removed');
})().catch(e=>{n('ERR '+e.message);process.exit(1)});
