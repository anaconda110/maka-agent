import type { ipcMain as electronIpcMain } from "electron";
import { tryResult } from "@maka/core/result";
import type {
  UsageGroupBy,
  UsageQuery,
} from "@maka/core/usage-stats/types";
import type { UsageQueryResult } from "@maka/runtime-host/protocol";
import type { DesktopRuntimeHostClient } from "./runtime-host-client.js";

interface RuntimeHostUsageIpcDeps {
  readonly ipcMain: Pick<typeof electronIpcMain, "handle">;
  readonly client: DesktopRuntimeHostClient;
  readonly sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

const PAGE_LIMIT = 100;

export function registerRuntimeHostUsageIpc(
  deps: RuntimeHostUsageIpcDeps,
): void {
  deps.ipcMain.handle("usage:summary", (_event, query: UsageQuery) =>
    tryResult(async () => {
      const result = await deps.client.queryUsage({
        kind: "summary",
        query: toLlmQuery(query),
      });
      if (result.kind !== "summary") throw invalidUsageProjection();
      return { ...result.summary, provenance: result.provenance };
    }, "USAGE_SUMMARY_FAILED"),
  );
  deps.ipcMain.handle(
    "usage:buckets",
    (_event, query: UsageQuery & { groupBy: UsageGroupBy }) =>
      tryResult(
        () => loadAllBuckets(deps.client, query),
        "USAGE_BUCKETS_FAILED",
      ),
  );
  deps.ipcMain.handle(
    "usage:logs",
    (
      _event,
      query: UsageQuery & { offset?: number; limit?: number },
    ) =>
      tryResult(async () => {
        const result = await deps.client.queryUsage({
          kind: "logs",
          source: "llm",
          query: toLlmQuery(query),
          offset: query.offset,
          limit: query.limit,
        });
        if (result.kind !== "logs" || result.source !== "llm")
          throw invalidUsageProjection();
        return {
          rows: result.rows,
          total: result.total,
          provenance: result.provenance,
        };
      }, "USAGE_LOGS_FAILED"),
  );
}

async function loadAllBuckets(
  client: DesktopRuntimeHostClient,
  query: UsageQuery & { groupBy: UsageGroupBy },
) {
  const buckets = [];
  let offset = 0;
  while (true) {
    const result = await client.queryUsage(
      query.groupBy === "tool"
        ? {
            kind: "buckets",
            query: toToolQuery(query),
            groupBy: "tool",
            offset,
            limit: PAGE_LIMIT,
          }
        : {
            kind: "buckets",
            query: toLlmQuery(query),
            groupBy: query.groupBy,
            offset,
            limit: PAGE_LIMIT,
          },
    );
    if (result.kind !== "buckets" || result.offset !== offset)
      throw invalidUsageProjection();
    buckets.push(...result.buckets);
    if (result.nextOffset === null) return buckets;
    if (result.nextOffset <= offset) throw invalidUsageProjection();
    offset = result.nextOffset;
  }
}

function toLlmQuery(query: UsageQuery) {
  const { toolName: _toolName, ...llmQuery } = query;
  return llmQuery;
}

function toToolQuery(query: UsageQuery) {
  return {
    range: query.range,
    ...(query.toolName === undefined ? {} : { toolName: query.toolName }),
    ...(query.status === undefined ? {} : { status: query.status }),
  };
}

function invalidUsageProjection(): Error {
  return new Error("Runtime Host returned an invalid Usage projection");
}
