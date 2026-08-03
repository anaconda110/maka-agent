/**
 * Cover the Windows `userData` redirect branches extracted into
 * `redirectWindowsUserData`. The redirect must fire only on win32, only when
 * `LOCALAPPDATA` is set, only when the `MAKA_WINDOWS_KEEP_ROAMING` escape
 * hatch is unset, and must derive a Local (not Roaming) path via the app
 * name. Failures inside `app.setPath` must be swallowed to a warning, never
 * thrown out of boot.
 */

import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { redirectWindowsUserData } from '../windows-userdata-redirect.js';

interface FakeApp {
  readonly name: string;
  setPathCalls: Array<{ name: string; path: string }>;
  setPath(name: string, path: string): void;
  getName(): string;
}

function makeApp(appName = 'Maka', setPathImpl?: (path: string) => void): FakeApp {
  const setPathCalls: Array<{ name: string; path: string }> = [];
  return {
    name: appName,
    setPathCalls,
    setPath(name, path) {
      setPathCalls.push({ name, path });
      setPathImpl?.(path);
    },
    getName() {
      return appName;
    },
  };
}

describe('redirectWindowsUserData', () => {
  it('redirects userData to %LOCALAPPDATA%\\<appName> on win32', () => {
    const app = makeApp('Maka');
    const redirected = redirectWindowsUserData(
      app,
      { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      'win32',
    );
    assert.equal(redirected, join('C:\\Users\\test\\AppData\\Local', 'Maka'));
    assert.deepEqual(app.setPathCalls, [
      { name: 'userData', path: join('C:\\Users\\test\\AppData\\Local', 'Maka') },
    ]);
  });

  it('does nothing on darwin', () => {
    const app = makeApp('Maka');
    const redirected = redirectWindowsUserData(
      app,
      { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      'darwin',
    );
    assert.equal(redirected, undefined);
    assert.equal(app.setPathCalls.length, 0);
  });

  it('does nothing on linux', () => {
    const app = makeApp('Maka');
    const redirected = redirectWindowsUserData(
      app,
      { LOCALAPPDATA: '/unused' },
      'linux',
    );
    assert.equal(redirected, undefined);
    assert.equal(app.setPathCalls.length, 0);
  });

  it('skips redirect when MAKA_WINDOWS_KEEP_ROAMING=1 (escape hatch)', () => {
    const app = makeApp('Maka');
    const redirected = redirectWindowsUserData(
      app,
      { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', MAKA_WINDOWS_KEEP_ROAMING: '1' },
      'win32',
    );
    assert.equal(redirected, undefined);
    assert.equal(app.setPathCalls.length, 0);
  });

  it('warns that userData stays in Roaming when LOCALAPPDATA is unset on win32 (W-4 diagnostic)', () => {
    // Without this warn, a service account / stripped Windows SKU would
    // silently keep credentials in the Roaming profile — exactly the leak
    // the redirect exists to prevent. The warn must name LOCALAPPDATA,
    // Roaming, and the escape hatch so ops can diagnose it.
    const warnings: string[] = [];
    const app = makeApp('Maka');
    const redirected = redirectWindowsUserData(
      app,
      {},
      'win32',
      (message) => warnings.push(message),
    );
    assert.equal(redirected, undefined);
    assert.equal(app.setPathCalls.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /LOCALAPPDATA is not set on Windows/);
    assert.match(warnings[0]!, /Roaming/);
    assert.match(warnings[0]!, /MAKA_WINDOWS_KEEP_ROAMING/);
  });

  it('warns that userData stays in Roaming when LOCALAPPDATA is empty string on win32 (W-4 diagnostic)', () => {
    const warnings: string[] = [];
    const app = makeApp('Maka');
    const redirected = redirectWindowsUserData(
      app,
      { LOCALAPPDATA: '' },
      'win32',
      (message) => warnings.push(message),
    );
    assert.equal(redirected, undefined);
    assert.equal(app.setPathCalls.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /LOCALAPPDATA is not set on Windows/);
    assert.match(warnings[0]!, /Roaming/);
  });

  it('uses app.getName() so productName stays the authority for the dir', () => {
    const app = makeApp('Maka-Dev');
    const redirected = redirectWindowsUserData(
      app,
      { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      'win32',
    );
    assert.equal(redirected, join('C:\\Users\\test\\AppData\\Local', 'Maka-Dev'));
  });

  it('warns and returns undefined when app.setPath throws (never escapes boot)', () => {
    const warnings: string[] = [];
    const app = makeApp('Maka', () => {
      throw new Error('userData path not writable');
    });
    const redirected = redirectWindowsUserData(
      app,
      { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      'win32',
      (message) => warnings.push(message),
    );
    assert.equal(redirected, undefined);
    assert.equal(app.setPathCalls.length, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /failed to redirect userData to Local on Windows/);
    assert.match(warnings[0]!, /userData path not writable/);
  });

  it('warns for non-Error throws too', () => {
    const warnings: string[] = [];
    const app = makeApp('Maka', () => {
      throw 'string error';
    });
    const redirected = redirectWindowsUserData(
      app,
      { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      'win32',
      (message) => warnings.push(message),
    );
    assert.equal(redirected, undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /string error/);
  });

  it('defaults to process.env/process.platform when not passed (smoke)', () => {
    // Sanity that the no-arg overload mirrors the explicit-arg overload on the
    // current host. On non-Windows CI this is a no-op; on a Windows CI box with
    // LOCALAPPDATA set it must call setPath once.
    const app = makeApp('Maka');
    redirectWindowsUserData(app);
    if (process.platform === 'win32' && process.env.LOCALAPPDATA && process.env.MAKA_WINDOWS_KEEP_ROAMING !== '1') {
      assert.equal(app.setPathCalls.length, 1);
      assert.equal(app.setPathCalls[0]!.path, join(process.env.LOCALAPPDATA, 'Maka'));
    } else {
      assert.equal(app.setPathCalls.length, 0);
    }
  });
});