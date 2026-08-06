import type { EffectivePricingEntry, PricingMutation } from '@maka/runtime-host/protocol';

export interface PricingPort {
  query(): Promise<{ revision: number; entries: EffectivePricingEntry[] }>;
  mutate(input: {
    expectedRevision: number;
    mutation: PricingMutation;
  }): Promise<
    | { kind: 'committed' | 'unchanged'; revision: number }
    | { kind: 'revision_conflict'; actualRevision: number }
  >;
}
