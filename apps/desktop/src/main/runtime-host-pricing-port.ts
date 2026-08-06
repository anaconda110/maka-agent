import type { EffectivePricingEntry, PricingMutation } from '@maka/runtime-host/protocol';
import type { DesktopRuntimeHostClient } from './runtime-host-client.js';
import type { PricingPort } from './pricing-port.js';

export function createRuntimeHostPricingPort(client: DesktopRuntimeHostClient): PricingPort {
  return {
    async query() {
      const snapshot = await client.loadPricingSnapshot();
      return { revision: snapshot.revision, entries: [...snapshot.entries] };
    },
    async mutate(input) {
      const base = await client.loadPricingSnapshot();
      if (input.expectedRevision !== base.revision) {
        return { kind: 'revision_conflict' as const, actualRevision: base.revision };
      }
      const outcome = await client.applyPricingMutation({ base, mutation: input.mutation });
      switch (outcome.kind) {
        case 'saved':
          return { kind: outcome.disposition as 'committed' | 'unchanged', revision: outcome.snapshot.revision };
        case 'saved_refresh_failed':
          return { kind: outcome.disposition as 'committed' | 'unchanged', revision: base.revision + 1 };
        case 'synchronized':
          return { kind: 'committed' as const, revision: outcome.snapshot.revision };
        case 'review_required':
        case 'reconciliation_unavailable':
          throw new Error('Pricing changed concurrently; reload it before retrying');
      }
    },
  };
}
