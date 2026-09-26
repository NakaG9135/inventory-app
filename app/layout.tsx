import type { Metadata, Viewport } from "next";
import "./globals.css";
import BetaBanner from "@/components/BetaBanner";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import InstallGate from "@/components/InstallGate";

export const metadata: Metadata = {
  title: "在庫管理システム",
  description: "在庫管理アプリ",
  appleWebApp: {
    capable: true,
    title: "在庫管理",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <ServiceWorkerRegister />
        <InstallGate>
          <BetaBanner />
          {children}
        </InstallGate>
      </body>
    </html>
  );
}
