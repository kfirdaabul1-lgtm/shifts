// Service worker for push notifications (Firebase Cloud Messaging).
// Shows a notification when the site is closed; a tap opens the site (or the page in data.url).
self.window = self;
importScripts('config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp(self.APP_CONFIG.firebase);
const messaging = firebase.messaging();
messaging.onBackgroundMessage(function (payload) {
  const d = payload.data || {};
  // the server can send the number of unread items; it shows on the app icon
  if (d.badge && self.navigator && self.navigator.setAppBadge) { try { const n = +d.badge || 0; n ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge(); } catch (e) {} }
  // messages that carry a "notification" block are shown by the phone / SDK itself (all server messages since Oct 25)
  if (payload.notification) return;
  return self.registration.showNotification(d.title || self.APP_CONFIG.appName || 'Seven Collection', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'he',
    tag: d.tag || undefined, data: { url: d.url || './' }
  });
});
self.addEventListener('notificationclick', function (e) {
  // notifications shown by the Firebase SDK (server "notification" block) open their link themselves
  if (e.notification.data && e.notification.data.FCM_MSG) return;
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (const c of list) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.navigate(url).catch(function () {}); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
