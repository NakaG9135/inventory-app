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
          現在βテスト中　好きなようにいじって触って慣れといてください。　数値などぐちゃぐちゃになってOK,ログもめちゃくちゃになってOK。　実装時アカウント以外リセットします。　日々更新して変更されます。　こうしてほしい、こういう機能欲しいという方、悠介まで。
        </div>
        {children}
      </body>
    </html>
  );
}
