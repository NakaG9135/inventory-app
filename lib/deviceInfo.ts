// 接続ログ用：端末・OS・ブラウザの情報を集める
export type DeviceInfo = {
  device_type: string; // パソコン / スマホ / タブレット
  os: string;
  os_version: string;
  browser: string;
  browser_version: string;
  device_model: string;
  is_installed: boolean;
  extra: Record<string, unknown>;
};

type UAData = {
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    platform?: string;
    platformVersion?: string;
    model?: string;
    fullVersionList?: { brand: string; version: string }[];
  }>;
};

const match = (ua: string, re: RegExp) => ua.match(re)?.[1] ?? "";

export async function collectDeviceInfo(): Promise<DeviceInfo> {
  const ua = navigator.userAgent;
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isIPhone = /iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);

  let os = "";
  let osVersion = "";
  if (isIPhone || isIPad) {
    os = isIPad ? "iPadOS" : "iOS";
    osVersion = match(ua, /OS (\d+[_\d]*) like Mac OS X/).replace(/_/g, ".") || match(ua, /Version\/([\d.]+)/);
  } else if (isAndroid) {
    os = "Android";
    osVersion = match(ua, /Android ([\d.]+)/);
  } else if (/Windows/.test(ua)) {
    os = "Windows";
    osVersion = match(ua, /Windows NT ([\d.]+)/);
  } else if (/CrOS/.test(ua)) {
    os = "ChromeOS";
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    os = "macOS";
    osVersion = match(ua, /Mac OS X ([\d_]+)/).replace(/_/g, ".");
  } else if (/Linux/.test(ua)) {
    os = "Linux";
  }

  let browser = "";
  let browserVersion = "";
  const browsers: [string, RegExp][] = [
    ["LINE", /Line\/([\d.]+)/],
    ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, re] of browsers) {
    const v = match(ua, re);
    if (v) {
      browser = name;
      browserVersion = v;
      break;
    }
  }

  let deviceModel = isIPad ? "iPad" : isIPhone ? "iPhone" : isAndroid ? match(ua, /Android [\d.]+; ([^;)]+)/).replace(/ Build\/.*/, "") : "";

  // Chrome / Edge では、より正確な OS バージョン・機種名が取れる
  const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  if (uaData?.getHighEntropyValues) {
    try {
      const hi = await uaData.getHighEntropyValues(["platformVersion", "model", "fullVersionList"]);
      if (hi.model) deviceModel = hi.model;
      if (os === "Windows" && hi.platformVersion) {
        const major = parseInt(hi.platformVersion.split(".")[0] ?? "0", 10);
        osVersion = major >= 13 ? `11 (${hi.platformVersion})` : `10 (${hi.platformVersion})`;
      } else if (hi.platformVersion && (os === "macOS" || os === "Android" || os === "ChromeOS")) {
        osVersion = hi.platformVersion;
      }
      const full = hi.fullVersionList?.find((b) => b.brand === (browser === "Edge" ? "Microsoft Edge" : browser === "Chrome" ? "Google Chrome" : ""));
      if (full) browserVersion = full.version;
    } catch {
      // 取れない場合は User-Agent の値のまま
    }
  }

  const isInstalled =
    ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some(
      (m) => window.matchMedia(`(display-mode: ${m})`).matches
    ) || (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return {
    device_type: isIPad || (isAndroid && !/Mobile/.test(ua)) ? "タブレット" : isIPhone || isAndroid ? "スマホ" : "パソコン",
    os,
    os_version: osVersion,
    browser,
    browser_version: browserVersion,
    device_model: deviceModel,
    is_installed: isInstalled,
    extra: {
      screen: `${window.screen.width}x${window.screen.height}`,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}
