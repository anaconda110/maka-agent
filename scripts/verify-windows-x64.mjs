import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const expectedAppId = 'com.maka.desktop';

// node-pty smoke probe. On Windows ConPTY launches a child process; we drive
// PowerShell's `Write-Output` (the portable equivalent of `/bin/echo`) and
// expect the marker string on stdout.
const ptyProbe = String.raw`
const { createRequire } = require('node:module');
const requireFromApp = createRequire(process.argv[1]);
const pty = requireFromApp('node-pty');
const powershellPath = process.env.SystemRoot
  ? process.env.SystemRoot + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  : 'powershell.exe';
const child = pty.spawn(
  powershellPath,
  ['-NoProfile', '-Command', 'Write-Output maka-node-pty-ok'],
  {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  },
);
let output = '';
const timeout = setTimeout(() => {
  console.error('node-pty packaged smoke timed out');
  process.exit(1);
}, 5000);
child.onData((data) => {
  output += data;
});
child.onExit(({ exitCode }) => {
  clearTimeout(timeout);
  if (exitCode !== 0 || !output.includes('maka-node-pty-ok')) {
    console.error('node-pty packaged smoke failed');
    process.exit(1);
  }
  console.log('maka-node-pty-ok');
});
`;

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      shell: options.shell ?? false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    if (options.input !== undefined) child.stdin.end(options.input);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} failed with ${
            signal ? `signal ${signal}` : `exit code ${code}`
          }\n${stderr.trim()}`,
        ),
      );
    });
  });
}

async function assertMissing(path) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Forbidden release resource exists: ${path}`);
}

async function reserveTcpPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not reserve a CDP port.');
  }
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
  return address.port;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function findRendererTarget(port, child) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged Maka exited before its renderer was ready.`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) => target.type === 'page' && target.webSocketDebuggerUrl,
        );
        if (page) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Packaged Maka renderer did not expose CDP within 30 seconds${
      lastError ? `: ${lastError.message}` : ''
    }.`,
  );
}

async function evaluateRenderer(webSocketDebuggerUrl) {
  if (typeof WebSocket !== 'function') {
    throw new Error('The release verifier requires Node.js WebSocket support.');
  }
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  try {
    return await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('CDP renderer evaluation timed out.'));
      }, 10_000);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        clearTimeout(timeout);
        if (message.error) {
          reject(new Error(message.error.message));
          return;
        }
        resolvePromise(message.result?.result?.value);
      });
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `({
              readyState: document.readyState,
              hasBridge: Boolean(window.maka),
              hasRoot: Boolean(document.querySelector('#root')),
              hasPreloadSkeleton: Boolean(document.querySelector('#root > .maka-preload')),
              hasAppShell: Boolean(document.querySelector('#root [data-agents-page]'))
            })`,
            returnByValue: true,
          },
        }),
      );
    });
  } finally {
    socket.close();
  }
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
    delay(5_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

function isPackagedRendererUsable(rendererState) {
  return (
    rendererState?.readyState === 'complete' &&
    rendererState?.hasBridge === true &&
    rendererState?.hasRoot === true &&
    rendererState?.hasPreloadSkeleton === false &&
    rendererState?.hasAppShell === true
  );
}

export async function smokePackagedFilesystemWorker(
  executable,
  worker,
  { workingDirectory, run = runCommand } = {},
) {
  const workspace = await realpath(workingDirectory);
  const target = join(workspace, 'filesystem-worker-smoke.txt');
  const content = 'maka-filesystem-worker-ok';
  const operationBoundary = {
    filesystem: {
      entries: [{ path: target, access: 'write', scope: 'exact' }],
    },
  };
  const request = {
    version: 4,
    requestId: 'release-filesystem-worker-smoke',
    operation: { kind: 'write', cwd: workspace, path: target, content },
    operationBoundary,
    expectedTarget: {
      enforcementPath: target,
      access: 'write',
      scope: 'exact',
      targetType: 'missing',
    },
  };

  await rm(target, { force: true });
  try {
    const result = await run(executable, [worker], {
      cwd: workspace,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        USERPROFILE: join(workspace, 'worker-home'),
        LOCALAPPDATA: join(workspace, 'worker-home', 'AppData', 'Local'),
        TMPDIR: workspace,
        TEMP: workspace,
        TMP: workspace,
      },
      input: `${JSON.stringify(request)}\n`,
    });
    const response = JSON.parse(result.stdout);
    if (
      response?.ok !== true ||
      response.result?.kind !== 'write' ||
      (await readFile(target, 'utf8')) !== content
    ) {
      throw new Error(`Packaged filesystem worker smoke failed: ${result.stdout.trim()}`);
    }
  } finally {
    await rm(target, { force: true });
  }
}

