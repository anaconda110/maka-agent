import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSqlitePricingStore } from "@maka/storage";
import { createEmbeddedPricingPort } from "../embedded-pricing-port.js";

test("embedded pricing port exposes builtin entries and persists overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "maka-embedded-pricing-"));
  const store = createSqlitePricingStore(root);
  await store.load();
  const port = createEmbeddedPricingPort(store);
  try {
    // Initial query: revision 0, only builtin entries (BUILTIN_PRICING is non-empty).
    const first = await port.query();
    assert.equal(first.revision, 0);
    assert.ok(first.entries.length > 0, "builtin entries present");
    assert.ok(first.entries.every((e) => e.source === "builtin"), "all builtin initially");

    // Upsert a custom override for an existing builtin model.
    const builtinKey = first.entries[0]!.pricing.modelKey;
    const upsertResult = await port.mutate({
      expectedRevision: 0,
      mutation: { kind: "upsert", pricing: { modelKey: builtinKey, inputUsdPer1M: 99, outputUsdPer1M: 99 } },
    });
    assert.equal(upsertResult.kind, "committed");
    assert.equal(upsertResult.revision, 1);

    // Query again: the builtin is now hidden, the custom override is shown with resetEffect.
    const second = await port.query();
    assert.equal(second.revision, 1);
    const customEntry = second.entries.find((e) => e.pricing.modelKey === builtinKey);
    assert.ok(customEntry, "override present after upsert");
    assert.equal(customEntry!.source, "custom");
    assert.equal(customEntry!.resetEffect, "restore_builtin", "has a matching builtin");

    // Stale revision → conflict.
    const stale = await port.mutate({
      expectedRevision: 0,
      mutation: { kind: "delete", modelKey: builtinKey },
    });
    assert.equal(stale.kind, "revision_conflict");

    // Delete with correct revision → committed, builtin reappears.
    const deleted = await port.mutate({
      expectedRevision: 1,
      mutation: { kind: "delete", modelKey: builtinKey },
    });
    assert.equal(deleted.kind, "committed");
    const third = await port.query();
    const restored = third.entries.find((e) => e.pricing.modelKey === builtinKey);
    assert.ok(restored, "builtin restored after delete");
    assert.equal(restored!.source, "builtin");
  } finally {
    await store.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});