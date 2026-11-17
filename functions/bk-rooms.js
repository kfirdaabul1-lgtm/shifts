// one-off: add room numbers from the PMS export to imported bookings. Prints counts only.
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
(async()=>{const M=require('./bk-rooms.json');let up=0,miss=0,mism=0;
  for(const [id,list] of Object.entries(M)){const ref=db.doc('bookings/'+id),c=await ref.get();if(!c.exists){miss++;continue}
    const r=(c.data().rooms||[]).slice();if(r.length!==list.length){mism++;continue}
    if(!list.some(Boolean))continue;r.forEach((x,i)=>{if(list[i])x.room=list[i]});await ref.update({rooms:r});up++}
  console.log('rooms: updated '+up+', missing '+miss+', count differs '+mism)})().catch(e=>{console.error('ERR '+e.message);process.exit(1)});
