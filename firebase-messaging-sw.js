// Service worker for push notifications (Firebase Cloud Messaging).
// Shows a notification when the site is closed; a tap opens the item the notification is about (data.url / fcmOptions.link).
self.window = self;

// Tap on a notification (owner, Nov 15: a tap opened the general screen instead of the item).
// Registered BEFORE the Firebase SDK so we handle every tap ourselves: if the app is already open we tell it
// where to go (postMessage → the page changes its hash and opens the item) and bring it to the front;
// otherwise we open the app at the item's link.
function linkOf(n) {
  const d = (n && n.data) || {};
  const f = d.FCM_MSG || null;
  return (f && ((f.fcmOptions && f.fcmOptions.link) || (f.data && f.data.url))) || d.url || './';
}
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  const url = new URL(linkOf(e.notification), self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    const mine = list.filter(function (c) { return c.url.startsWith(self.registration.scope); });
    const target = new URL(url), same = mine.find(function (c) { return new URL(c.url).pathname === target.pathname; }) || mine[0];
    if (same) {
      same.postMessage({ type: 'sc-nav', url: url });
      return ('focus' in same ? same.focus() : Promise.resolve()).catch(function () {});
    }
    return clients.openWindow(url);
  }));
});

importScripts('config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp(self.APP_CONFIG.firebase);
const messaging = firebase.messaging();
messaging.onBackgroundMessage(function (payload) {
  const d = payload.data || {};
  // no number on the app icon (owner, Nov 15)
  try { if (self.navigator && self.navigator.clearAppBadge) self.navigator.clearAppBadge(); } catch (e) {}
  // messages that carry a "notification" block are shown by the phone / SDK itself (all server messages since Oct 25)
  if (payload.notification) return;
  return self.registration.showNotification(d.title || self.APP_CONFIG.appName || 'Seven Collection', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'he',
    tag: d.tag || undefined, data: { url: d.url || './' }
  });
});
