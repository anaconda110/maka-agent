// Re-export the pricing-config type so the generated pricing module
// (`model-pricing.generated.ts`) can import `PricingConfig` from a stable
// sibling path without reaching into usage-stats internals.
export type { PricingConfig } from './usage-stats/types.js';
