/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "false" strips the NovaStar exports. See src/config/features.ts. */
  readonly VITE_NOVASTAR_EXPORTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by vite.config.ts from package.json. Shown in the About dialog. */
declare const __APP_VERSION__: string;

interface Window {
  STOATWORKS_ABOUT?: Record<string, string>
}
