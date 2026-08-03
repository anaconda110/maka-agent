/**
 * Cover the electron-builder `win` target configuration. The Windows build
 * ships nsis (installer) + portable (no-install) x64 targets, a sha256
 * signing policy, and an icon — locking these down keeps the release artifact
 * shape stable across CI. The config is an ESM `.mjs` default export, so the
 * test imports it dynamically by absolute path (the file lives outside the
 * compiled `dist/main` tree).
 */

import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';

// The config file is plain ESM (not type-checked), and ships fields the
// `electron-builder` typings don't expose (e.g. `signtoolOptions.hashingAlgorithm`).
// Read it as a loose record so the test pins what's actually on disk without
// fighting the typed `Configuration` shape.
type BuilderConfig = Record<string, unknown> & {
  win?: {
    target?: unknown;
    icon?: unknown;
    signtoolOptions?: Record<string, unknown> | null;
  };
  nsis?: Record<string, unknown>;
  portable?: Record<string, unknown>;
  publish?: unknown[];
};

const desktopRoot = process.cwd().endsWith(join('apps', 'desktop'))
  ? process.cwd()
  : join(process.cwd(), 'apps', 'desktop');

async function loadBuilderConfig(): Promise<BuilderConfig> {
  const configPath = join(desktopRoot, 'electron-builder.config.mjs');
  assert.ok(
    existsSync(configPath),
    `electron-builder.config.mjs not found at ${configPath}`,
  );
  const module = (await import(pathToFileURL(configPath).href)) as {
    default: BuilderConfig;
  };
  return module.default;
}

function asTargetArray(value: unknown): Array<string | { target: string; arch?: string[] }> {
  assert.ok(Array.isArray(value), 'expected an array of targets');
  return value as Array<string | { target: string; arch?: string[] }>;
}

describe('electron-builder.config win target', () => {
  it('declares nsis + portable x64 targets (no other win arches/targets)', async () => {
    const config = await loadBuilderConfig();
    const win = config.win;
    assert.ok(win, 'config.win must be defined');
    const targets = asTargetArray(win.target);
    assert.deepEqual(
      targets.map((t) => (typeof t === 'string' ? t : t.target)),
      ['nsis', 'portable'],
      'win target must be exactly nsis + portable (in order)',
    );
    for (const target of targets) {
      if (typeof target === 'object') {
        assert.deepEqual(
          target.arch,
          ['x64'],
          `win target "${target.target}" must be x64-only`,
        );
      }
    }
  });

  it('uses sha256 signing algorithm (signtoolOptions.hashingAlgorithm)', async () => {
    const config = await loadBuilderConfig();
    assert.equal(config.win?.signtoolOptions?.hashingAlgorithm, 'sha256');
  });

  it('references a win icon (.ico path; .ico or .png source must exist on disk)', async () => {
    const config = await loadBuilderConfig();
    const icon = config.win?.icon;
    assert.ok(typeof icon === 'string' && icon.length > 0, 'config.win.icon must be set');
    // The .ico is produced at build time from assets/icon.png; the repo only
    // ships the .png source. Accept either the declared .ico or a sibling
    // .png (same basename) so this test passes in a clean checkout.
    const icoPath = join(desktopRoot, icon);
    const pngPath = icoPath.replace(/\.ico$/, '.png');
    assert.ok(
      existsSync(icoPath) || existsSync(pngPath),
      `config.win.icon not found on disk (no .ico and no sibling .png): ${icon}`,
    );
  });

  it('nsis: per-machine=false, installer dir changeable, differential package on', async () => {
    const config = await loadBuilderConfig();
    const nsis = config.nsis;
    assert.ok(nsis, 'config.nsis must be defined');
    assert.equal(nsis.oneClick, false, 'nsis must be a two-click installer');
    assert.equal(nsis.perMachine, false, 'nsis installs per-user, not per-machine');
    assert.equal(
      nsis.allowToChangeInstallationDirectory,
      true,
      'nsis must allow custom install dir',
    );
    assert.equal(
      nsis.differentialPackage,
      true,
      'nsis must enable differential update packages',
    );
    assert.ok(
      typeof nsis.uninstallDisplayName === 'string' && nsis.uninstallDisplayName.length > 0,
      'nsis.uninstallDisplayName must be set',
    );
  });

  it('portable artifact name uses the -portable suffix', async () => {
    const config = await loadBuilderConfig();
    const portable = config.portable;
    assert.ok(portable, 'config.portable must be defined');
    assert.match(
      String(portable.artifactName ?? ''),
      /-portable\.\$\{ext\}$/,
      'portable.artifactName must end with -portable.${ext}',
    );
  });

  it('appId/productName are stable (release identity must not drift)', async () => {
    const config = await loadBuilderConfig();
    assert.equal(config.appId, 'com.maka.desktop');
    assert.equal(config.productName, 'Maka');
  });

  it('publish target is github:Maka-Agent/maka-agent', async () => {
    const config = await loadBuilderConfig();
    const publish = config.publish;
    assert.ok(Array.isArray(publish), 'config.publish must be an array');
    const github = (publish as Array<Record<string, unknown>>).find(
      (p) => p.provider === 'github',
    );
    assert.ok(github, 'github publish provider missing');
    assert.equal(github.owner, 'Maka-Agent');
    assert.equal(github.repo, 'maka-agent');
  });
});