// =====================================================================
//  הגדרות החיבור של האפליקציה
//  ממלאים פעם אחת לפי מדריך ההתקנה (README.md), שלב 3.
// =====================================================================
window.APP_CONFIG = {

  // מעתיקים מ-Firebase Console ← Project settings ← Your apps ← SDK setup and configuration ← Config
  firebase: {
    apiKey: "PASTE_API_KEY_HERE",
    authDomain: "PROJECT_ID.firebaseapp.com",
    projectId: "PROJECT_ID",
    storageBucket: "PROJECT_ID.appspot.com",
    messagingSenderId: "",
    appId: ""
  },

  // המייל של בעל המערכת. רק הוא יכול להוסיף מלונות, למנות מנהלים ולייבא נתונים.
  // חייב להיות זהה למייל שמופיע בקובץ firestore.rules.
  ownerEmail: "kfirdaabul1@gmail.com",

  // הכתובת של האפליקציה, לשימוש בהודעת הוואטסאפ לעובדים. אפשר להשאיר ריק.
  appUrl: "",

  // כניסה עם SMS. דורש חשבון חיוב (Blaze) ב-Firebase ועולה כסף לכל הודעה.
  enablePhone: false
};
