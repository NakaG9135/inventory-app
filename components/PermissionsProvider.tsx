"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { LEVEL_NONE, type PageKey, type PermissionLevel } from "@/lib/permissions";

type PermissionsState = {
  loading: boolean;
  error: string | null;
  isSuperAdmin: boolean;
  levels: Partial<Record<PageKey, PermissionLevel>>;
  level: (key: PageKey) => PermissionLevel;
  can: (key: PageKey, required: PermissionLevel) => boolean;
  refresh: () => Promise<void>;
};

const PermissionsContext = createContext<PermissionsState | null>(null);

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [levels, setLevels] = useState<Partial<Record<PageKey, PermissionLevel>>>({});

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_permissions");
    if (error) {
      setError("権限情報を取得できませんでした。再読み込みしてください。");
    } else {
      setError(null);
      setIsSuperAdmin(Boolean(data?.is_super_admin));
      setLevels((data?.levels ?? {}) as Partial<Record<PageKey, PermissionLevel>>);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      await refresh();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      // 社長が権限・プリセット・割り当てを変えたら、開いている画面にすぐ反映する
      channel = supabase
        .channel(`permissions-${user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_page_permissions", filter: `user_id=eq.${user.id}` },
          () => { refresh(); }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_presets", filter: `user_id=eq.${user.id}` },
          () => { refresh(); }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "permission_preset_levels" },
          () => { refresh(); }
        )
        .subscribe();
    })();

    // リアルタイム接続が切れていた場合の保険
    const onFocus = () => { refresh(); };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      if (channel) supabase.removeChannel(channel);
    };
  }, [refresh]);

  const level = useCallback(
    (key: PageKey): PermissionLevel => (levels[key] ?? LEVEL_NONE) as PermissionLevel,
    [levels]
  );
  const can = useCallback(
    (key: PageKey, required: PermissionLevel) => level(key) >= required,
    [level]
  );

  return (
    <PermissionsContext.Provider value={{ loading, error, isSuperAdmin, levels, level, can, refresh }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsState {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error("usePermissions must be used inside PermissionsProvider");
  return ctx;
}
