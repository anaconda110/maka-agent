import { app, Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';

/**
 * Windows taskbar / notification-area tray.
 *
 * Windows has no dock and the default `window-all-closed` handler quits the
 * app (see `app-lifecycle.ts`), so a closed window leaves the user with no
 * way back into the app short of re-launching the executable. This module
 * installs a notification-area icon that:
 *   - on left click, focuses the existing window or creates a new one
 *     (same path as `second-instance` / `activate`);
 *   - exposes a context menu with `Show` (same as click) and `Quit`
 *     (runs the coordinator cleanup by calling `app.quit()`, which fires
 *     `before-quit` and reuses the existing graceful shutdown path).
 *
 * The tray is macOS-only-no-op: `process.platform === 'win32'` is the gate,
 * so Linux and macOS keep their existing dock / window-all-closed semantics.
 * Constructed after `app.whenReady()` (Tray requires the app event loop) and
 * destroyed before quit so a destroyed-Tray callback never races shutdown.
 *
 * The `focusOrCreateWindow` callback mirrors the one boot.ts passes to
 * `wireAppLifecycle` for `second-instance` / `activate`: it owns the
 * "window exists -> focus; window gone -> create" decision and reuses the
 * same AbortSignal contract. We pass a never-aborted signal because the
 * tray can outlive any single window creation attempt but should never be
 * cancelled by the quit coordinator (the coordinator's abort is for
 * window-creation-during-shutdown; the tray's own click during shutdown is
 * already impossible because `destroyWindowsTray` runs first).
 */
export interface WindowsTrayController {
  /** Destroy the tray icon and drop the click/menu handlers. Safe to call
   *  multiple times; a no-op when the platform is not win32. */
  destroy(): void;
}

export interface WindowsTrayDeps {
  /** Focus the existing main window, or create a fresh one when none exists.
   *  Same contract as `focusOrCreateMainWindow` in boot.ts. */
  focusOrCreateWindow: (signal: AbortSignal) => void;
}

const TRAY_TOOLTIP = 'Maka';

/**
 * Build and install the Windows notification-area tray icon. Returns the
 * controller (for teardown) or `null` on non-win32 platforms / fixture
 * environments so callers can unconditionally assign the result.
 *
 * The icon resolves from `apps/desktop/assets/icon.png` (same asset the
 * BrowserWindow uses for its title-bar icon on every platform). Tray icons
 * on Windows render at 16x16 / 20x20 / 24x24 depending on DPI; Electron
 * resizes the source PNG, so the 1024px source is fine but we resize it to
 * 16x16 explicitly via `nativeImage.resize` to avoid a fuzzy scaled-down
 * appearance on standard-DPI taskbars.
 */
export function createWindowsTray(deps: WindowsTrayDeps): WindowsTrayController | null {
  if (process.platform !== 'win32') return null;
  // E2E fixture / headless smoke environments have no taskbar to host the
  // icon and no user to click it; skip so a CI run doesn't spawn a tray
  // the test harness never inspects.
  if (process.env.MAKA_E2E_FIXTURE) return null;

  // The asset lives at apps/desktop/assets/icon.png. From a packaged build
  // (dist/main/main.js) and a dev build (src/main/* -> ../.. /assets) the
  // relative offset is the same two-level hop the BrowserWindow icon uses.
  const iconPath = join(import.meta.dirname, '..', '..', 'assets', 'icon.png');
  let image: Electron.NativeImage;
  try {
    image = nativeImage.createFromPath(iconPath);
  } catch (error) {
    console.error('[tray] failed to load tray icon; tray disabled:', error);
    return null;
  }
  if (image.isEmpty()) {
    console.error('[tray] tray icon image is empty; tray disabled:', iconPath);
    return null;
  }
  // Resize for the small notification-area footprint. Windows taskbar icons
  // are 16x16 at 100% DPI; a 1024px source scaled down by the OS looks soft.
  const trayImage = image.resize({ width: 16, height: 16 });

  const tray = new Tray(trayImage);
  tray.setToolTip(TRAY_TOOLTIP);

  // A never-aborted signal is correct here: the tray's focus-or-create path
  // is independent of the quit coordinator's window-creation abort (that
  // abort exists to stop a *shutdown* from racing a *second-instance* window
  // create; the tray is destroyed before quit, so its clicks cannot race).
  const neverAbort = new AbortController().signal;

  const focusOrCreate = () => deps.focusOrCreateWindow(neverAbort);

  // Windows: single left-click focuses/creates the window (matches dock
  // click behavior on macOS). Right-click opens the context menu below.
  tray.on('click', focusOrCreate);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show Maka',
      click: focusOrCreate,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        // Reuse the graceful shutdown path: app.quit() fires `before-quit`,
        // which the AppQuitCoordinator handles to run `runBeforeQuitCleanup`
        // before actually exiting. The tray is torn down via
        // `destroyWindowsTray` during that cleanup so the click handler
        // never fires against a destroyed Tray.
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);

  return {
    destroy() {
      // Remove listeners before destroying so a click that was in flight
      // when the renderer quit began cannot dispatch into a freed Tray.
      try {
        tray.removeAllListeners('click');
        tray.destroy();
      } catch (error) {
        // best-effort: the process is exiting anyway
        console.error('[tray] destroy failed:', error);
      }
    },
  };
}