"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function withAdminRoute(Component: React.ComponentType) {
  return function AdminProtected(props: any) {
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const router = useRouter();

    useEffect(() => {
      const checkAdmin = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push("/login");
          return;
        }
        const { data } = await supabase.from("users_profile").select("role").eq("id", user.id).single();
        if (data?.role === "admin") {
          setIsAdmin(true);
        } else {
          router.push("/dashboard");
        }
        setLoading(false);
      };
      checkAdmin();
    }, [router]);

    if (loading) return <p>読み込み中...</p>;

    return isAdmin ? <Component {...props} /> : null;
  };
}
