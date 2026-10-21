import { forwardRef, type AnchorHTMLAttributes } from "react";
import { Link } from "react-router-dom";
type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string | { pathname?: string; query?: Record<string, string> }; prefetch?: boolean; replace?: boolean; scroll?: boolean };
export default forwardRef<HTMLAnchorElement, Props>(function CompatibleLink({ href, prefetch: _prefetch, scroll: _scroll, replace, ...props }, ref) {
  const target = typeof href === "string" ? href : `${href.pathname ?? "/"}${href.query ? `?${new URLSearchParams(href.query)}` : ""}`;
  if (/^(https?:|mailto:|tel:|#)/.test(target) || target.startsWith("/api/")) return <a ref={ref} href={target} {...props} />;
  return <Link ref={ref} to={target} replace={replace} {...props} />;
});