// 앱 화면 파일만 저장해 두는 서비스 워커. 가계부 데이터(Apps Script 응답)는 저장하지 않는다.
// 앱을 바꿀 때마다 CACHE 이름의 숫자를 올린다.
const CACHE = 'obye-v35';
const FILES = ['./', 'index.html', 'css/app.css', 'js/icons.js', 'js/demo.js', 'js/config.js', 'js/calc.js', 'js/statement.js', 'js/api.js', 'js/settings.js', 'js/extras.js', 'js/noti.js', 'js/app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // 시트 API·글꼴은 건드리지 않음
  // 새 버전 먼저, 안 되면 저장해 둔 것
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {      // 늘 서버에 새 버전이 있는지 물어봄 (바뀐 게 없으면 금방 끝남)
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});

// ----- 알림 (명세서 11장): 구글 시트가 Firebase로 보낸 알림을 띄우고, 누르면 해당 화면으로 연다 -----
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (x) { p = {}; }
  const d = p.data || p.notification || p;
  e.waitUntil(self.registration.showNotification(d.title || '오병이어', {
    body: d.body || '가계부를 한 번 확인해 볼까요?',
    icon: 'icons/icon-192.png',
    tag: d.tag || 'obye',
    data: { go: d.go || 'home' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const go = (e.notification.data && e.notification.data.go) || 'home';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const win = list.find(c => c.url.startsWith(self.registration.scope));
    if (win) { win.postMessage({ type: 'go', go }); return win.focus(); }
    return self.clients.openWindow(new URL('./?go=' + encodeURIComponent(go), self.registration.scope).href);
  }));
});
