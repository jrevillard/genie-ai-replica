/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

interface AppConfig {
  apiUrl: string;
  proxyHost?: string;
  cspConnectSrc?: string;
}

declare global {
  interface Window {
    APP_CONFIG?: AppConfig;
  }
}

export {};
