import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import {
  RiLayoutGridLine,
  RiFlowChart,
  RiFileList3Line,
  RiLogoutBoxLine,
  RiUserSettingsLine,
  RiArrowUpCircleLine,
  RiBuildingLine,
  RiContactsLine,
  RiInboxLine,
  RiMailCheckLine,
  RiCheckboxCircleLine,
  RiQuestionLine,
  RiCompassLine,
  RiPlayCircleLine,
} from "react-icons/ri";
import { pathToTourPage, replayPageTour } from "@/lib/tour";

const LEARNING_PLAYLIST_URL = "https://www.youtube.com/playlist?list=PLBf6xNJOmsIQ";

const mainNav = [
  { href: "/", label: "Dashboard", icon: RiLayoutGridLine, color: "#5aa2ff", tour: "nav-dashboard" },
  { href: "/lists", label: "Lists", icon: RiFileList3Line, color: "#32d583", tour: "nav-lists" },
  { href: "/contacts", label: "Contacts", icon: RiContactsLine, color: "#34d399", tour: "nav-contacts" },
  { href: "/companies", label: "Companies", icon: RiBuildingLine, color: "#a78bfa", tour: "nav-companies" },
  { href: "/workflows", label: "Campaigns", icon: RiFlowChart, color: "#f4b740", tour: "nav-workflows" },
  { href: "/inbox", label: "Inbox", icon: RiInboxLine, color: "#38bdf8", tour: "nav-inbox" },
  { href: "/email-health", label: "Email Health", icon: RiMailCheckLine, color: "#f4b740", tour: "nav-email-health" },
];

// Nav items that only exist in the commercial build (ee/). Filtered out when premium absent.
const premiumNav = [
  { href: "/todos", label: "Todos", icon: RiCheckboxCircleLine, color: "#fb923c", tour: "nav-todos" },
];

export const SIDEBAR_WIDTH_EXPANDED = 52;
export const SIDEBAR_WIDTH_COLLAPSED = 52;

