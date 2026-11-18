import type { DesktopBridge } from "../electron/preload.js";

declare global {
  interface Window {
    epocanvas: DesktopBridge;
  }
}
