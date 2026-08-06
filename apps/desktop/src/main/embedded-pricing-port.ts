import { BUILTIN_PRICING } from '@maka/runtime';
import type { PricingConfig } from '@maka/core/usage-stats/types';
import type { EffectivePricingEntry, PricingMutation } from '@maka/runtime-host/protocol';
import { PricingRevisionConflictError, type PricingStore } from '@maka/storage';
import type { PricingPort } from './pricing-port.js';

function buildEntries(overrides: readonly PricingConfig[]): EffectivePricingEntry[] {
  const overrideKeys = new Set(overrides.map((o) => o.modelKey));
  const builtinKeys = new Set(BUILTIN_PRICING.map((b) => b.modelKey));
  const builtins: EffectivePricingEntry[] = BUILTIN_PRICING
    .filter((b) => !overrideKeys.has(b.modelKey))
    .map((b) => ({ pricing: b, source: 'builtin' as const }));
  const customs: EffectivePricingEntry[] = overrides.map((o) => ({
    pricing: o,
    source: 'custom' as const,
    resetEffect: builtinKeys.has(o.modelKey) ? 'restore_builtin' : 'become_unpriced',
  }));
  return [...builtins, ...customs];
}

export function createEmbeddedPricingPort(store: PricingStore): PricingPort {
  return {
    async query() {
      await store.load();
      const snap = store.snapshot();
      return { revision: snap.revision, entries: buildEntries(snap.overrides) };
    },
    async mutate(input) {
      await store.load();
      try {
        if (input.mutation.kind === 'upsert') {
          const result = await store.upsert(input.expectedRevision, input.mutation.pricing);
          return { kind: result.changed ? 'committed' as const : 'unchanged' as const, revision: result.snapshot.revision };
        }
        const result = await store.delete(input.expectedRevision, input.mutation.modelKey);
        return { kind: result.changed ? 'committed' as const : 'unchanged' as const, revision: result.snapshot.revision };
      } catch (error) {
        if (error instanceof PricingRevisionConflictError) {
          return { kind: 'revision_conflict' as const, actualRevision: error.actualRevision };
        }
        throw error;
      }
    },
  };
}
