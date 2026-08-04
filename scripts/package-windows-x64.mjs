import { spawn } from 'node:child_process';
import { access, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const releaseDirectory = join(desktopRoot, 'release');
const electronDistributionDirectory = join(repoRoot, 'node_modules', 'electron', 'dist');
const requiredElectronLicensePaths = [
  join(electronDistributionDirectory, 'LICENSE'),
  join(electronDistributionDirectory, 'LICENSES.chromium.html'),
];

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} failed with ${
            signal ? `signal ${signal}` : `exit code ${code}`
          }`,
        ),
      );
    });
  });
}

export async function packageWindowsX64({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  run = runCommand,
  remove = rm,
  assertFile = access,
} = {}) {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error('Release packaging requires a Windows x64 host.');
  }

  const manifest = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
  const nsisPath = join(releaseDirectory, `Maka-${manifest.version}-win-x64.exe`);
  const portablePath = join(releaseDirectory, `Maka-${manifest.version}-win-x64-portable.exe`);

  for (const path of requiredElectronLicensePaths) {
    await assertFile(path);
  }

  await run('npm', ['run', 'clean']);
  await run('npm', ['run', 'build']);
  await run('npm', ['run', 'check:release']);
  await remove(releaseDirectory, { recursive: true, force: true });
  await run('npx', [
    'electron-builder',
    '--config',
    join('apps', 'desktop', 'electron-builder.config.mjs'),
    '--win',
    '--x64',
    '--publish',
    'never',
  ]);
  await assertFile(nsisPath);
  await assertFile(portablePath);

  return { nsisPath, portablePath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { nsisPath, portablePath } = await packageWindowsX64();
  console.log(`Created NSIS installer: ${nsisPath}`);
  console.log(`Created portable: ${portablePath}`);
}