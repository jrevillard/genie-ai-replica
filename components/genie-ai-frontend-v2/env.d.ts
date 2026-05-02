/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module 'vue-sileo/styles.css';

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
