import type { PricingConfig } from '@maka/core/usage-stats/types';
import { GENERATED_PRICING } from '@maka/core/model-pricing.generated';

// Pricing is now sourced from the models.dev sync (see
// scripts/sync-model-metadata.mjs → model-pricing.generated.ts). The hand-
// maintained 17-entry snapshot has been retired; what remains here is the
// local supplement layer — special tiers models.dev does not price (Coding
// Plan, etc.). These take precedence over any generated entry with the same
// modelKey (see the byKey merge below).
const LOCAL_PRICING_SUPPLEMENT: readonly PricingConfig[] = [
  { modelKey: 'zai-coding-plan:glm-4.7', inputUsdPer1M: 0.6, outputUsdPer1M: 2.2 },
  { modelKey: 'zai-coding-plan:glm-4.6', inputUsdPer1M: 0.6, outputUsdPer1M: 2.2 },
  { modelKey: 'zai-coding-plan:glm-4.5-air', inputUsdPer1M: 0.2, outputUsdPer1M: 0.8 },
];

// Local supplements override generated entries with the same modelKey (special
// tiers win over the base rate models.dev reports under the canonical provider).
const byKey = new Map<string, PricingConfig>();
for (const pricing of GENERATED_PRICING) byKey.set(pricing.modelKey, pricing);
for (const pricing of LOCAL_PRICING_SUPPLEMENT) byKey.set(pricing.modelKey, pricing);

export const BUILTIN_PRICING: readonly PricingConfig[] = Array.from(byKey.values());

export function getBuiltinPricing(modelKey: string): PricingConfig | null {
  return byKey.get(modelKey) ?? null;
}
