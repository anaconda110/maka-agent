import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSqliteModelCallLedger, createSqliteTelemetryRepo } from '@maka/storage';
import { registerUsageIpc, type UsageIpcDeps } from '../usage-ipc-main.js';

type Handler = (...args: any[]) => any;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('usage IPC leaves settings usage session-derived while detailed usage waits for SQLite readiness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'maka-usage-ipc-ready-'));
  const seeded = createSqliteTelemetryRepo(root);
  const telemetryRepo = createSqliteTelemetryRepo(root, { createIfMissing: false });
  const modelCallLedger = createSqliteModelCallLedger(root);
  const ready = deferred();
  const handlers = new Map<string, Handler>();
  const calls: string[] = [];

  try {
    await seeded.load();
    await seeded.insertLlmCall(llmRecord('usage_ipc_ready'));
    await seeded.close();
    registerUsageIpc({
      ipcMain: {
        handle(channel: string, handler: Handler) {
          handlers.set(channel, handler as Handler);
        },
      },
      settingsStore: {
        usageStats: async () => {
          calls.push('settings');
          return { source: 'sessions' };
        },
      },
      telemetryRepo,
      modelCallLedger,
      ensureUsageReady: async () => {
        calls.push('ready:start');
        await ready.promise;
        await telemetryRepo.load();
        calls.push('ready:end');
      },
      refreshPricingLookup: () => {},
      sendToRenderer: () => {},
    } as unknown as UsageIpcDeps);

    const settings = await handlers.get('settings:usageStats')?.({});
    assert.deepEqual(settings, { source: 'sessions' });
    assert.deepEqual(calls, ['settings']);

    const summaryPending = handlers.get('usage:summary')?.({}, { range: 'all' });
    await Promise.resolve();
    assert.deepEqual(calls, ['settings', 'ready:start']);
    ready.resolve();
    const summary = await summaryPending;
    assert.equal(summary.ok, true);
    assert.equal(summary.data.totalRequests, 1);
    assert.deepEqual(calls, ['settings', 'ready:start', 'ready:end']);
  } finally {
    await Promise.allSettled([seeded.close(), modelCallLedger.close(), telemetryRepo.close()]);
    await rm(root, { recursive: true, force: true });
  }
});

function llmRecord(id: string) {
  const now = Date.now();
  return {
    id,
    providerId: 'openai',
    modelId: 'gpt-5',
    inputTokens: 10,
    outputTokens: 20,
    cacheHitInputTokens: 0,
    cacheMissInputTokens: 10,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 30,
    costUsd: 0.001,
    latencyMs: 5,
    status: 'success' as const,
    startedAt: now - 5,
    date: new Date(now).toISOString().slice(0, 10),
    ts: now,
  };
}
