// 결정국 앱(홈 화면에 추가) — 이 사이트의 화면 파일만 저장해 두어 빠르게 열고, 인터넷이 끊겨도 체험 모드로 열리게 한다.
// 개인 기록·로그인·여론·날씨 같은 데이터 요청(Supabase, /api/)은 절대 저장하지 않는다.
const VERSION = "dg-v4";
const CORE = [
  "./", "index.html", "style.css", "app.js", "privacy.html", "manifest.webmanifest",
  "assets/hero-assembly.png", "assets/owl.png", "assets/stand_owl.png", "assets/stand_cat.png", "assets/cat_podium.png",
  "assets/rabbit_desk.png", "assets/quokka_desk.png", "assets/bear_desk.png", "assets/chick_desk.png",
  "assets/stand_rabbit.png", "assets/stand_quokka.png", "assets/stand_bear.png", "assets/stand_chick.png",
  "assets/face_rabbit.png", "assets/face_quokka.png", "assets/face_bear.png", "assets/face_chick.png",
  "assets/app-icon-192.png", "assets/app-icon-512.png", "assets/favicon.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 다른 서버(Supabase·글꼴/라이브러리 CDN) 요청은 건드리지 않는다.
  // (서비스 워커가 대신 받으면 보안 헤더(CSP)의 연결 허용 목록에 막히므로 브라우저가 직접 받게 둔다)
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // 날씨·장소 조회는 항상 서버에서 새로
  if (url.pathname.startsWith("/assets/")) {
    // 그림·글꼴: 저장본 먼저, 없으면 받아서 저장
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // 화면·코드: 항상 최신을 먼저 받고(업데이트 즉시 반영), 인터넷이 없을 때만 저장본
  e.respondWith(fetch(req).then(res => {
    if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
