import { forwardRef, type AnchorHTMLAttributes } from "react";
import { Link } from "react-router-dom";
type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string | { pathname?: string; query?: Record<string, string> }; prefetch?: boolean; replace?: boolean; scroll?: boolean; /** Router state for the next page (the static app passes the clicked list row). */ state?: unknown };
export default forwardRef<HTMLAnchorElement, Props>(function CompatibleLink({ href, prefetch: _prefetch, scroll: _scroll, replace, state, ...props }, ref) {
  const target = typeof href === "string" ? href : `${href.pathname ?? "/"}${href.query ? `?${new URLSearchParams(href.query)}` : ""}`;
  if (/^(https?:|mailto:|tel:|#)/.test(target) || target.startsWith("/api/")) return <a ref={ref} href={target} {...props} />;
  return <Link ref={ref} to={target} replace={replace} state={state} {...props} />;
});