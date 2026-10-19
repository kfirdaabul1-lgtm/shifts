// Service worker for push notifications (Firebase Cloud Messaging).
// Shows a notification when the site is closed; a tap opens the site (or the page in data.url).
self.window = self;
importScripts('config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp(self.APP_CONFIG.firebase);
const messaging = firebase.messaging();
messaging.onBackgroundMessage(function (payload) {
  // messages that carry a "notification" block are shown by the SDK itself
  if (payload.notification) return;
  const d = payload.data || {};
  return self.registration.showNotification(d.title || 'Seven Collection', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', dir: 'rtl', lang: 'he',
    tag: d.tag || undefined, data: { url: d.url || './' }
  });
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (const c of list) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) { c.navigate(url).catch(function () {}); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
