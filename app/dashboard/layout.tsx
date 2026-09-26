import Sidebar from "@/components/Sidebar";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PermissionsProvider } from "@/components/PermissionsProvider";
import PermissionGate from "@/components/PermissionGate";
import AccessLogger from "@/components/AccessLogger";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <PermissionsProvider>
        <AccessLogger />
        <div className="flex h-screen">
          <Sidebar />
          <main className="flex-1 p-4 md:p-6 overflow-y-auto bg-gray-50 pt-14 md:pt-6">
            <PermissionGate>{children}</PermissionGate>
          </main>
        </div>
      </PermissionsProvider>
    </ProtectedRoute>
  );
}
