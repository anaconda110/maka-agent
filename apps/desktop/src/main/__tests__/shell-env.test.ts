/**
 * PR #1316 review coverage: lock the per-shell capture-command quoting, the
 * marker-adjacency contract (which is why the dead xonsh branch was dropped),
 * and the public capture path. Same `node:test` + `node:assert/strict` layout
 * as `build-info.test.ts`.
 */

import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  buildCaptureCommand,
  buildMarkerRegex,
  captureWindowsPath,
  resolveShellEnv,
  selectLoginShell,
  selectWindowsShell,
  type SpawnFn,
} from '../shell-env.js';

const MARK = '0123456789ab';

function snapshotEnv(): () => void {
  const before = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    before.set(key, value as string);
  }
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!before.has(key)) delete process.env[key];
    }
    for (const [key, value] of before) process.env[key] = value;
  };
}

async function createFakeShell(body: string): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'maka-shell-env-'));
  const path = join(directory, 'fake-shell');
  await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  return {
    path,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function readPid(path: string): Promise<number> {
  const pid = Number.parseInt(await readFile(path, 'utf8'), 10);
  assert.ok(Number.isInteger(pid) && pid > 0);
  return pid;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function assertProcessExited(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await delay(20);
  }
  assert.fail(`process ${pid} remained alive after shell capture settled`);
}

function terminateIfAlive(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

describe('resolveShellEnv', () => {
  it(
    'imports the login PATH without importing application control variables',
    { skip: process.platform === 'win32' },
    async () => {
      const restoreEnv = snapshotEnv();
      const shell = await createFakeShell(`
(
  trap '' HUP TERM
  sleep 60
) </dev/null >/dev/null 2>&1 &
printf '%s' "$!" > "$SHELL_ENV_TEST_PID_FILE"
export PATH='/resolved/bin:/usr/bin'
export MAKA_E2E_FIXTURE='first-run'
export VITE_DEV_SERVER_URL='https://example.invalid/renderer'
export XDG_RUNTIME_DIR='/shell/runtime'
exec /bin/sh -c "$4"
`);
      const pidFile = `${shell.path}.pid`;
      let descendantPid: number | undefined;
      try {
        process.env.SHELL = shell.path;
        process.env.SHELL_ENV_TEST_PID_FILE = pidFile;
        process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
        process.env.XDG_RUNTIME_DIR = '/original/runtime';
        delete process.env.TERM;
        delete process.env.COLORTERM;
        delete process.env.MAKA_SKIP_SHELL_ENV;
        delete process.env.MAKA_E2E_FIXTURE;
        delete process.env.VITE_DEV_SERVER_URL;
        delete process.env.ELECTRON_RUN_AS_NODE;
        delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

        await resolveShellEnv();
        descendantPid = await readPid(pidFile);

        assert.equal(process.env.PATH, '/resolved/bin:/usr/bin');
        assert.equal(process.env.MAKA_E2E_FIXTURE, undefined);
        assert.equal(process.env.VITE_DEV_SERVER_URL, undefined);
        assert.equal(process.env.XDG_RUNTIME_DIR, '/original/runtime');
        assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined);
        assert.equal(process.env.ELECTRON_NO_ATTACH_CONSOLE, undefined);
        await assertProcessExited(descendantPid);
      } finally {
        terminateIfAlive(descendantPid);
        restoreEnv();
        await shell.cleanup();
      }
    },
  );

  it(
    'keeps the inherited PATH and does not log shell stderr when capture fails',
    { skip: process.platform === 'win32' },
    async () => {
      const restoreEnv = snapshotEnv();
      const shell = await createFakeShell(`
(
  trap '' HUP TERM
  sleep 60
) </dev/null >/dev/null 2>&1 &
printf '%s' "$!" > "$SHELL_ENV_TEST_PID_FILE"
printf 'secret-from-shell-startup' >&2
exit 23
`);
      const pidFile = `${shell.path}.pid`;
      let descendantPid: number | undefined;
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
      try {
        process.env.SHELL = shell.path;
        process.env.SHELL_ENV_TEST_PID_FILE = pidFile;
        process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
        delete process.env.TERM;
        delete process.env.COLORTERM;
        delete process.env.MAKA_SKIP_SHELL_ENV;

        await resolveShellEnv();
        descendantPid = await readPid(pidFile);

        assert.equal(process.env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
        assert.match(warnings.join('\n'), /exited with code 23/);
        assert.doesNotMatch(warnings.join('\n'), /secret-from-shell-startup/);
        await assertProcessExited(descendantPid);
      } finally {
        terminateIfAlive(descendantPid);
        console.warn = originalWarn;
        restoreEnv();
        await shell.cleanup();
      }
    },
  );

  it(
    'kills login-shell descendants when capture times out',
    { skip: process.platform === 'win32' },
    async () => {
      const restoreEnv = snapshotEnv();
      const shell = await createFakeShell(`
(
  trap '' HUP TERM
  sleep 60
) </dev/null >/dev/null 2>&1 &
printf '%s' "$!" > "$SHELL_ENV_TEST_PID_FILE"
wait
`);
      const pidFile = `${shell.path}.pid`;
      let descendantPid: number | undefined;
      const originalWarn = console.warn;
      console.warn = () => {};
      try {
        process.env.SHELL = shell.path;
        process.env.SHELL_ENV_TEST_PID_FILE = pidFile;
        process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
        delete process.env.TERM;
        delete process.env.COLORTERM;
        delete process.env.MAKA_SKIP_SHELL_ENV;

        await resolveShellEnv(1_000);
        descendantPid = await readPid(pidFile);

        await assertProcessExited(descendantPid);
        assert.equal(process.env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
      } finally {
        terminateIfAlive(descendantPid);
        console.warn = originalWarn;
        restoreEnv();
        await shell.cleanup();
      }
    },
  );

  it(
    'does not execute the shell when MAKA_SKIP_SHELL_ENV is set',
    { skip: process.platform === 'win32' },
    async () => {
      const restoreEnv = snapshotEnv();
      const shell = await createFakeShell(`
printf 'executed' > "$SHELL_ENV_TEST_SENTINEL_FILE"
exit 0
`);
      const sentinelFile = `${shell.path}.executed`;
      try {
        process.env.SHELL = shell.path;
        process.env.SHELL_ENV_TEST_SENTINEL_FILE = sentinelFile;
        process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
        process.env.MAKA_SKIP_SHELL_ENV = '1';
        delete process.env.TERM;
        delete process.env.COLORTERM;

        await resolveShellEnv();

        assert.equal(process.env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
        await assert.rejects(readFile(sentinelFile));
      } finally {
        restoreEnv();
        await shell.cleanup();
      }
    },
  );

  it(
    'bounds shell output instead of buffering until the global timeout',
    { skip: process.platform === 'win32' },
    async () => {
      const restoreEnv = snapshotEnv();
      const shell = await createFakeShell(`
while :; do
  printf '0123456789abcdef0123456789abcdef'
done
`);
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
      try {
        process.env.SHELL = shell.path;
        process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
        delete process.env.TERM;
        delete process.env.COLORTERM;
        delete process.env.MAKA_SKIP_SHELL_ENV;

        await resolveShellEnv(2_000);

        assert.match(warnings.join('\n'), /shell output exceeded 65536 bytes/);
        assert.equal(process.env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
      } finally {
        console.warn = originalWarn;
        restoreEnv();
        await shell.cleanup();
      }
    },
  );
});

describe('captureWindowsPath', () => {
  // The PowerShell capture command embeds the random marker twice; the mock
  // spawn extracts it from the argv so tests can echo a marker-wrapped body
  // that matches whatever random mark the function generated this run. Works
  // for both the PowerShell branch (`'''<mark>''`) and the POSIX branch
  // (`"<mark>"`): a 12-hex-char run flanked by quotes on both sides.
  const MARKER_RE = /["']([0-9a-f]{12})["']/;

  function extractMark(argv: string[]): string | undefined {
    // The command is the last argv element: `& '<execPath>' -p '''<mark>'' + ...`
    const command = argv[argv.length - 1];
    if (typeof command !== 'string') return undefined;
    const match = command.match(MARKER_RE);
    return match ? match[1] : undefined;
  }

  // Builds a fake `spawn` that returns a mock ChildProcess whose stdout/stderr
  // are PassThrough streams. The `script` callback runs on `setImmediate` so
  // the promise executor has already attached its `data`/`close` listeners by
  // the time the script writes to the streams — this keeps the data-before-close
  // ordering deterministic. No real PowerShell is launched.
  function makeMockSpawn(
    script: (argv: string[], io: { stdout: PassThrough; stderr: PassThrough; emitClose: (code: number | null, signal?: NodeJS.Signals | null) => void; emitError: (err: Error) => void }) => void,
  ): SpawnFn {
    return (((
      _cmd: string,
      argv: string[],
      _opts: unknown,
    ) => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const ee = new EventEmitter();
      const child = Object.assign(ee, {
        stdout,
        stderr,
        pid: 99999,
        kill: () => true,
      });
      const emitClose = (code: number | null, signal?: NodeJS.Signals | null) => {
        process.nextTick(() => child.emit('close', code, signal ?? null));
      };
      const emitError = (err: Error) => {
        process.nextTick(() => child.emit('error', err));
      };
      setImmediate(() => script(argv, { stdout, stderr, emitClose, emitError }));
      return child;
    }) as unknown) as SpawnFn;
  }

  it('rejects when the spawned shell exits with a non-zero code and does not surface stderr', async () => {
    const spawnFn = makeMockSpawn((_argv, { stderr, stdout, emitClose }) => {
      // Profile noise / secrets must never be retained or surfaced: the reject
      // message must mention the exit code but never echo the stderr bytes.
      stderr.write('secret-from-profile\r\n');
      stderr.end();
      stdout.end();
      emitClose(23);
    });
    // captureWindowsPath rejects (it does not log); resolveShellEnv is the
    // layer that converts the rejection into a console.warn, tested separately.
    // `assert.rejects` returns void, so capture the rejection Error ourselves
    // to assert the message does NOT carry shell-controlled stderr.
    let captured: unknown;
    try {
      await captureWindowsPath(5_000, spawnFn);
      assert.fail('expected captureWindowsPath to reject');
    } catch (err) {
      captured = err;
    }
    const message = captured instanceof Error ? captured.message : String(captured);
    assert.match(message, /exited with code 23/);
    // The rejection Error message must NOT carry shell-controlled stderr.
    assert.doesNotMatch(message, /secret-from-profile/);
  });

  it('rejects when the spawned shell exits null (signal) with no marker in stdout', async () => {
    const spawnFn = makeMockSpawn((_argv, { stdout, stderr, emitClose }) => {
      // stdout contains noise but no flush markers → "could not find PATH markers".
      stdout.write('Windows PowerShell\r\nCopyright (C) Microsoft Corporation.\r\n');
      stdout.end();
      stderr.end();
      emitClose(null, 'SIGTERM');
    });
    await assert.rejects(captureWindowsPath(5_000, spawnFn), /could not find PATH markers/);
  });

  it('rejects when stdout has no marker despite a zero exit code', async () => {
    const spawnFn = makeMockSpawn((_argv, { stdout, stderr, emitClose }) => {
      stdout.write('noise without any markers here');
      stdout.end();
      stderr.end();
      emitClose(0);
    });
    await assert.rejects(captureWindowsPath(5_000, spawnFn), /could not find PATH markers/);
  });

  it('rejects when stdout contains a marker body that is not valid JSON', async () => {
    const spawnFn = makeMockSpawn((argv, { stdout, stderr, emitClose }) => {
      const mark = extractMark(argv);
      assert.ok(mark, 'mock extracted the marker from the capture command');
      const payload = `${mark}{not-json}${mark}`;
      stdout.write(payload);
      stdout.end();
      stderr.end();
      emitClose(0);
    });
    await assert.rejects(captureWindowsPath(5_000, spawnFn), /failed to parse Windows PATH JSON/);
  });

  it('rejects when the captured JSON has an empty PATH', async () => {
    const spawnFn = makeMockSpawn((argv, { stdout, stderr, emitClose }) => {
      const mark = extractMark(argv);
      assert.ok(mark, 'mock extracted the marker from the capture command');
      const payload = `${mark}${JSON.stringify({ PATH: '' })}${mark}`;
      stdout.write(payload);
      stdout.end();
      stderr.end();
      emitClose(0);
    });
    // The empty-PATH validation is separate from JSON.parse: a valid JSON
    // body with `PATH: ''` parses fine but fails the non-empty PATH check,
    // surfacing the dedicated "did not provide PATH" message rather than
    // being swallowed by the parse catch (a prior bug where the validation
    // `throw` lived inside the parse `try` and was masked as a parse failure).
    await assert.rejects(captureWindowsPath(5_000, spawnFn), /did not provide PATH/);
  });

  it('rejects when stdout exceeds the 64KiB capture bound', async () => {
    const spawnFn = makeMockSpawn((_argv, { stdout, stderr, emitClose }) => {
      // Emit >64KiB of marker-free noise on stderr (counted toward the bound).
      // The bound rejection must win over the subsequent close(0).
      stderr.write(Buffer.alloc(70 * 1024, 0x41));
      stderr.end();
      stdout.end();
      emitClose(0);
    });
    await assert.rejects(captureWindowsPath(5_000, spawnFn), /shell output exceeded 65536 bytes/);
  });

  it('rejects when the spawn itself errors (missing PowerShell binary)', async () => {
    const spawnFn = makeMockSpawn((_argv, { emitError }) => {
      emitError(new Error('spawn powershell.exe ENOENT'));
    });
    await assert.rejects(captureWindowsPath(5_000, spawnFn), /failed to spawn/);
  });

  it('rejects when the timeout fires before the shell settles', async () => {
    const spawnFn = makeMockSpawn(() => {
      // Never emit close; the timeout must drive the rejection.
    });
    await assert.rejects(captureWindowsPath(50, spawnFn), /timed out after 50ms/);
  });

  it('resolves with the captured PATH when the markers round-trip cleanly', async () => {
    const resolvedPath = 'C:\\Windows\\System32;C:\\Users\\me\\scoop\\shims';
    const spawnFn = makeMockSpawn((argv, { stdout, stderr, emitClose }) => {
      const mark = extractMark(argv);
      assert.ok(mark, 'mock extracted the marker from the capture command');
      const payload = `${mark}${JSON.stringify({ PATH: resolvedPath })}${mark}`;
      stdout.write(payload);
      stdout.end();
      stderr.end();
      emitClose(0);
    });
    const result = await captureWindowsPath(5_000, spawnFn);
    assert.equal(result, resolvedPath);
  });
});

describe('selectLoginShell', () => {
  it('prefers the inherited shell over the account shell', () => {
    assert.equal(selectLoginShell('/bin/bash', '/bin/fish', 'darwin'), '/bin/bash');
  });

  it('uses the OS account shell when GUI launch omitted SHELL', () => {
    assert.equal(selectLoginShell(undefined, '/bin/fish', 'linux'), '/bin/fish');
  });

  it('uses platform-appropriate defaults only when neither source has a shell', () => {
    assert.equal(selectLoginShell(undefined, undefined, 'darwin'), '/bin/zsh');
    assert.equal(selectLoginShell(undefined, undefined, 'linux'), '/bin/sh');
  });
});

describe('selectWindowsShell', () => {
  it('prefers pwsh.exe when the env explicitly points at it', () => {
    assert.equal(selectWindowsShell('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'C:\\Program Files\\PowerShell\\7\\pwsh.exe');
  });

  it('keeps an inherited powershell.exe', () => {
    assert.equal(selectWindowsShell('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it('falls back to the always-available powershell.exe when nothing is inherited', () => {
    assert.equal(selectWindowsShell(undefined), 'powershell.exe');
  });
});

describe('buildCaptureCommand', () => {
  describe('POSIX family (bash / zsh / fish / sh)', () => {
    it('zsh produces the -i -l -c argv and a flush-marker payload', () => {
      const { command, shellArgs } = buildCaptureCommand('zsh', '/usr/bin/node', MARK);
      assert.deepEqual(shellArgs, ['-i', '-l', '-c']);
      assert.equal(
        command,
        `'/usr/bin/node' -p '"${MARK}" + JSON.stringify({ PATH: process.env.PATH }) + "${MARK}"'`,
      );
      // The payload concatenates mark + JSON + mark with no separator, so the
      // emitted bytes are `<mark>{...}<mark>` — markers flush against the
      // braces the capture regex anchors on.
      const emitted = `${MARK}${JSON.stringify({ PATH: '/usr/bin' })}${MARK}`;
      const match = buildMarkerRegex(MARK).exec(emitted);
      assert.ok(match);
      assert.equal(match[1], JSON.stringify({ PATH: '/usr/bin' }));
    });

    it('tcsh / csh collapse to the legacy single -ic argv', () => {
      const tcsh = buildCaptureCommand('tcsh', '/usr/bin/node', MARK);
      assert.deepEqual(tcsh.shellArgs, ['-ic']);
      const csh = buildCaptureCommand('csh', '/usr/bin/node', MARK);
      assert.deepEqual(csh.shellArgs, ['-ic']);
      // Same flush-marker payload as the rest of the POSIX family.
      assert.equal(
        tcsh.command,
        `'/usr/bin/node' -p '"${MARK}" + JSON.stringify({ PATH: process.env.PATH }) + "${MARK}"'`,
      );
    });

    it('round-trips an apostrophe in execPath via the close-quote / escape / reopen sequence', () => {
      // POSIX single-quoting cannot contain a literal `'`; the safe escape is
      // to close the quote, emit a backslash-escaped quote, and reopen.
      const { command, shellArgs } = buildCaptureCommand('bash', "/Users/Bob's/node", MARK);
      assert.deepEqual(shellArgs, ['-i', '-l', '-c']);
      assert.equal(
        command,
        `'/Users/Bob'\\''s/node' -p '"${MARK}" + JSON.stringify({ PATH: process.env.PATH }) + "${MARK}"'`,
      );
    });
  });

  describe('PowerShell', () => {
    it('uses -Login -Command and doubles an embedded apostrophe', () => {
      const { command, shellArgs } = buildCaptureCommand('pwsh', "/Users/Bob's/node", MARK);
      assert.deepEqual(shellArgs, ['-Login', '-Command']);
      // PowerShell single-quoted strings escape `'` as `''`.
      assert.equal(
        command,
        `& '/Users/Bob''s/node' -p '''${MARK}'' + JSON.stringify({ PATH: process.env.PATH }) + ''${MARK}'''`,
      );
    });

    it('matches powershell-preview too and leaves an apostrophe-free path untouched', () => {
      const { command, shellArgs } = buildCaptureCommand('powershell-preview', '/usr/bin/node', MARK);
      assert.deepEqual(shellArgs, ['-Login', '-Command']);
      assert.equal(
        command,
        `& '/usr/bin/node' -p '''${MARK}'' + JSON.stringify({ PATH: process.env.PATH }) + ''${MARK}'''`,
      );
    });
  });

  describe('nu', () => {
    it('uses a raw string and -i -l -c (embedded quotes are a documented edge case)', () => {
      const { command, shellArgs } = buildCaptureCommand('nu', '/usr/bin/node', MARK);
      assert.deepEqual(shellArgs, ['-i', '-l', '-c']);
      assert.equal(
        command,
        `^'/usr/bin/node' -p '"${MARK}" + JSON.stringify({ PATH: process.env.PATH }) + "${MARK}"'`,
      );
    });
  });

  it('xonsh falls into the POSIX branch (the dedicated branch is gone)', () => {
    // xonsh is intentionally unsupported. It must NOT get a special argv and
    // must share the POSIX payload — proving the dead branch was removed.
    const { command, shellArgs } = buildCaptureCommand('xonsh', '/usr/bin/node', MARK);
    assert.deepEqual(shellArgs, ['-i', '-l', '-c']);
    assert.equal(
      command,
      `'/usr/bin/node' -p '"${MARK}" + JSON.stringify({ PATH: process.env.PATH }) + "${MARK}"'`,
    );
  });
});

describe('buildMarkerRegex', () => {
  it('matches <mark>{...}<mark> and captures the JSON body', () => {
    const regex = buildMarkerRegex(MARK);
    const match = regex.exec(`${MARK}${JSON.stringify({ k: 'v' })}${MARK}`);
    assert.ok(match);
    assert.equal(match[1], JSON.stringify({ k: 'v' }));
  });

  it('captures the body across newlines (dotall via [\\s\\S])', () => {
    const body = `{
  "PATH": "/usr/bin"
}`;
    const match = buildMarkerRegex(MARK).exec(`${MARK}${body}${MARK}`);
    assert.ok(match);
    assert.equal(match[1], body);
  });

  it('does NOT match the old xonsh shape `mark {...} mark` (space-separated)', () => {
    // The dropped xonsh branch ran Python `print(mark, json, mark)`, whose
    // default sep joins args with a SPACE — producing `mark {...} mark`. That
    // shape never satisfied the flush-marker regex, which is exactly why the
    // branch was dead. This test is the guard that would have caught review
    // item #3 before it shipped.
    const xonshShape = `${MARK} {"k":"v"} ${MARK}`;
    assert.equal(buildMarkerRegex(MARK).exec(xonshShape), null);
  });
});
