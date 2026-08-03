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

// Release builds are signed with a p12 certificate via electron-builder's
// built-in signtool integration. CSC_LINK is a base64-encoded p12 (or a path
// to one), and CSC_KEY_PASSWORD is its password. Azure Trusted Signing is not
// supported in this configuration; draft releases only need a p12 signature
// and configuring the Azure path in electron-builder would otherwise ship an
// incomplete signing chain (see .hive/win-code-review.md W-2).
const p12SigningEnvironment = ['CSC_LINK', 'CSC_KEY_PASSWORD'];

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

function resolveSigningMode(env) {
  const p12Missing = p12SigningEnvironment.filter((name) => !env[name]?.trim());
  // Release builds require a complete p12 signing configuration. A partial
  // configuration fails closed so a release cannot silently ship an unsigned
  // binary. Azure Trusted Signing is intentionally not supported here.
  if (p12Missing.length === 0) {
    return 'p12';
  }
  if (p12Missing.length < p12SigningEnvironment.length) {
    throw new Error(
      `p12 signing is partially configured; missing ${p12Missing.join(', ')}.`,
    );
  }
  throw new Error(
    'Release packaging requires p12 signing (CSC_LINK + CSC_KEY_PASSWORD). Azure Trusted Signing is not supported in this configuration.',
  );
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
    throw new Error('Release packaging requires a 64-bit Windows host.');
  }

  const signingMode = resolveSigningMode(env);

  const manifest = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
  const nsisPath = join(releaseDirectory, `Maka-${manifest.version}-win-x64.exe`);
  const portablePath = join(releaseDirectory, `Maka-${manifest.version}-win-x64-portable.exe`);
  const updateMetadataPath = join(releaseDirectory, 'latest.yml');

  for (const path of requiredElectronLicensePaths) {
    await assertFile(path);
  }

  await run('npm', ['run', 'clean']);
  await run('npm', ['run', 'build']);
  await run('npm', ['run', 'check:release']);
  await remove(releaseDirectory, { recursive: true, force: true });
  await run('npm', ['--workspace', '@maka/desktop', 'run', 'package:windows-x64']);
  await assertFile(nsisPath);
  await assertFile(portablePath);
  await assertFile(updateMetadataPath);
  await remove(join(releaseDirectory, 'win-x64'), { recursive: true, force: true });

  return { nsisPath, portablePath, signingMode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await packageWindowsX64();
  console.log(`Created ${result.nsisPath}`);
  console.log(`Created ${result.portablePath}`);
  console.log(`Signing mode: ${result.signingMode}`);
}