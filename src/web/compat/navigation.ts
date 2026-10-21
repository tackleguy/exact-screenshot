import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
export { useParams } from "react-router-dom";
export function usePathname() { return useLocation().pathname; }
export function useSearchParams() { const { search } = useLocation(); return useMemo(() => new URLSearchParams(search), [search]); }
export function useRouter() {
  const navigate = useNavigate();
  return useMemo(() => ({ push: (url: string) => navigate(url), replace: (url: string) => navigate(url, { replace: true }), back: () => navigate(-1), forward: () => navigate(1), refresh: () => window.dispatchEvent(new Event("hyked:refresh")), prefetch: () => Promise.resolve() }), [navigate]);
}