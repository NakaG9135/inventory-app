"use client";

import { useEffect, useState } from "react";

// Chrome / Edge / Android の「インストール」イベント
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Env = "ios" | "android" | "inapp" | "desktop";

const isStandalone = () =>
  ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
  ) || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const detectEnv = (): Env => {
  const ua = navigator.userAgent;
  if (/Line\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua)) return "inapp";
  // iPadOS は Mac と同じ UA になるためタッチ対応で判定
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
};

// ブラウザで開いた時はインストール案内だけを表示し、インストールしたアプリから開いた時だけ中身を表示する
export default function InstallGate({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<"checking" | "app" | "browser">("checking");
  const [env, setEnv] = useState<Env>("desktop");
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // 開発中（localhost）はブラウザでもそのまま使えるようにする
    if (isStandalone() || window.location.hostname === "localhost") {
      setMode("app");
      return;
    }
    setEnv(detectEnv());
    setMode("browser");

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "checking") return null;
  if (mode === "app") return <>{children}</>;

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  };

  const step = (n: number, text: React.ReactNode) => (
    <li className="flex gap-3 items-start">
      <span className="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center">{n}</span>
      <span className="pt-0.5">{text}</span>
    </li>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm max-w-md w-full p-6 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="w-20 h-20 rounded-2xl mx-auto mb-4" />
        <h1 className="text-xl font-bold mb-1">在庫管理システム</h1>
        <p className="text-sm text-gray-600 mb-6">このシステムはアプリとしてインストールして使います。</p>

        {installed ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800 text-left">
            <p className="font-bold mb-1">インストールしました</p>
            <p>
              {env === "desktop"
                ? "デスクトップやスタートメニューの「在庫管理」アイコンから開いてください。"
                : "ホーム画面の「在庫管理」アイコンから開いてください。"}
              このページは閉じて大丈夫です。
            </p>
          </div>
        ) : env === "inapp" ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-900 text-left">
            <p className="font-bold mb-2">このままではインストールできません</p>
            <p>LINE などのアプリ内で開いています。右上（または下）のメニューから「ブラウザで開く」を選び、iPhone は Safari、Android は Chrome で開き直してください。</p>
          </div>
        ) : (
          <>
            {installEvent && (
              <button
                onClick={handleInstall}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg mb-5"
              >
                アプリをインストール
              </button>
            )}

            <div className="text-left text-sm">
              <p className="font-bold mb-2 text-gray-700">
                {installEvent ? "ボタンが使えない場合の手順" : "インストールの手順"}
              </p>
              <ol className="space-y-3">
                {env === "ios" && (
                  <>
                    {step(1, <>Safari で開いています（他のアプリ内の場合は Safari で開き直してください）</>)}
                    {step(2, <>画面下（iPad は右上）の <b>共有ボタン</b>（□に↑のマーク）を押す</>)}
                    {step(3, <><b>「ホーム画面に追加」</b>を選んで「追加」を押す</>)}
                    {step(4, <>ホーム画面にできた <b>「在庫管理」</b>のアイコンから開く</>)}
                  </>
                )}
                {env === "android" && (
                  <>
                    {step(1, <>Chrome で開く</>)}
                    {step(2, <>右上の <b>︙</b>（メニュー）を押す</>)}
                    {step(3, <><b>「アプリをインストール」</b>（または「ホーム画面に追加」）を選ぶ</>)}
                    {step(4, <>ホーム画面の <b>「在庫管理」</b>のアイコンから開く</>)}
                  </>
                )}
                {env === "desktop" && (
                  <>
                    {step(1, <><b>Chrome</b> または <b>Edge</b> で開く（Firefox などではインストールできません）</>)}
                    {step(2, <>アドレスバー右側の <b>インストールのアイコン</b>を押す（または右上のメニュー →「アプリをインストール」）</>)}
                    {step(3, <>デスクトップやスタートメニューの <b>「在庫管理」</b>から開く</>)}
                  </>
                )}
              </ol>
            </div>

            <p className="text-xs text-gray-500 mt-6 text-left">
              すでにインストール済みの場合は、ホーム画面やデスクトップの「在庫管理」アイコンから開いてください。
              {env === "desktop" && " Chrome / Edge ではアドレスバー右側の「アプリで開く」からも開けます。"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
