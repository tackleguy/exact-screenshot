import { lazy, Suspense, type ComponentType } from "react";
export default function dynamic<P extends object>(loader: () => Promise<ComponentType<P> | { default: ComponentType<P> }>, options?: { ssr?: boolean; loading?: ComponentType }) {
  const Component = lazy(async () => { const loaded = await loader(); return { default: typeof loaded === "function" ? loaded : (loaded as { default: ComponentType<P> }).default }; });
  const Loading = options?.loading;
  return function Dynamic(props: P) { return <Suspense fallback={Loading ? <Loading /> : null}><Component {...props} /></Suspense>; };
}