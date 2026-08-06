import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { registerPricingIpc } from "../pricing-ipc-main.js";
import type { PricingPort } from "../pricing-port.js";
import type { EffectivePricingEntry, PricingMutation } from "@maka/runtime-host/protocol";

type Handler = (...args: any[]) => unknown;

describe("Pricing IPC", () => {
  test("query returns the port snapshot", async () => {
    const handlers = new Map<string, Handler>();
    const port: PricingPort = {
      async query() {
        return { revision: 3, entries: [{ pricing: { modelKey: "a", inputUsdPer1M: 1, outputUsdPer1M: 2 }, source: "builtin" }] as EffectivePricingEntry[] };
      },
      async mutate() { throw new Error("not used"); },
    };
    registerPricingIpc({ ipcMain: fakeIpc(handlers), port, sendToRenderer: () => undefined });
    const result = await handlers.get("pricing:query")?.({}) as { ok: boolean; data: { revision: number } };
    assert.equal(result.ok, true);
    assert.equal(result.data.revision, 3);
  });

  test("mutate commits and broadcasts pricing:changed", async () => {
    const handlers = new Map<string, Handler>();
    const events: string[] = [];
    const port: PricingPort = {
      async query() { throw new Error("not used"); },
      async mutate(input: { expectedRevision: number; mutation: PricingMutation }) {
        assert.equal(input.expectedRevision, 5);
        return { kind: "committed" as const, revision: 6 };
      },
    };
    registerPricingIpc({ ipcMain: fakeIpc(handlers), port, sendToRenderer: (ch) => events.push(ch) });
    const result = await handlers.get("pricing:mutate")?.({}, { expectedRevision: 5, mutation: { kind: "upsert", pricing: { modelKey: "a", inputUsdPer1M: 1, outputUsdPer1M: 2 } } }) as { ok: boolean; data: { kind: string; revision: number } };
    assert.equal(result.ok, true);
    assert.equal(result.data.kind, "committed");
    assert.equal(result.data.revision, 6);
    assert.deepEqual(events, ["pricing:changed"]);
  });

  test("revision_conflict does not broadcast", async () => {
    const handlers = new Map<string, Handler>();
    const events: string[] = [];
    const port: PricingPort = {
      async query() { throw new Error("not used"); },
      async mutate() { return { kind: "revision_conflict" as const, actualRevision: 9 }; },
    };
    registerPricingIpc({ ipcMain: fakeIpc(handlers), port, sendToRenderer: (ch) => events.push(ch) });
    const result = await handlers.get("pricing:mutate")?.({}, { expectedRevision: 5, mutation: { kind: "delete", modelKey: "a" } }) as { ok: boolean; data: { kind: string } };
    assert.equal(result.ok, true);
    assert.equal(result.data.kind, "revision_conflict");
    assert.deepEqual(events, []);
  });
});

function fakeIpc(handlers: Map<string, Handler>): { handle(channel: string, handler: Handler): void } {
  return { handle: (channel, handler) => handlers.set(channel, handler) };
}