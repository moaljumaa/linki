import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  RiLayoutGridLine,
  RiGroupLine,
  RiFlowChart,
  RiFileList3Line,
  RiAccountCircleLine,
  RiSettings3Line,
  RiLogoutBoxLine,
  RiUserSettingsLine,
  RiArrowUpCircleLine,
} from "react-icons/ri";

const mainNav = [
  { href: "/", label: "Dashboard", icon: RiLayoutGridLine, color: "#5aa2ff" },
  { href: "/lists", label: "Lists", icon: RiFileList3Line, color: "#32d583" },
  { href: "/workflows", label: "Campaigns", icon: RiFlowChart, color: "#f4b740" },
];

const settingsNav = [
  { href: "/accounts", label: "Accounts", icon: RiAccountCircleLine, color: "#c084fc" },
  { href: "/templates", label: "Templates", icon: RiGroupLine, color: "#a0a0a0" },
  { href: "/settings", label: "Settings", icon: RiUserSettingsLine, color: "#a0a0a0" },
];

export default function Sidebar() {
  const router = useRouter();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/system/update")
      .then((r) => r.json())
      .then((d) => {
        setCurrentVersion(d.current ?? null);
        if (d.updateAvailable) {
          setUpdateAvailable(true);
          setLatestVersion(d.latest);
        }
      })
      .catch(() => {});
  }, []);

  function isActive(href: string) {
    return href === "/" ? router.pathname === "/" : router.pathname.startsWith(href);
  }

  function NavLink({ href, label, icon: Icon, color }: { href: string; label: string; icon: React.ElementType; color: string }) {
    const active = isActive(href);
    return (
      <Link
        href={href}
        className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          active
            ? "bg-base-300 text-base-content"
            : "text-base-content/50 hover:text-base-content/80 hover:bg-base-300/40"
        }`}
      >
        {active && (
          <span
            className="absolute left-0 top-1/2 -translate-y-1/2 w-0.75 h-5 rounded-r-full"
            style={{ background: color }}
          />
        )}
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors"
          style={{ background: active ? `${color}22` : "transparent" }}
        >
          <Icon size={14} style={{ color: active ? color : "currentColor" }} />
        </span>
        {label}
      </Link>
    );
  }

  return (
    <aside className="fixed top-0 left-0 h-screen w-48 bg-base-200 border-r border-base-300/40 flex flex-col z-10">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-base-300/40">
        <div className="flex items-center gap-2">
          <Image src="/logo_linki.png" alt="Linki" width={24} height={24} className="rounded-md" />
          <span className="text-base-content font-semibold text-sm tracking-wide">Linki</span>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
        {mainNav.map(item => <NavLink key={item.href} {...item} />)}
      </nav>

      {/* Update available banner */}
      {updateAvailable && (
        <div className="mx-2 mb-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20">
          <div className="flex items-center gap-1.5 text-warning text-xs font-medium mb-0.5">
            <RiArrowUpCircleLine size={13} />
            Update available
          </div>
          <p className="text-warning/70 text-[11px] leading-snug">
            v{latestVersion} is out. Update your Docker image.
          </p>
        </div>
      )}

      {/* Settings nav */}
      <div className="px-2 pb-3 border-t border-base-300/40 pt-3 space-y-0.5">
        <div className="flex items-center gap-1.5 px-3 py-1 mb-1">
          <RiSettings3Line size={11} className="text-base-content/25" />
          <span className="text-[10px] text-base-content/25 uppercase tracking-widest font-medium">Settings</span>
        </div>
        {settingsNav.map(item => <NavLink key={item.href} {...item} />)}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-base-content/50 hover:text-error/80 hover:bg-error/5 transition-colors w-full mt-0.5"
        >
          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0">
            <RiLogoutBoxLine size={14} />
          </span>
          Sign out
        </button>
      </div>
      {/* Version + branding */}
      <div className="px-4 py-3 border-t border-base-300/40">
        {currentVersion && (
          <p className="text-[10px] text-base-content/25 mb-0.5">v{currentVersion}</p>
        )}
        <a
          href="https://opsily.com?utm_source=linki&utm_medium=app&utm_campaign=sidebar"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-base-content/25 hover:text-base-content/50 transition-colors"
        >
          Built by opsily.com
        </a>
      </div>
    </aside>
  );
}
