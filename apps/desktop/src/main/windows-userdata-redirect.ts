import type { App } from 'electron';
import { join } from 'node:path';

/**
 * Windows: Electron's default `userData` is `%APPDATA%\Maka` (Roaming), which
 * a domain-managed profile can sync across machines. Workspace state — and
 * especially `credentials.json` — must not roam: a copied-roaming credential
 * file is exactly the kind of leak the Local vs Roaming split exists to
 * prevent. Redirect `userData` to `%LOCALAPPDATA%\Maka` on win32 before any
 * store / credential / settings path is derived from it. This also moves
 * every other workspace SQLite / artifact under Local, which is what we want
 * for an app whose state is tied to the machine, not the user profile.
 * `MAKA_WINDOWS_KEEP_ROAMING=1` is an escape hatch for the legacy Roaming
 * layout during testing/migration.
 *
 * Returns the redirected path when the redirect was applied, `undefined`
 * otherwise. Pure relative to its injected deps — safe to unit-test on any
 * platform by passing `platform: 'win32'`.
 *
 * Diagnostic (W-4): when `LOCALAPPDATA` is missing on win32 (rare, but possible
 * on restricted service accounts), the redirect cannot apply and `userData`
 * stays on the default Roaming path — exactly the leak this redirect exists
 * to prevent. Rather than silently leaving credentials in Roaming, we emit a
 * warn so ops can diagnose why credentials are still roaming. The escape
 * hatch and non-win32 paths stay silent.
 */
export function redirectWindowsUserData(
  app: Pick<App, 'setPath' | 'getName'>,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  onWarn: (message: string) => void = (message) => console.warn(message),
): string | undefined {
  if (platform !== 'win32') return undefined;
  if (env.MAKA_WINDOWS_KEEP_ROAMING === '1') return undefined;
  const localAppData = env.LOCALAPPDATA;
  if (!localAppData) {
    // W-4: don't let a missing LOCALAPPDATA silently leave credentials in
    // Roaming. The redirect's whole point is to keep credentials off the
    // roaming profile; without this warn, a service account / stripped SKU
    // would silently keep writing to Roaming with no signal for ops to catch.
    onWarn(
      '[boot] LOCALAPPDATA is not set on Windows; userData was not redirected from Roaming — credentials will be written under the Roaming profile and may sync across machines. Set LOCALAPPDATA or MAKA_WINDOWS_KEEP_ROAMING=1 to suppress this warning if intentional.',
    );
    return undefined;
  }
  try {
    const redirected = join(localAppData, app.getName());
    app.setPath('userData', redirected);
    return redirected;
  } catch (error) {
    onWarn(
      `[boot] failed to redirect userData to Local on Windows: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}