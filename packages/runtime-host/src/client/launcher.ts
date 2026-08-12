import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DetachedCandidateInput {
  rootPath: string;
  expectedRootId: string;
  generation?: string;
  initialConnectionTimeoutMs?: number;
  idleGraceMs?: number;
  handshakeTimeoutMs?: number;
  executable?: string;
  entrypoint: string | URL;
  env?: NodeJS.ProcessEnv;
}

export interface DetachedCandidateAttempt {
  pid: number;
}

export interface OwnedCandidateAttempt extends DetachedCandidateAttempt {
  releaseToEnvironment(): void;
  settle(timeoutMs: number): Promise<boolean>;
}

export interface DetachedCandidateLaunch {
  spawned: Promise<DetachedCandidateAttempt>;
}

export type CandidateLauncher = (input: DetachedCandidateInput) => DetachedCandidateLaunch;

export function launchDetachedRuntimeHostCandidate(
  input: DetachedCandidateInput,
): DetachedCandidateLaunch {
  const child = spawnCandidate(input, true);
  const spawned = spawnedPid(child).then(({ pid }) => {
    child.unref();
    return { pid };
  });
  return { spawned };
}

export function launchOwnedRuntimeHostCandidate(input: DetachedCandidateInput): {
  readonly spawned: Promise<OwnedCandidateAttempt>;
} {
  const child = spawnCandidate(input, false);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return {
    spawned: spawnedPid(child).then(({ pid }) => ({
      pid,
      releaseToEnvironment(): void {
        child.unref();
      },
      async settle(timeoutMs: number): Promise<boolean> {
        const result = await within(exited, timeoutMs);
        if (result) return result.code === 0 && result.signal === null;
        child.kill('SIGKILL');
        await exited;
        return false;
      },
    })),
  };
}

function spawnCandidate(input: DetachedCandidateInput, detached: boolean) {
  const executable = input.executable ?? process.execPath;
  const args = [
    typeof input.entrypoint === 'string' ? input.entrypoint : fileURLToPath(input.entrypoint),
    '--root',
    input.rootPath,
    '--expected-root-id',
    input.expectedRootId,
  ];
  appendArgument(args, '--initial-connection-timeout-ms', input.initialConnectionTimeoutMs);
  appendArgument(args, '--idle-grace-ms', input.idleGraceMs);
  appendArgument(args, '--handshake-timeout-ms', input.handshakeTimeoutMs);
  appendArgument(args, '--generation', input.generation);

  // Optional diagnostic logging for the candidate process. When a host fails
  // to become ready, setting MAKA_HOST_LOG_DIR makes the candidate stderr
  // available for inspection instead of being swallowed.
  const stdio = process.env.MAKA_HOST_LOG_DIR ? 'pipe' : 'ignore';

  // spawn() commits the side effect synchronously; spawned only reports that commit's outcome.
  const child = spawn(executable, args, {
    cwd: dirname(isAbsolute(executable) ? executable : process.execPath),
    detached,
    stdio,
    windowsHide: true,
    env: {
      ...process.env,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      ...input.env,
    },
  });
  if (child.stderr && process.env.MAKA_HOST_LOG_DIR) {
    child.stderr.pipe(openDiagnosticLog());
  }
  return child;
}

function openDiagnosticLog(): fs.WriteStream {
  const dir = process.env.MAKA_HOST_LOG_DIR;
  if (!dir) throw new Error('MAKA_HOST_LOG_DIR must be set for diagnostic logging');
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return fs.createWriteStream(join(dir, `maka-host-candidate-${process.pid}-${timestamp}.log`), { flags: 'a' });
}

function spawnedPid(child: ReturnType<typeof spawn>): Promise<DetachedCandidateAttempt> {
  return new Promise<DetachedCandidateAttempt>((resolve, reject) => {
    const onSpawn = () => {
      child.off('error', onError);
      const pid = child.pid;
      if (pid === undefined) {
        reject(new Error('Runtime Host candidate did not receive a process id'));
        return;
      }
      resolve({ pid });
    };
    const onError = (error: Error) => {
      child.off('spawn', onSpawn);
      reject(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

async function within<T>(operation: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function appendArgument(args: string[], key: string, value: string | number | undefined): void {
  if (value === undefined) return;
  args.push(key, String(value));
}
