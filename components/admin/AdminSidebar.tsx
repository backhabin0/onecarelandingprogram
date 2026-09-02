"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/admin/actions";

interface NavItem {
  label: string;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "대시보드", href: "/admin" },
  { label: "랜딩페이지 관리", href: "/admin/pages" },
  { label: "새 페이지 만들기", href: "/admin/pages/new" },
  { label: "템플릿 관리", href: "/admin/templates" },
  { label: "설정", href: "/admin/settings" },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-slate-900">
      <div className="flex h-16 items-center px-6">
        <span className="text-lg font-semibold text-white">OneCare Admin</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <form action={signOutAction}>
          <button
            type="submit"
            className="block w-full rounded-md px-3 py-2.5 text-left text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            로그아웃
          </button>
        </form>
      </div>
    </aside>
  );
}
