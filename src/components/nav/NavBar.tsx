"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { SearchBar } from "@/components/search/SearchBar";
import { NAV_SHORTCUTS } from "@/lib/nav-shortcuts";
import { NavIcon } from "./NavIcon";
import { syncLabel, useSyncStatus } from "@/lib/account/sync";

const navLinks = [
  { href: "/explore/trails", label: "Explore", icon: "explore" as const, hint: "G then E" },
  { href: "/map", label: "Map", icon: "map" as const, hint: "G then M" },
  { href: "/plan", label: "My trips", icon: "trips" as const, hint: "G then T" },
  { href: "/gear", label: "Gear", icon: "gear" as const, hint: "G then G" },
];

const footerLinks = [
  {
    href: "/record",
    label: "Record activity",
    icon: "record" as const,
    hint: "G then R",
    className: "fieldbook-record",
  },
  {
    href: "/you",
    label: "Profile",
    icon: "profile" as const,
    hint: "G then P",
    className: "fieldbook-profile",
  },
];

const tools = [
  { href: "/explore/trails/catalog", label: "All trails & filters" },
  { href: "/explore/trails/catalog?kind=route", label: "Through-hikes" },
  { href: "/you", label: "Profile" },
  { href: "/record", label: "Record activity", hint: "G then R" },
  { href: "/activity", label: "Activity log", hint: "G then A" },
  { href: "/pack-trails", label: "Route guides" },
  { href: "/explore/trails/catalog?collection=community", label: "Community & GPX trails" },
  { href: "/explore/ski", label: "Ski trails" },
  { href: "/ski-areas", label: "Ski areas" },
  { href: "/about/data", label: "Data sources & licences" },
];

const goRoutes: Record<string, string> = {};
for (const item of NAV_SHORTCUTS) {
  if ("chord" in item && "href" in item && item.chord && item.href) {
    goRoutes[item.chord] = item.href;
  }
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(target.closest("[role='textbox']"));
}

function MoreTools({ collapsed }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismissOutside(event: PointerEvent) {
      if (disclosure.current && !disclosure.current.contains(event.target as Node)) disclosure.current.open = false;
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, []);
  return (
    <details
      className="nav-tools"
      key={pathname}
      ref={disclosure}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && disclosure.current?.open) {
          event.preventDefault();
          disclosure.current.open = false;
          disclosure.current.querySelector("summary")?.focus();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
          event.currentTarget.open = false;
        }
      }}
    >
      <summary aria-label="More tools" title={collapsed ? "More tools" : undefined}>
        {collapsed ? <NavIcon name="more" /> : <>More <NavIcon name="more" /></>}
      </summary>
      <nav className="nav-tools-content" aria-label="Additional destinations">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            title={tool.hint ? `${tool.label} · ${tool.hint}` : tool.label}
            aria-current={
              (tool.href === "/" ? pathname === "/" : pathname === tool.href || pathname.startsWith(`${tool.href}/`))
                ? "page"
                : undefined
            }
          >
            {tool.label}
          </Link>
        ))}
        <div className="nav-search">
          <SearchBar />
        </div>
      </nav>
    </details>
  );
}

/** Account sync status: "Synced · just now", "Syncing…", "Offline — changes will sync", or "Guest · not saved". */
function SyncBadge({ signedIn }: { signedIn: boolean }) {
  const status = useSyncStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const label = signedIn ? syncLabel(status.state === "guest" ? { ...status, state: "idle" } : status, now) : "Guest · not saved";
  const tone = !signedIn ? "guest" : status.state === "error" ? "error" : status.state === "offline" ? "offline" : status.state === "syncing" ? "syncing" : "synced";
  return (
    <p className={`fieldbook-sync fieldbook-sync--${tone}`} role="status" aria-live="polite" title={status.message || label}>
      <span className="fieldbook-sync-dot" aria-hidden="true" />
      <span className="fieldbook-nav-label">{label}</span>
    </p>
  );
}

