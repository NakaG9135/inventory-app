import type { Metadata } from "next";
import "./globals.css";

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
        <div className="bg-yellow-400 text-black text-center text-sm font-bold py-1 sticky top-0 z-[100]">
          現在βテスト中
        </div>
        {children}
      </body>
    </html>
  );
}
