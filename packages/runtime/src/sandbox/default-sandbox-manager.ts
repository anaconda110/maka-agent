import { SandboxManager } from './sandbox-manager.js';
import { MacosSeatbeltBackend } from './macos-seatbelt.js';
import { LinuxBubblewrapBackend } from './linux-sandbox.js';
import { detectLinuxSandboxCapability, type LinuxSandboxCapability } from './linux-capability.js';
import type { SandboxPlatform } from './types.js';

export function createDefaultSandboxManager(): SandboxManager {
  return new SandboxManager([new MacosSeatbeltBackend(), new LinuxBubblewrapBackend()]);
}

export function createBuiltinSandboxManager(
  _platform: SandboxPlatform = process.platform,
): SandboxManager {
  return createDefaultSandboxManager();
}

export function isBuiltinFilesystemWorkerSandboxAvailable(
  platform: SandboxPlatform = process.platform,
  linuxCapability: LinuxSandboxCapability | undefined = platform === 'linux'
    ? detectLinuxSandboxCapability({ platform })
    : undefined,
  arch: NodeJS.Architecture = process.arch,
): boolean {
  if (platform === 'darwin') return true;
  // Windows has no built-in Maka sandbox backend (no seatbelt/bwrap
  // equivalent); AppContainer / Windows Sandbox are a future addition. Until
  // then the filesystem worker runs unsandboxed on win32 and the caller must
  // rely on the OS user account boundary, so the built-in sandbox is reported
  // unavailable here.
  if (platform === 'win32') return false;
  return (
    platform === 'linux' &&
    linuxCapability !== undefined &&
    new LinuxBubblewrapBackend({ capability: linuxCapability, arch }).isAvailable('linux')
  );
}
