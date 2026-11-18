/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_APP_ENV?: string;
  readonly VITE_GOOGLE_ENABLED?: string;
  readonly VITE_APP_VERSION?: string;
}