export async function smokePackagedRenderer(executable, { workingDirectory }) {
  const port = await reserveTcpPort();
  const home = join(workingDirectory, 'home');
  const userData = join(workingDirectory, 'user-data');
  await mkdir(home, { recursive: true });
  await mkdir(userData, { recursive: true });
  const child = spawn(
    executable,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--enable-logging=stderr'],
    {
      cwd: workingDirectory,
      env: {
        ...process.env,
        USERPROFILE: home,
        MAKA_SKIP_SHELL_ENV: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });

  try {
    const target = await findRendererTarget(port, child);
    const deadline = Date.now() + 30_000;
    let rendererState;
    while (Date.now() < deadline) {
      rendererState = await evaluateRenderer(target.webSocketDebuggerUrl);
      if (isPackagedRendererUsable(rendererState)) {
        return;
      }
      if (child.exitCode !== null) {
        throw new Error('Packaged Maka exited before React mounted.');
      }
      await delay(250);
    }
    throw new Error(`Packaged renderer did not become usable: ${JSON.stringify(rendererState)}`);
  } catch (error) {
    throw new Error(`${error.message}${stderr.trim() ? `\n${stderr.trim()}` : ''}`);
  } finally {
    await stopChild(child);
  }
}

// Escape a path for safe embedding inside a PowerShell single-quoted string.
// PowerShell single-quote escaping: replace every ' with ''. Defensively guards
// against exePath containing quotes/special chars even though the path is built
// from trusted inputs (mkdtemp / NSIS /D=) in this script's context. W-6.
function psQuotePath(value) {
  return String(value).replace(/'/g, "''");
}

async function readFileVersion(run, exePath) {
  const { stdout } = await run('powershell.exe', [
    '-NoProfile',
    '-NoLogo',
    '-Command',
    `(Get-Item -LiteralPath '${psQuotePath(exePath)}').VersionInfo.ProductVersion`,
  ]);
  return stdout.trim();
}

async function assertExecutableArchitecture(run, exePath) {
  // Read the PE machine field via PowerShell to confirm the binary is x64
  // (IMAGE_FILE_MACHINE_AMD64 = 0x8664). Reading the raw header keeps the
  // verifier from depending on `dumpbin` or the Windows SDK.
  const { stdout } = await run('powershell.exe', [
    '-NoProfile',
    '-NoLogo',
    '-Command',
    String.raw`
$bytes = [System.IO.File]::ReadAllBytes('${psQuotePath(exePath)}'.Replace('\','/'));
$peOffset = [BitConverter]::ToInt32($bytes, 0x3C);
$machine  = [BitConverter]::ToUInt16($bytes, $peOffset + 4);
if ($machine -ne 0x8664) { Write-Output ('arch=' + $machine.ToString('X4')) } else { Write-Output 'arch=x64' }
`,
  ]);
  const result = stdout.trim();
  if (result !== 'arch=x64') {
    throw new Error(`Maka executable must be x64, found: ${result || 'unknown'}`);
  }
}

async function verifyAuthenticodeSignature(run, exePath) {
  const { stdout } = await run('powershell.exe', [
    '-NoProfile',
    '-NoLogo',
    '-Command',
    `(Get-AuthenticodeSignature -LiteralPath '${psQuotePath(exePath)}').Status`,
  ]);
  const status = stdout.trim();
  // `Valid` requires the signing certificate to chain to a trusted root on the
  // verifying host. CI signing certs (EV / Azure Trusted Signing) usually do.
  // `HashMismatch` / `NotSigned` / `UnknownError` all fail closed here.
  if (status !== 'Valid') {
    throw new Error(`Authenticode signature for ${exePath} was ${status || 'empty'}.`);
  }
}

export async function verifyPackagedWinApp(
  appDirectory,
  {
    run = runCommand,
    requirePath = access,
    forbidPath = assertMissing,
    smokeRenderer = smokePackagedRenderer,
    smokeFilesystemWorker = smokePackagedFilesystemWorker,
    verifySignature = verifyAuthenticodeSignature,
    workingDirectory = dirname(appDirectory),
  } = {},
) {
  const desktopManifest = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
  const resources = join(appDirectory, 'resources');
  const executable = join(appDirectory, 'Maka.exe');
  const filesystemWorker = join(resources, 'workers', 'filesystem-worker.js');
  const appAsar = join(resources, 'app.asar');

  await requirePath(executable);
  await requirePath(appAsar);
  await requirePath(join(resources, 'bundled-tools.json'));
  await requirePath(filesystemWorker);
  await requirePath(join(resources, 'licenses', 'maka', 'LICENSE'));
  await requirePath(join(resources, 'licenses', 'maka', 'NOTICE'));
  await requirePath(join(resources, 'licenses', 'electron', 'LICENSE'));
  await requirePath(join(resources, 'licenses', 'electron', 'LICENSES.chromium.html'));
  await requirePath(join(resources, 'licenses', 'npm', 'THIRD_PARTY_NOTICES.txt'));
  await requirePath(join(resources, 'licenses', 'renderer', 'THIRD_PARTY_LICENSES.txt'));
  await requirePath(join(resources, 'licenses', 'renderer', 'GEIST_LICENSE.txt'));
  await requirePath(join(resources, 'licenses', 'renderer', 'GEIST_MONO_LICENSE.txt'));
  await requirePath(join(resources, 'licenses', 'renderer', 'ANT_DESIGN_ICONS_LICENSE.txt'));
  await requirePath(join(resources, 'licenses', 'renderer', 'SIMPLE_ICONS_LICENSE.md'));
  await requirePath(join(resources, 'licenses', 'renderer', 'TDESIGN_ICONS_LICENSE.txt'));
  await requirePath(join(resources, 'licenses', 'renderer', 'ALLOGO_LICENSE.txt'));
  await requirePath(join(resources, 'licenses', 'renderer', 'SEMI_ICONS_LICENSE.txt'));
  await requirePath(join(resources, 'licenses', 'renderer', 'MINGCUTE_APACHE_LICENSE.txt'));
  await forbidPath(join(resources, 'tools', 'officecli'));
  await forbidPath(join(resources, 'licenses', 'officecli'));
  await forbidPath(join(resources, 'bin', 'cua-driver'));
  await forbidPath(join(resources, 'tools', 'cua-driver'));

  const version = await readFileVersion(run, executable);
  if (version !== desktopManifest.version) {
    throw new Error(`Expected app version ${desktopManifest.version}, found ${version}.`);
  }

  await assertExecutableArchitecture(run, executable);
  await verifySignature(run, executable);

  await run(executable, ['-e', ptyProbe, join(appAsar, 'package.json')], {
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      USERPROFILE: join(workingDirectory, 'pty-home'),
    },
    shell: true,
  });
  await smokeFilesystemWorker(executable, filesystemWorker, { workingDirectory });
  await smokeRenderer(executable, { workingDirectory });
}

async function sha256File(path) {
  const hash = createHash('sha256');
  const file = await import('node:fs').then(({ createReadStream }) => createReadStream(path));
  for await (const chunk of file) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyWindowsX64Nsis(
  inputPath,
  {
    platform = process.platform,
    run = runCommand,
    verifyApp = verifyPackagedWinApp,
  } = {},
) {
  if (platform !== 'win32') {
    throw new Error('NSIS verification requires Windows.');
  }
  if (!inputPath) {
    throw new Error('Usage: npm run verify:windows-x64 -- <path-to-setup.exe>');
  }

  const installerPath = resolve(inputPath);
  await access(installerPath);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'maka-release-verify-'));
  const installedApp = join(temporaryDirectory, 'Maka');

  try {
    // NSIS installers produced by electron-builder accept /S (silent) and
    // /D=<dir> (install directory) — see nsis-options in app-builder-lib.
    await run(installerPath, ['/S', `/D=${installedApp}`], { shell: true });
    const installedExe = join(installedApp, 'Maka.exe');
    await access(installedExe);

    await verifyApp(installedApp, { workingDirectory: temporaryDirectory });
    const sha256 = await sha256File(installerPath);
    const checksumPath = `${installerPath}.sha256`;
    await writeFile(checksumPath, `${sha256}  ${basename(installerPath)}\n`, 'utf8');
    return { installerPath, checksumPath, sha256 };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifyWindowsX64Nsis(process.argv[2]);
  console.log(`Verified ${result.installerPath}`);
  console.log(`SHA-256 ${result.sha256}`);
}