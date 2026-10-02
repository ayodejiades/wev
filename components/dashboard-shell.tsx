"use client";

// Wraps every /dashboard page. By default it is a slim top bar and the page content.
// The workspace sidebar and the ⌘K jump menu are opt-in: pass `workspaceNav` once the
// product really has several screens a user moves between, and edit NAV_GROUPS to name
// them in the user's words.
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: "Work",
    items: [
      { href: "/live", label: "Inspect" },
      { href: "/inbox", label: "Inbox" },
      { href: "/calibrate", label: "Calibrate" },
      { href: "/proof", label: "Proof" },
      { href: "/verify", label: "Verify" },
    ],
  },
];

const NAV_ITEMS = [
  { href: "/live", label: "Inspect" },
  { href: "/inbox", label: "Inbox" },
  { href: "/calibrate", label: "Calibrate" },
  { href: "/proof", label: "Proof" },
  { href: "/verify", label: "Verify" },
];

export function DashboardShell({
  project,
  workspaceNav = false,
  children,
}: {
  project?: string;
  workspaceNav?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname() || "/dashboard";
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!workspaceNav) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      } else if (e.key === "Escape") {
        setCmdOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workspaceNav]);

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f1e8] text-[#0a0a0a] antialiased">
      <header className="border-b-2 border-[#0a0a0a] bg-[#ffffff] px-4 py-3">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3">
          <Link href="/" className="font-display text-base font-bold tracking-tight text-[#0a0a0a] hover:text-[#0047ff]">
            {project || "WEV"}
          </Link>

          {/* Desktop Nav: clean single-line horizontal header row */}
          <nav aria-label="Dashboard" className="hidden md:flex items-center gap-1.5 font-mono text-xs">
            {workspaceNav ? (
              <button
                type="button"
                onClick={() => setCmdOpen(true)}
                className="hidden items-center gap-2 border-2 border-[#0a0a0a] bg-[#ffffff] px-2.5 py-1 text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] sm:inline-flex"
              >
                Jump
                <kbd className="border border-[#0a0a0a] px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
              </button>
            ) : (
              NAV_ITEMS.map((l) => {
                const isActive = pathname === l.href;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={isActive ? "page" : undefined}
                    style={isActive ? { color: "#ffffff", backgroundColor: "#0a0a0a" } : undefined}
                    className={`whitespace-nowrap px-3 py-1 font-semibold transition-all ${
                      isActive
                        ? "border-2 border-[#0a0a0a] bg-[#0a0a0a] !text-white shadow-[2px_2px_0_0_#0047ff]"
                        : "text-[#525252] hover:text-[#0a0a0a]"
                    }`}
                  >
                    <span className={isActive ? "!text-white text-white" : undefined} style={isActive ? { color: "#ffffff" } : undefined}>
                      {l.label}
                    </span>
                  </Link>
                );
              })
            )}
          </nav>

          {/* Mobile menu trigger: clean brutalist button */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle navigation menu"
              className="border-2 border-[#0a0a0a] bg-[#ffffff] px-2.5 py-1 font-mono text-xs font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] hover:bg-[#0a0a0a] hover:text-white transition-colors"
            >
              {mobileMenuOpen ? "Close" : "Menu"}
            </button>
          </div>
        </div>

        {/* Mobile menu drawer */}
        {mobileMenuOpen && (
          <nav
            aria-label="Mobile Navigation"
            className="mt-3 border-t-2 border-[#0a0a0a] pt-3 flex flex-col gap-1.5 md:hidden font-mono text-xs"
          >
            {NAV_ITEMS.map((l) => {
              const isActive = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  style={isActive ? { color: "#ffffff", backgroundColor: "#0a0a0a" } : undefined}
                  className={`flex items-center justify-between px-3 py-2 font-semibold border-2 transition-all ${
                    isActive
                      ? "border-[#0a0a0a] bg-[#0a0a0a] !text-white shadow-[2px_2px_0_0_#0047ff]"
                      : "border-[#0a0a0a] bg-[#ffffff] text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a]"
                  }`}
                >
                  <span className={isActive ? "!text-white text-white" : undefined} style={isActive ? { color: "#ffffff" } : undefined}>
                    {l.label}
                  </span>
                  {isActive && <span className="h-2 w-2 bg-[#0047ff]" />}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      <div className={`mx-auto flex w-full flex-1 gap-4 p-3 sm:p-4 lg:gap-5 lg:p-5 ${workspaceNav ? "max-w-[1480px]" : "max-w-6xl"}`}>
        {workspaceNav ? (
          <aside className="sticky top-5 hidden h-[calc(100vh-4.5rem)] w-[232px] shrink-0 flex-col gap-5 overflow-y-auto border-2 border-[#0a0a0a] bg-[#ffffff] p-4 shadow-[3px_3px_0_0_#0a0a0a] lg:flex font-mono">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#525252]">{group.label}</p>
                <div className="flex flex-col gap-1">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={pathname === item.href ? "page" : undefined}
                      className={`px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        pathname === item.href
                          ? "border-2 border-[#0a0a0a] bg-[#0a0a0a] text-white shadow-[2px_2px_0_0_#0047ff]"
                          : "border border-transparent text-[#525252] hover:text-[#0a0a0a] hover:bg-[#ece8df]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </aside>
        ) : null}

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <footer className="border-t-2 border-[#0a0a0a] bg-[#ffffff]">
        <div className={`mx-auto px-4 py-4 text-xs font-mono text-[#525252] ${workspaceNav ? "max-w-[1480px]" : "max-w-6xl"}`}>
          <p>© {new Date().getFullYear()} {project || "WEV"}. All rights reserved.</p>
        </div>
      </footer>

      {workspaceNav && cmdOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-20" onClick={() => setCmdOpen(false)}>
          <div
            className="w-full max-w-lg border-2 border-[#0a0a0a] bg-[#ffffff] p-3 shadow-[4px_4px_0_0_#0a0a0a] font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid max-h-80 gap-1 overflow-y-auto">
              {NAV_GROUPS.flatMap((g) => g.items).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setCmdOpen(false)}
                  className="flex items-center justify-between border border-transparent px-3 py-2 text-xs font-semibold hover:border-[#0a0a0a] hover:bg-[#ece8df]"
                >
                  <span>{item.label}</span>
                  <span className="font-mono text-[11px] text-[#525252]">{item.href}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
