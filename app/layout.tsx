import type { Metadata } from "next";
import "./globals.css";
import BetaBanner from "@/components/BetaBanner";

export const metadata: Metadata = {
  title: "在庫管理システム",
  description: "在庫管理アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <BetaBanner />
        {children}
      </body>
    </html>
  );
}