export function NavBar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const goArmed = useRef(false);
  const goTimer = useRef<number | null>(null);
  const onToggleRef = useRef(onToggle);
  useEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    supabase.auth.getUser().then((result) => {
      setUserEmail(result.data.user?.email ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function clearGo() {
      goArmed.current = false;
      if (goTimer.current !== null) {
        window.clearTimeout(goTimer.current);
        goTimer.current = null;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing || isTypingTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b") {
        if (!window.matchMedia("(min-width: 768px)").matches) return;
        event.preventDefault();
        document.querySelector<HTMLButtonElement>(".fieldbook-nav-toggle")?.focus();
        onToggleRef.current();
        clearGo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        clearGo();
        return;
      }

      if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        onToggleRef.current();
        clearGo();
        return;
      }

      const key = event.key.toLowerCase();

      if (!goArmed.current) {
        if (key === "g") {
          event.preventDefault();
          goArmed.current = true;
          goTimer.current = window.setTimeout(clearGo, 1200);
        }
        return;
      }

      const href = goRoutes[key];
      clearGo();
      if (!href) return;
      event.preventDefault();
      router.push(href);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearGo();
    };
  }, [router]);

  function handleNavigationKeys(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTypingTarget(event.target)) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a[href], button, summary"))
      .filter(element => element.getClientRects().length > 0 && !element.closest("[hidden]") &&
        (!element.closest("details:not([open])") || element.tagName === "SUMMARY"));
    const index = controls.indexOf(event.target as HTMLElement);
    if (index < 0 || !controls.length) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 :
      (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
    controls[next].focus();
  }

  async function handleSignOut() {
    const supabase = createClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <header className="fieldbook-mobile-header">
        <Link href="/" className="fieldbook-brand">
          <NavIcon name="mountain" />
          Hyked
        </Link>
        <div className="fieldbook-mobile-actions">
          {userEmail ? (
            <button type="button" onClick={handleSignOut}>
              Sign out
            </button>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link>
          )}
          <MoreTools />
        </div>
      </header>
      <aside className="fieldbook-nav" aria-label="Main navigation" data-collapsed={collapsed || undefined} onKeyDown={handleNavigationKeys}>
        <button
          type="button"
          className="fieldbook-nav-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls="sidebar-content"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-keyshortcuts="Control+b Meta+b [ ]"
          title={`${collapsed ? "Expand" : "Collapse"} sidebar · Ctrl/⌘ B or [`}
        >
          <NavIcon name="chevron" style={{ transform: collapsed ? undefined : "rotate(180deg)" }} />
          <span className="fieldbook-nav-label">Collapse sidebar</span>
        </button>
        <div id="sidebar-content" className="fieldbook-nav-content">
          <Link
            href="/"
            className="fieldbook-brand"
            aria-label="Hyked"
            title={collapsed ? "Hyked" : undefined}
          >
            <NavIcon name="mountain" />
            <span className="fieldbook-nav-label">Hyked</span>
          </Link>
          <nav className="fieldbook-destinations" aria-label="Main destinations">
            {navLinks.map((link) => {
              const active =
                link.label === "Explore" ? pathname.startsWith("/explore") : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? link.label : undefined}
                  title={`${link.label} · ${link.hint}`}
                >
                  <NavIcon name={link.icon} />
                  <span className="fieldbook-nav-label">{link.label}</span>
                </Link>
              );
            })}
          </nav>
          <MoreTools collapsed={collapsed} />
          <div className="fieldbook-nav-footer">
            {footerLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={link.className}
                aria-current={pathname.startsWith(link.href) ? "page" : undefined}
                aria-label={collapsed ? link.label : undefined}
                title={`${link.label} · ${link.hint}`}
              >
                <NavIcon name={link.icon} />
                <span className="fieldbook-nav-label">{link.label}</span>
              </Link>
            ))}
            <SyncBadge signedIn={Boolean(userEmail)} />
            <div className="fieldbook-auth">
              {userEmail ? (
                <button type="button" onClick={handleSignOut}>
                  Sign out
                </button>
              ) : (
                <>
                  <Link href="/login">Log in</Link>
                  <Link href="/signup">Create account</Link>
                </>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
