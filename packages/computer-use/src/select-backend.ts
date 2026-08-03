import {
  buildComputerUseTools,
  type CuOverlayHook,
  type ComputerUseToolSet,
  type CuDispatchBackend,
} from '@maka/runtime';
import { createCuaDriverBackend } from './cua-driver-backend.js';
import type { CuaDriverBackendOptions } from './cua-driver-backend.js';
import type { CuaDriverRoleSnapshot } from './cua-driver-release.js';

export type CuBackendId = 'cua-driver';

type DisposableBackend = CuDispatchBackend & {
  clearSession?: (sessionId: string) => void;
  dispose?: () => void;
  serviceState?: () => {
    action: CuaDriverRoleSnapshot;
    capture: CuaDriverRoleSnapshot;
  };
};

export interface SelectedComputerUseBackend {
  backend?: DisposableBackend;
  tools: ComputerUseToolSet;
  backendId: CuBackendId | 'none';
}

function emptyTools(): ComputerUseToolSet {
  const tools = [] as unknown as ComputerUseToolSet;
  tools.clearSession = () => {};
  const snapshot = () => ({ status: 'unobserved' as const, generation: 0 });
  tools.sessionEvents = {
    snapshot,
    physicalUserIntervened: snapshot,
    interventionDebounceElapsed: snapshot,
    reobserveRequired: snapshot,
    screenLocked: snapshot,
    screenUnlocked: snapshot,
    blockedUrlDetected: snapshot,
    userStopped: snapshot,
    dynamicContentChanged: snapshot,
  };
  return tools;
}

const NONE: SelectedComputerUseBackend = {
  backend: undefined,
  tools: emptyTools(),
  backendId: 'none',
};

function resolveHostBundleId(explicit?: string): string {
  return explicit ?? process.env.MAKA_CU_HOST_BUNDLE_ID ?? 'com.maka.desktop';
}

export function selectComputerUseBackend(deps?: {
  binaryPath?: string;
  hostBundleId?: string;
  expectedBinarySha256?: string;
  expectedServerName?: string;
  expectedServerVersion?: string;
  expectedProtocolVersion?: string;
  compressFrame?: (
    base64: string,
    mimeType: string,
  ) => { base64: string; mimeType: 'image/png' | 'image/jpeg' };
  physicalInputRecentlyActive?: () => boolean | Promise<boolean>;
  onTrace?: CuaDriverBackendOptions['onTrace'];
  overlay?: CuOverlayHook;
  createBackend?: (options: CuaDriverBackendOptions) => DisposableBackend;
}): SelectedComputerUseBackend {
  // Windows (win32) + Linux: the cua-driver binary is a macOS-only native
  // helper (signing/notarization + Accessibility/Screen Recording API), so
  // there is no Windows backend to wire. Returning NONE here makes the
  // Computer Use capability surface as `not_available` end-to-end:
  // `createComputerUseHost` falls through to `selectComputerUseBackend()`
  // (no args) on every error/missing-artifact path, and
  // `capability-snapshot.ts` maps `backendId === 'none'` to
  // `feature.state = 'not_available'`, which the permission-center UI
  // renders as an explicit "Unavailable" row — no separate UI entry to
  // hide. This is the intended graceful degradation on Windows; do not
  // remove the `process.platform !== 'darwin'` guard without first
  // landing a Windows-native cua-driver backend and an `os-permission`
  // branch for accessibility/screen capture on win32.
  if (process.platform !== 'darwin') return NONE;
  if (!deps?.binaryPath || !deps.expectedBinarySha256) return NONE;
  try {
    let tools: ComputerUseToolSet | undefined;
    const backend = (deps.createBackend ?? createCuaDriverBackend)({
      binaryPath: deps.binaryPath,
      hostBundleId: resolveHostBundleId(deps?.hostBundleId),
      expectedBinarySha256: deps.expectedBinarySha256,
      ...(deps.expectedServerName ? { expectedServerName: deps.expectedServerName } : {}),
      ...(deps.expectedServerVersion ? { expectedServerVersion: deps.expectedServerVersion } : {}),
      ...(deps.expectedProtocolVersion
        ? { expectedProtocolVersion: deps.expectedProtocolVersion }
        : {}),
      ...(deps?.compressFrame ? { compressFrame: deps.compressFrame } : {}),
      ...(deps?.physicalInputRecentlyActive
        ? { physicalInputRecentlyActive: deps.physicalInputRecentlyActive }
        : {}),
      ...(deps?.onTrace ? { onTrace: deps.onTrace } : {}),
      onSessionInvalidated: ({ sessionId }) => {
        tools?.sessionEvents.reobserveRequired(sessionId);
      },
    });
    tools = buildComputerUseTools({
      backend,
      ...(deps.overlay ? { overlay: deps.overlay } : {}),
    });
    return {
      backend,
      tools,
      backendId: 'cua-driver',
    };
  } catch {
    return NONE;
  }
}
