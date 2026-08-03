import assert from 'node:assert/strict';
import test from 'node:test';

const p12SigningEnvironment = {
  CSC_LINK: 'base64-certificate',
  CSC_KEY_PASSWORD: 'password',
};

test('release tooling fails closed on unsupported hosts, signing, and architecture', async () => {
  const { packageWindowsX64 } = await import(new URL('package-windows-x64.mjs', import.meta.url));
  const { verifyPackagedWinApp } = await import(new URL('verify-windows-x64.mjs', import.meta.url));

  await assert.rejects(
    packageWindowsX64({ platform: 'win32', arch: 'arm64', env: p12SigningEnvironment }),
    /64-bit Windows host/,
  );
  await assert.rejects(
    packageWindowsX64({ platform: 'win32', arch: 'x64', env: {} }),
    /p12 signing/,
  );
  await assert.rejects(
    packageWindowsX64({
      platform: 'win32',
      arch: 'x64',
      env: { CSC_LINK: 'base64-certificate' },
    }),
    /p12 signing is partially configured/,
  );
  await assert.rejects(
    packageWindowsX64({ platform: 'darwin', arch: 'x64', env: p12SigningEnvironment }),
    /64-bit Windows host/,
  );

  await assert.rejects(
    verifyPackagedWinApp('/tmp/Maka-win-unpacked', {
      run: async (command, args) => {
        if (command === 'powershell.exe') {
          const script = args.join(' ');
          if (script.includes('ProductVersion')) return { stdout: '9.9.9\n', stderr: '' };
          if (script.includes('0x8664')) return { stdout: 'arch=x86\n', stderr: '' };
          if (script.includes('Get-AuthenticodeSignature')) return { stdout: 'Valid\n', stderr: '' };
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
      requirePath: async () => {},
      forbidPath: async () => {},
      smokeRenderer: async () => {},
      smokeFilesystemWorker: async () => {},
      verifySignature: async () => {},
    }),
    /Expected app version/,
  );
});

test('release tooling rejects non-x64 and unsigned Windows binaries', async () => {
  const { verifyPackagedWinApp, verifyAuthenticodeSignature } = await import(
    new URL('verify-windows-x64.mjs', import.meta.url)
  );

  await assert.rejects(
    verifyPackagedWinApp('/tmp/Maka-win-unpacked', {
      run: async (command, args) => {
        if (command === 'powershell.exe') {
          const script = args.join(' ');
          if (script.includes('ProductVersion')) return { stdout: '0.1.2\n', stderr: '' };
          if (script.includes('0x8664')) return { stdout: 'arch=0x014C\n', stderr: '' };
          if (script.includes('Get-AuthenticodeSignature')) return { stdout: 'Valid\n', stderr: '' };
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
      requirePath: async () => {},
      forbidPath: async () => {},
      smokeRenderer: async () => {},
      smokeFilesystemWorker: async () => {},
      verifySignature: async () => {},
    }),
    /x64/,
  );

  await assert.rejects(
    verifyPackagedWinApp('/tmp/Maka-win-unpacked', {
      run: async (command, args) => {
        if (command === 'powershell.exe') {
          const script = args.join(' ');
          if (script.includes('ProductVersion')) return { stdout: '0.1.2\n', stderr: '' };
          if (script.includes('0x8664')) return { stdout: 'arch=x64\n', stderr: '' };
          if (script.includes('Get-AuthenticodeSignature')) return { stdout: 'NotSigned\n', stderr: '' };
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
      requirePath: async () => {},
      forbidPath: async () => {},
      smokeRenderer: async () => {},
      smokeFilesystemWorker: async () => {},
      verifySignature: verifyAuthenticodeSignature,
    }),
    /Authenticode signature.*NotSigned/,
  );
});

test('release tooling accepts complete p12 signing mode', () => {
  assert.ok(p12SigningEnvironment.CSC_LINK);
  assert.ok(p12SigningEnvironment.CSC_KEY_PASSWORD);
});

test('release tooling escapes an apostrophe in exePath before embedding it into a PowerShell -Command (W-6)', async () => {
  // PowerShell single-quoted strings escape an embedded `'` by doubling it
  // (`''`). verify-windows-x64.mjs builds the PowerShell ProductVersion /
  // architecture / Authenticode commands by interpolating exePath inside
  // single quotes; a path with an apostrophe (e.g. a user dir like
  // C:\Users\Bob's\Maka-win-unpacked) must be escaped so the `-Command` stays
  // well-formed. The path is built from trusted inputs in this script, so this
  // is a defensive guard — the test locks the psQuotePath behavior down.
  const { verifyPackagedWinApp } = await import(new URL('verify-windows-x64.mjs', import.meta.url));

  const seenScripts = [];
  await assert.rejects(
    verifyPackagedWinApp("/tmp/O'Brien/Maka-win-unpacked", {
      run: async (command, args) => {
        if (command === 'powershell.exe') {
          const script = args.join(' ');
          seenScripts.push(script);
          if (script.includes('ProductVersion')) return { stdout: '9.9.9\n', stderr: '' };
          if (script.includes('0x8664')) return { stdout: 'arch=x64\n', stderr: '' };
          if (script.includes('Get-AuthenticodeSignature')) return { stdout: 'Valid\n', stderr: '' };
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
      requirePath: async () => {},
      forbidPath: async () => {},
      smokeRenderer: async () => {},
      smokeFilesystemWorker: async () => {},
      verifySignature: async () => {},
    }),
    /Expected app version/,
  );

  // The three PowerShell commands must embed the apostrophe as a doubled
  // `''` (PowerShell single-quote escape) — never a bare `'`. If any script
  // contains the unescaped path, the escaping regressed.
  const joined = seenScripts.join('\n');
  assert.ok(joined.includes("O''Brien"), 'apostrophe in exePath is doubled for PowerShell');
  assert.doesNotMatch(joined, /O'Brien/, 'no unescaped apostrophe reaches PowerShell');
});