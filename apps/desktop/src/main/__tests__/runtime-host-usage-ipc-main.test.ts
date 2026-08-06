import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { registerRuntimeHostUsageIpc } from "../runtime-host-usage-ipc-main.js";

type Handler = (event: unknown, ...args: any[]) => unknown;

describe("Runtime Host Usage IPC", () => {
  test("preserves the Desktop Usage projection and exhausts bucket pages", async () => {
    const handlers = new Map<string, Handler>();
    const queries: Array<Record<string, unknown>> = [];
    const client = {
      async queryUsage(input: Record<string, unknown>) {
        queries.push(input);
        if (input.kind === "summary") {
          return {
            kind: "summary",
            summary: { totalRequests: 3 },
            provenance: { pendingRepairs: 0 },
          };
        }
        if (input.kind === "logs") {
          return {
            kind: "logs",
            source: "llm",
            rows: [{ id: "call-1" }],
            offset: 2,
            total: 4,
            nextOffset: null,
            provenance: { pendingRepairs: 1 },
          };
        }
        const offset = input.offset as number;
        return {
          kind: "buckets",
          buckets: [{ key: `tool-${offset}` }],
          offset,
          total: 2,
          nextOffset: offset === 0 ? 1 : null,
          provenance: { pendingRepairs: 0 },
        };
      },
      async loadPricingSnapshot() {
        return { entries: [] };
      },
    };
    register(handlers, client);

    assert.deepEqual(
      await handlers.get("usage:summary")?.({}, {
        range: "7d",
        toolName: "ignored-for-llm",
      }),
      {
        ok: true,
        data: { totalRequests: 3, provenance: { pendingRepairs: 0 } },
      },
    );
    assert.deepEqual(
      await handlers.get("usage:buckets")?.({}, {
        range: "7d",
        groupBy: "tool",
        toolName: "browser",
      }),
      { ok: true, data: [{ key: "tool-0" }, { key: "tool-1" }] },
    );
    assert.deepEqual(
      await handlers.get("usage:logs")?.({}, {
        range: "7d",
        offset: 2,
        limit: 1,
      }),
      {
        ok: true,
        data: {
          rows: [{ id: "call-1" }],
          total: 4,
          provenance: { pendingRepairs: 1 },
        },
      },
    );
    assert.deepEqual(queries[0], {
      kind: "summary",
      query: { range: "7d" },
    });
    assert.deepEqual(queries[1], {
      kind: "buckets",
      query: { range: "7d", toolName: "browser" },
      groupBy: "tool",
      offset: 0,
      limit: 100,
    });
  });
});

function register(
  handlers: Map<string, Handler>,
  client: object,
  events: string[] = [],
): void {
  registerRuntimeHostUsageIpc({
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler as Handler);
      },
    },
    client: client as never,
    sendToRenderer: (channel) => events.push(channel),
  });
}
