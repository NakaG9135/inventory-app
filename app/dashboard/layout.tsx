import Sidebar from "@/components/Sidebar";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PermissionsProvider } from "@/components/PermissionsProvider";
import PermissionGate from "@/components/PermissionGate";
import AccessLogger from "@/components/AccessLogger";
import BirthDatePrompt from "@/components/BirthDatePrompt";
import LoggedInUser from "@/components/LoggedInUser";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <PermissionsProvider>
        <AccessLogger />
        <BirthDatePrompt />
        <div className="flex h-screen">
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col bg-gray-50">
            <LoggedInUser />
            <main className="flex-1 min-h-0 overflow-y-auto p-4 pt-0 md:p-6 md:pt-2">
              <PermissionGate>{children}</PermissionGate>
            </main>
          </div>
        </div>
      </PermissionsProvider>
    </ProtectedRoute>
  );
}
