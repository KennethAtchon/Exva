import type { ExvaApi } from "../preload/exva-api";

declare global {
  interface Window {
    exva?: ExvaApi;
  }
}

export {};