export default function Sidebar({ onCollapse }: { onCollapse?: (collapsed: boolean) => void }) {
  const router = useRouter();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const tourPage = pathToTourPage(router.pathname);
  // Open-core: hide premium-only nav (Todos) in the public build.
  const [hasPremium, setHasPremium] = useState(true);
  const nav = hasPremium ? [...mainNav, ...premiumNav] : mainNav;

  useEffect(() => {
    if (!helpOpen) return;
    function onClick(e: MouseEvent) {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [helpOpen]);

  useEffect(() => {
    onCollapse?.(false);
  }, [onCollapse]);

  useEffect(() => {
    fetch("/api/premium-status").then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setHasPremium(!!d.hasPremium); }).catch(() => {});
  }, []);

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
    if (href === "/") return router.pathname === "/";
    if (href === "/settings") {
      return ["/settings", "/accounts"].some((p) => router.pathname.startsWith(p));
    }
    return router.pathname.startsWith(href);
  }

  return (
    <aside
      className="fixed top-0 left-0 h-screen w-13 z-20 flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Icon rail — always visible */}
      <div className="w-13 shrink-0 bg-base-200 border-r border-base-300/40 flex flex-col h-full">
        {/* Logo */}
        <div className="shrink-0 h-13 flex items-center justify-center border-b border-base-300/40">
          <Image src="/logo_linki.png" alt="Linki" width={22} height={22} className="rounded-md opacity-80" />
        </div>

        {/* Main nav icons */}
        <nav className="flex-1 py-3 flex flex-col gap-0.5 px-1.5 overflow-hidden">
          {nav.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-tour={item.tour}
                title={!hovered ? item.label : undefined}
                className={`flex items-center justify-center h-9 rounded-lg transition-colors ${
                  active
                    ? "text-base-content"
                    : "text-base-content/40 hover:text-base-content/70 hover:bg-base-300/40"
                }`}
              >
                <span
                  className="w-6 h-6 rounded-md flex items-center justify-center"
                  style={{ background: active ? `${item.color}22` : "transparent" }}
                >
                  <item.icon size={14} style={{ color: active ? item.color : "currentColor" }} />
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Update dot */}
        {updateAvailable && (
          <div className="flex justify-center mb-2" title={`v${latestVersion} available`}>
            <RiArrowUpCircleLine size={15} className="text-warning" />
          </div>
        )}

        {/* Bottom icons */}
        <div className="pb-3 border-t border-base-300/40 pt-3 flex flex-col gap-0.5 px-1.5">
          <div className="relative" ref={helpRef}>
            <button
              onClick={() => setHelpOpen((v) => !v)}
              title={!hovered ? "Help" : undefined}
              className={`flex items-center justify-center h-9 rounded-lg transition-colors w-full ${
                helpOpen ? "text-base-content bg-base-300/40" : "text-base-content/40 hover:text-base-content/70 hover:bg-base-300/40"
              }`}
            >
              <span className="w-6 h-6 rounded-md flex items-center justify-center">
                <RiQuestionLine size={14} />
              </span>
            </button>
            {helpOpen && (
              <div
                className="absolute left-11 bottom-0 w-48 bg-base-200 border border-base-300/50 rounded-xl shadow-xl py-1.5 flex flex-col z-30"
              >
                {tourPage && (
                  <button
                    onClick={() => { replayPageTour(tourPage); setHelpOpen(false); }}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-base-content/70 hover:text-base-content hover:bg-base-300/40 transition-colors text-left"
                  >
                    <RiCompassLine size={14} className="text-base-content/40 shrink-0" />
                    Replay this page&apos;s tour
                  </button>
                )}
                <a
                  href={LEARNING_PLAYLIST_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setHelpOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-base-content/70 hover:text-base-content hover:bg-base-300/40 transition-colors"
                >
                  <RiPlayCircleLine size={14} className="text-base-content/40 shrink-0" />
                  Learning resources
                </a>
              </div>
            )}
          </div>
          {(() => {
            const active = isActive("/settings");
            return (
              <Link
                href="/settings"
                data-tour="nav-settings"
                title={!hovered ? "Settings" : undefined}
                className={`flex items-center justify-center h-9 rounded-lg transition-colors ${
                  active
                    ? "text-base-content"
                    : "text-base-content/40 hover:text-base-content/70 hover:bg-base-300/40"
                }`}
              >
                <span
                  className="w-6 h-6 rounded-md flex items-center justify-center"
                  style={{ background: active ? "#a0a0a022" : "transparent" }}
                >
                  <RiUserSettingsLine size={14} style={{ color: active ? "#a0a0a0" : "currentColor" }} />
                </span>
              </Link>
            );
          })()}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title={!hovered ? "Sign out" : undefined}
            className="flex items-center justify-center h-9 rounded-lg text-base-content/40 hover:text-error/70 hover:bg-error/5 transition-colors"
          >
            <span className="w-6 h-6 rounded-md flex items-center justify-center">
              <RiLogoutBoxLine size={14} />
            </span>
          </button>
        </div>
      </div>

      {/* Hover label panel — overlay, slides in */}
      <div
        className={`absolute left-13 top-0 h-full w-44 bg-base-200 border-r border-base-300/40 shadow-xl flex flex-col transition-all duration-150 ${
          hovered ? "opacity-100 translate-x-0 pointer-events-auto" : "opacity-0 -translate-x-2 pointer-events-none"
        }`}
        style={{ borderRadius: "0 12px 12px 0" }}
      >
        {/* Logo area */}
        <div className="shrink-0 h-13 flex items-center px-4 border-b border-base-300/40">
          <span className="text-base-content font-semibold text-sm tracking-wide">Linki</span>
        </div>

        {/* Nav labels */}
        <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2 overflow-hidden">
          {nav.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-base-300 text-base-content"
                    : "text-base-content/50 hover:text-base-content/80 hover:bg-base-300/40"
                }`}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                    style={{ background: item.color }}
                  />
                )}
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Update banner */}
        {updateAvailable && (
          <div className="mx-2 mb-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20">
            <div className="flex items-center gap-1.5 text-warning text-xs font-medium mb-0.5">
              <RiArrowUpCircleLine size={13} />
              Update available
            </div>
            <p className="text-warning/70 text-[11px] leading-snug">
              v{latestVersion} is out.
            </p>
          </div>
        )}

        {/* Settings + signout labels */}
        <div className="pb-3 border-t border-base-300/40 pt-3 flex flex-col gap-0.5 px-2">
          {(() => {
            const active = isActive("/settings");
            return (
              <Link
                href="/settings"
                className={`relative flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-base-300 text-base-content"
                    : "text-base-content/50 hover:text-base-content/80 hover:bg-base-300/40"
                }`}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                    style={{ background: "#a0a0a0" }}
                  />
                )}
                Settings
              </Link>
            );
          })()}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm text-base-content/50 hover:text-error/80 hover:bg-error/5 transition-colors w-full text-left"
          >
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
      </div>
    </aside>
  );
}
