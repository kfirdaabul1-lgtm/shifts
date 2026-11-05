// =====================================================================
//  הגדרות החיבור של האפליקציה
//  כל רשת יושבת במאגר (פרויקט Firebase) נפרד. כאן רשומות כל הרשתות;
//  הרשת הראשונה היא ברירת המחדל. בעל המערכת עובר ביניהן בלחיצה על השם למעלה.
// =====================================================================

// בעל המערכת כולה (רואה את מסך הרשתות ועובר ביניהן)
window.SC_PLATFORM_OWNER = "kfirdaabul1@gmail.com";
// השם שמופיע למעלה באזור ניהול המערכת
window.SC_PLATFORM_NAME = "Kfir app";

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
    appUrl: "https://app.sevencollection.co.il/",
    // כתובת משלה לרשת (Nov 5): במאגר Seven-app יש עותק של האתר בכתובת הזו, והיא פותחת תמיד רק את הרשת הזו
    domain: "app.sevencollection.co.il",
    // true רק אצל Seven Collection: אולמות האירועים, רשימות החדרים והספא המובנים לפי שמות המלונות של Seven.
    // ברשת חדשה שמים false, ואת האולמות, החדרים והספא מגדירים בעמוד "הגדרות רשת".
    legacyPresets: true
  }
  // רשת נוספת: מוסיפים כאן אובייקט עם id, appName, firebase, ownerEmail, appUrl, legacyPresets:false
  // מלון עצמאי (לא שייך לרשת): אותו דבר עם kind: "hotel" — עובד בדיוק כמו רשת עם מלון אחד
];

// הרשת הפעילה: ?chain=<id> בכתובת, אחרת מה שנבחר בפעם האחרונה במכשיר, אחרת הראשונה
// הכתובת הכללית (Kfir app ושאר הרשתות)
window.SC_BASE = "https://kfirdaabul1-lgtm.github.io/shifts/";
(function () {
  var id = null;
  try { id = new URLSearchParams(location.search).get("chain") || localStorage.getItem("scChain"); } catch (e) {}
  window.SC_HOME = window.SC_CHAINS[0].id;
  // a chain with its own address (domain): that address always opens only that chain
  var own = window.SC_CHAINS.filter(function (x) { return x.domain && x.domain === location.hostname; })[0];
  if (own) { window.SC_LOCKED = own.id; id = own.id; }
  var c = window.SC_CHAINS.filter(function (x) { return x.id === id; })[0];
  // chains added from Kfir app live in the home database (collection "chains"); their web config is cached on the device
  if (!c && id) {
    try { var j = JSON.parse(localStorage.getItem("scChainCfg:" + id) || "null"); if (j && j.firebase) c = j; } catch (e) {}
    if (!c) window.SC_NEED_CHAIN = id;
  }
  c = c || window.SC_CHAINS[0];
  // a chain with its own address: opening it on the general address moves there (old links keep working).
  // Not for an explicit ?chain=, and not on the system owner's devices (scPlat), who keeps Kfir app on the general address.
  try {
    var explicit = new URLSearchParams(location.search).get("chain");
    // a network that blocks the new address (e.g. a hotel firewall: "Newly Observed Domain", Nov 5): ?chain=<id> keeps this device on the general address (scStay),
    // and before moving we load a small image from the new address — if it doesn't load within 4 s the device stays here.
    if (explicit && c.domain && /github\.io$/.test(location.hostname)) localStorage.setItem("scStay", "1");
    if (!own && c.domain && typeof document !== "undefined" && /github\.io$/.test(location.hostname) && !explicit && localStorage.getItem("scPlat") !== "1" && localStorage.getItem("scStay") !== "1") {
      var go = "https://" + c.domain + location.pathname.replace(/^\/shifts\//, "/") + location.search + location.hash, done = false, img = new Image();
      img.onload = function () { if (!done) { done = true; location.replace(go); } };
      img.onerror = function () { done = true; };
      setTimeout(function () { done = true; }, 4000);
      img.src = "https://" + c.domain + "/icon-192.png?probe=" + Date.now();
    }
  } catch (e) {}
  try { if (id && c.id === id) localStorage.setItem("scChain", c.id); } catch (e) {}
  window.APP_CONFIG = Object.assign({ enablePhone: false }, c, { chainId: c.id });
})();
