// Typed wrapper around vue-sileo. The shipped package has a broken `types`
// pointer in its package.json, so we re-export with hand-written types here
// and use this module everywhere instead of importing `vue-sileo` directly.
// @ts-expect-error vue-sileo ships no .d.ts file
import { sileo as _sileo, Toaster as _Toaster } from 'vue-sileo';
import type { DefineComponent } from 'vue';

export type SileoPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface SileoToastOptions {
  title?: string;
  description?: string;
  duration?: number | null;
  position?: SileoPosition;
  button?: { title: string; onClick: () => void };
  [key: string]: unknown;
}

interface SileoApi {
  show: (opts: SileoToastOptions & { type?: string }) => string;
  success: (opts: SileoToastOptions) => string;
  error: (opts: SileoToastOptions) => string;
  warning: (opts: SileoToastOptions) => string;
  info: (opts: SileoToastOptions) => string;
  action: (opts: SileoToastOptions) => string;
  promise: <T>(
    promise: Promise<T> | (() => Promise<T>),
    opts: {
      loading: SileoToastOptions;
      success: SileoToastOptions | ((value: T) => SileoToastOptions);
      error: SileoToastOptions | ((err: unknown) => SileoToastOptions);
      action?: SileoToastOptions | ((value: T) => SileoToastOptions);
      position?: SileoPosition;
    }
  ) => Promise<T>;
  dismiss: (id?: string) => void;
  clear: (position?: SileoPosition) => void;
}

export const sileo = _sileo as SileoApi;

export const Toaster = _Toaster as DefineComponent<{
  position?: SileoPosition;
  offset?: number;
  maxVisibleToasts?: number;
  options?: Record<string, unknown>;
}>;
