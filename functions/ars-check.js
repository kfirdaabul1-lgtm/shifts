// Arsona mail shape check — prints a skeleton only (label words kept, everything else → A/9). Public Actions logs: no guest data.
const admin=require('firebase-admin');admin.initializeApp();const db=admin.firestore();
const KEEP=/^(arsona|ersona|the|gutman|hotel|seven|seas|7seas|7even|hostel|180|boheme|sola|request|for|agent|required|potential|lead|missing|information|guest|reservation|check-in|check-out|booking\.com|booking|expedia|room|asks|to|add|a|of|and|from|phone|email|e-mail|name|reason|summary|details|description|hi|new|call|opened|at|יש|לכם|קריאה|חדשה|היי|סיבה|אורח|תיאור|פירוט|נפתח|בשעה|סוג|הפנייה|שם|האורח|טלפון|מייל|חדר|מלון|ערוץ)$/i;
const sk=t=>String(t||'').split('\n').map(l=>l.split(/(\s+)/).map(w=>/^\s+$/.test(w)?w:KEEP.test(w.replace(/[():,.\-–]+$/,'').replace(/^[(]/,''))?w:w.replace(/[0-9]/g,'9').replace(/[^\s9:./()\-|,@]+/g,x=>'A'.repeat(Math.min(3,x.length)))).join('')).join('\n');
(async()=>{const q=await db.collection('guestReqs').get();const L=q.docs.filter(d=>d.id.startsWith('ars_mail')).map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,4);
 console.log('mail requests: '+q.docs.filter(d=>d.id.startsWith('ars_mail')).length);
 for(const x of L){console.log('---- '+new Date(x.at||0).toISOString()+' kind='+(x.kind||'')+' hotel='+(x.hotel||'none')+' lines='+String(x.raw||'').split('\n').length);console.log(sk(String(x.raw||'').slice(0,1500)))}
})().catch(e=>{console.error('ERR '+e.message);process.exit(1)});
