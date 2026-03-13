import Sidebar from "@/components/Sidebar";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 p-4 md:p-6 overflow-y-auto bg-gray-50 pt-14 md:pt-6">{children}</main>
      </div>
    </ProtectedRoute>
  );
}
