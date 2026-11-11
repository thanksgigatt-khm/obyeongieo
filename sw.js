// 앱 화면 파일만 저장해 두는 서비스 워커. 가계부 데이터(Apps Script 응답)는 저장하지 않는다.
// 앱을 바꿀 때마다 CACHE 이름의 숫자를 올린다.
const CACHE = 'obye-v17';
const FILES = ['./', 'index.html', 'css/app.css', 'js/icons.js', 'js/demo.js', 'js/config.js', 'js/calc.js', 'js/statement.js', 'js/api.js', 'js/app.js', 'manifest.webmanifest',
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
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
