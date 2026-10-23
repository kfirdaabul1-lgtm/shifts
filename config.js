// =====================================================================
//  הגדרות החיבור של האפליקציה
//  כל רשת יושבת במאגר (פרויקט Firebase) נפרד. כאן רשומות כל הרשתות;
//  הרשת הראשונה היא ברירת המחדל. בעל המערכת עובר ביניהן בלחיצה על השם למעלה.
// =====================================================================

// בעל המערכת כולה (רואה את מסך הרשתות ועובר ביניהן)
window.SC_PLATFORM_OWNER = "kfirdaabul1@gmail.com";

window.SC_CHAINS = [
  {
    id: "seven",
    // שם הרשת שמופיע בכותרת
    appName: "Seven Collection",
    // מעתיקים מ-Firebase Console ← Project settings ← Your apps ← SDK setup and configuration ← Config
    firebase: {
      apiKey: "AIzaSyAvI0CfZXIiiNql51SYTdGJT7XdPbWUOaA",
      authDomain: "hotel-shifts.firebaseapp.com",
      projectId: "hotel-shifts",
      storageBucket: "hotel-shifts.firebasestorage.app",
      messagingSenderId: "963422107026",
      appId: "1:963422107026:web:7957e21b2aeacf113abd4b"
    },
    // המייל של בעל הרשת. רק הוא יכול להוסיף מלונות, למנות מנהלים ולייבא נתונים.
    // חייב להיות זהה למייל שמופיע בקובץ firestore.rules של אותו מאגר.
    ownerEmail: "kfirdaabul1@gmail.com",
    // הכתובת של האפליקציה, לשימוש בהודעות הוואטסאפ לעובדים
    appUrl: "https://kfirdaabul1-lgtm.github.io/shifts/",
    // true רק אצל Seven Collection: אולמות האירועים, רשימות החדרים והספא המובנים לפי שמות המלונות של Seven.
    // ברשת חדשה שמים false, ואת האולמות, החדרים והספא מגדירים בעמוד "הגדרות רשת".
    legacyPresets: true
  }
  // רשת נוספת: מוסיפים כאן אובייקט עם id, appName, firebase, ownerEmail, appUrl, legacyPresets:false
];

// הרשת הפעילה: ?chain=<id> בכתובת, אחרת מה שנבחר בפעם האחרונה במכשיר, אחרת הראשונה
(function () {
  var id = null;
  try { id = new URLSearchParams(location.search).get("chain") || localStorage.getItem("scChain"); } catch (e) {}
  var c = window.SC_CHAINS.filter(function (x) { return x.id === id; })[0] || window.SC_CHAINS[0];
  try { if (id && c.id === id) localStorage.setItem("scChain", c.id); } catch (e) {}
  window.APP_CONFIG = Object.assign({ enablePhone: false }, c, { chainId: c.id });
})();
