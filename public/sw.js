// 在庫データは常に最新を表示するためキャッシュしない。
// 通信できない時だけ画面遷移にオフライン案内を返す。
const OFFLINE_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>オフライン</title></head><body style="font-family:sans-serif;text-align:center;padding:48px 16px"><h1 style="font-size:20px">インターネットに接続されていません</h1><p>接続を確認してから再度お試しください。</p><button onclick="location.reload()" style="padding:8px 16px">再読み込み</button></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    )
  );
});
