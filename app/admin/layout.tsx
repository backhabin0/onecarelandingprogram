import type { ReactNode } from "react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminHeader from "@/components/admin/AdminHeader";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex h-full min-h-screen bg-slate-50">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader email={user.email ?? null} />
        <main className="flex-1 overflow-x-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
