// one-off: PMS export import (data from secret IMP_BK, gzip+base64). Prints counts only.
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();const zlib=require('zlib');
(async()=>{
  const rows=JSON.parse(zlib.gunzipSync(Buffer.from(process.env.IMP_BK||'','base64')).toString());const now=Date.now();let add=0,skip=0,ch=0;
  for(const [id,d] of rows){const ref=db.doc('bookings/'+id),cur=await ref.get();
    if(cur.exists){const x=cur.data();if(!x.channel&&d.channel){await ref.update({channel:d.channel});ch++}skip++;continue}
    await ref.set({...d,by:'import',hist:[{at:now,action:'import'}],createdAt:now,updatedAt:now});add++}
  console.log('import: added '+add+', already there '+skip+', channel filled '+ch);
})().catch(e=>{console.error('ERR '+e.message);process.exit(1)});
