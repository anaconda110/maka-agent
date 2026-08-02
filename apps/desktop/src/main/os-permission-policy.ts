import type { OsPermissionId, OsPermissionState } from '@maka/core';

export function mapMediaAccessStatus(status: string): OsPermissionState {
  switch (status) {
    case 'granted':
      return 'granted';
    case 'denied':
    case 'restricted':
      return 'denied';
    case 'not-determined':
      return 'not_determined';
    default:
      return 'unknown';
  }
}

export function supportsMediaPermissionProbe(
  id: 'screen_recording' | 'microphone',
  platform: NodeJS.Platform,
): boolean {
  if (id === 'screen_recording') return platform === 'darwin';
  return platform === 'darwin' || platform === 'win32';
}

export function mediaPermissionActions(input: {
  id: 'screen_recording' | 'microphone';
  platform: NodeJS.Platform;
  status: OsPermissionState;
}): { canOpenSettings: boolean; canRequest: boolean } {
  return {
    canOpenSettings:
      input.platform === 'darwin'
        || (input.platform === 'win32' && input.id === 'microphone'),
    canRequest:
      input.platform === 'darwin'
      && input.id === 'microphone'
      && input.status === 'not_determined',
  };
}

export type PermissionRequestPlan =
  | 'unsupported_platform'
  | 'already_granted'
  | 'request_microphone'
  | 'open_settings';

export function planPermissionRequest(input: {
  id: OsPermissionId;
  platform: NodeJS.Platform;
  microphoneStatus?: string;
}): PermissionRequestPlan {
  // Permissions with no system-level consent UI on the platform never make it
  // past the gate; see `phase-a-analysis.md` §1.2 for the Windows matrix.
  if (input.platform === 'darwin') {
    if (input.id !== 'microphone') return 'open_settings';
    if (input.microphoneStatus === 'granted') return 'already_granted';
    if (input.microphoneStatus === 'not-determined') return 'request_microphone';
    return 'open_settings';
  }
  if (input.platform === 'win32') {
    // Windows has no equivalent of `askForMediaAccess`; the first media
    // request triggers a Chromium consent dialog. We can only deep-link to
    // the Privacy pane for the permissions Windows exposes there.
    if (input.id === 'microphone' || input.id === 'notifications') return 'open_settings';
    return 'unsupported_platform';
  }
  return 'unsupported_platform';
}
