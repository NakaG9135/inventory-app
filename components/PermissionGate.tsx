"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePermissions } from "@/components/PermissionsProvider";
import {
  ALWAYS_ALLOWED_PATHS,
  LEVEL_VIEW,
  PAGES,
  SUPER_ADMIN_ONLY_PATHS,
  pageKeyForPath,
} from "@/lib/permissions";

// 表示権限のないページを開いた時に中身を出さない
export default function PermissionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loading, error, can, isSuperAdmin } = usePermissions();

  if (loading) return <p>読み込み中...</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  if (ALWAYS_ALLOWED_PATHS.some((p) => pathname.startsWith(p))) return <>{children}</>;

  // 社長専用ページは、他の人には「見つからない」ページとして見せる
  if (SUPER_ADMIN_ONLY_PATHS.some((p) => pathname.startsWith(p)) && !isSuperAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-10 bg-white border border-gray-200 rounded-lg p-6 text-center">
        <p className="text-lg font-bold mb-2">ページが見つかりません</p>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">トップへ戻る</Link>
      </div>
    );
  }

  const key = pageKeyForPath(pathname);
  const allowed = key ? can(key, LEVEL_VIEW) : true;

  if (allowed) return <>{children}</>;

  const available = PAGES.filter((p) => can(p.key, LEVEL_VIEW));
  return (
    <div className="max-w-xl mx-auto mt-10 bg-white border rounded-lg p-6 text-center">
      <p className="text-lg font-bold mb-2">このページを表示する権限がありません</p>
      <p className="text-sm text-gray-600 mb-4">必要な場合は社長に権限の変更を依頼してください。</p>
      {available.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {available.map((p) => (
            <Link key={p.key} href={p.href} className="px-3 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">
              {p.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
