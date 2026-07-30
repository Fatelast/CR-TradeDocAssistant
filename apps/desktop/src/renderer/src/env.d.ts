/// <reference types="vite/client" />

import type { DesktopApi } from '@rus-trade/shared';

declare global {
  interface Window {
    tradeAssistant: DesktopApi;
  }
}

export {};
