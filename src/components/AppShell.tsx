"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { BarChart3, Gauge, LayoutDashboard, ListChecks, LogOut, Menu, MapPin, MessageSquare, Radio, Settings, Users, X } from "lucide-react";
import { BRAND } from "@/lib/constants";
import { isAdminRole } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useMapSettings } from "@/lib/mapSettings";
import { useProfile } from "./ProfileContext";
import NotificationBell from "./NotificationBell";
import { RadioProvider, useRadio } from "./radio/RadioContext";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  soon?: string;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/incidents", label: "Incidents", icon: ListChecks },
  { href: "/towers", label: "Towers", icon: MapPin },
  { href: "/teams", label: "RRT Teams", icon: Users },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/messages", label: "Messages", icon: MessageSquare, adminOnly: true },
  { href: "/demo", label: "Demo Controller", icon: Gauge, adminOnly: true },
  { href: "/admin", label: "Admin", icon: Settings, adminOnly: true },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const profile = useProfile();
  return isAdminRole(profile.role) ? (
    <RadioProvider>
      <Shell>{children}</Shell>
    </RadioProvider>
  ) : (
    <Shell>{children}</Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const profile = useProfile();
  const radio = useRadio();
  const mapCfg = useMapSettings();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const admin = isAdminRole(profile.role);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const items = NAV.filter((n) => !n.adminOnly || admin);

  const nav = (
    <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Main">
      {items.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.soon ? "#" : n.href}
            aria-disabled={!!n.soon}
            onClick={(e) => {
              if (n.soon) e.preventDefault();
              else setOpen(false);
            }}
            className={clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
              active ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white",
              n.soon && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-slate-300",
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="flex-1">{n.label}</span>
            {n.href === "/messages" && (radio?.unread.total ?? 0) > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white" data-testid="nav-unread">{radio!.unread.total}</span>
            )}
            {n.soon && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{n.soon}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col bg-ink-900 lg:flex">
        <Brand />
        {nav}
        <Foot />
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-ink-900">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-2 top-3 rounded p-1 text-slate-300 hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
            <Brand />
            {nav}
            <Foot />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <Radio className="hidden h-4 w-4 text-green-600 sm:block" aria-hidden />
          <span className="hidden text-sm font-medium text-slate-600 sm:block">Live{mapCfg.loaded ? ` · ${mapCfg.city}` : ""}</span>
          <div className="flex-1" />
          <NotificationBell />
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-sm font-medium text-slate-900">{profile.full_name}</p>
            <p className="text-xs text-slate-500">{profile.role.replace("_", " ").toLowerCase()}</p>
          </div>
          <button onClick={signOut} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100" title="Sign out">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-3 border-b border-white/10 px-5">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">P</div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-white">PERS</p>
        <p className="text-[11px] text-slate-400">{BRAND.replace("PERS ", "")}</p>
      </div>
    </div>
  );
}

function Foot() {
  return <p className="px-5 py-3 text-[11px] text-slate-500">Times shown in India Standard Time</p>;
}
