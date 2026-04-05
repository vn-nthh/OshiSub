// Type declaration for vite-plugin-cross-origin-isolation
declare module 'vite-plugin-cross-origin-isolation' {
  import type { Plugin } from 'vite';
  const crossOriginIsolation: () => Plugin;
  export default crossOriginIsolation;
}
