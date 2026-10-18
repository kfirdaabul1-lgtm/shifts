// =====================================================================
//  הגדרות החיבור של האפליקציה
//  ממלאים פעם אחת לפי מדריך ההתקנה (README.md), שלב 3.
// =====================================================================
window.APP_CONFIG = {

  // מעתיקים מ-Firebase Console ← Project settings ← Your apps ← SDK setup and configuration ← Config
  firebase: {
    apiKey: "AIzaSyAvI0CfZXIiiNql51SYTdGJT7XdPbWUOaA",
    authDomain: "hotel-shifts.firebaseapp.com",
    projectId: "hotel-shifts",
    storageBucket: "hotel-shifts.firebasestorage.app",
    messagingSenderId: "963422107026",
    appId: "1:963422107026:web:7957e21b2aeacf113abd4b"
  },

  // המייל של בעל המערכת. רק הוא יכול להוסיף מלונות, למנות מנהלים ולייבא נתונים.
  // חייב להיות זהה למייל שמופיע בקובץ firestore.rules.
  ownerEmail: "kfirdaabul1@gmail.com",

  // הכתובת של האפליקציה, לשימוש בהודעת הוואטסאפ לעובדים. אפשר להשאיר ריק.
  appUrl: "https://kfirdaabul1-lgtm.github.io/shifts/",

  // כניסה עם SMS. דורש חשבון חיוב (Blaze) ב-Firebase ועולה כסף לכל הודעה.
  enablePhone: false
};
