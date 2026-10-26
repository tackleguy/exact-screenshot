"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "./NavIcon";
import { navActive } from "./NavBar";
const links = [
  { href: "/explore/trails/catalog", label: "Explore", icon: "explore" as const },
  { href: "/explore/trails", label: "Map", icon: "map" as const },
  { href: "/plan", label: "My trips", icon: "trips" as const },
  { href: "/gear", label: "Gear", icon: "gear" as const },
  { href: "/you", label: "Profile", icon: "profile" as const },
];
export function BottomNav() {
  const pathname = usePathname();
  return <nav className="fieldbook-bottom-nav" aria-label="Main destinations">{links.map(link => <Link key={link.href} href={link.href} aria-current={navActive(link.label, link.href, pathname) ? "page" : undefined}><NavIcon name={link.icon} /><span>{link.label}</span></Link>)}</nav>;
}
