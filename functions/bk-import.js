// one-off PMS export import. MODE=key: make an RSA key (private part kept in Firestore _import/bk, admin-only), print the public key.
// MODE=run: decrypt functions/bk-import.enc (AES key wrapped with RSA), import, delete the key. Prints counts only.
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();const crypto=require('crypto'),zlib=require('zlib'),fs=require('fs');
(async()=>{
  const kref=db.doc('_import/bk');
  if(process.env.MODE==='key'){const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    await kref.set({priv:privateKey,at:Date.now()});console.log('PUBKEY_B64 '+Buffer.from(publicKey).toString('base64'));return}
  const k=(await kref.get()).data();if(!k)throw new Error('no key');
  const e=JSON.parse(fs.readFileSync(__dirname+'/bk-import.enc','utf8'));
  const aes=crypto.privateDecrypt({key:k.priv,oaepHash:'sha256'},Buffer.from(e.k,'base64'));
  const dc=crypto.createDecipheriv('aes-256-gcm',aes,Buffer.from(e.iv,'base64'));dc.setAuthTag(Buffer.from(e.tag,'base64'));
  const rows=JSON.parse(zlib.gunzipSync(Buffer.concat([dc.update(Buffer.from(e.d,'base64')),dc.final()])).toString());
  const now=Date.now();let add=0,skip=0,ch=0;
  for(const [id,d] of rows){const ref=db.doc('bookings/'+id),cur=await ref.get();
    if(cur.exists){const x=cur.data();if(!x.channel&&d.channel){await ref.update({channel:d.channel});ch++}skip++;continue}
    await ref.set({...d,by:'import',hist:[{at:now,action:'import'}],createdAt:now,updatedAt:now});add++}
  await kref.delete();
  console.log('import: added '+add+', already there '+skip+', channel filled '+ch);
})().catch(e=>{console.error('ERR '+e.message);process.exit(1)});
