import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BUILTIN_PRICING, getBuiltinPricing } from '../telemetry/builtin-pricing.js';
import type { PricingConfig } from '@maka/core/usage-stats/types';

describe('builtin-pricing contract', () => {
  test('exposes a non-empty built-in price table', () => {
    assert.ok(BUILTIN_PRICING.length > 0, 'BUILTIN_PRICING must contain generated + local entries');
  });

  test('every entry is a canonical PricingConfig (required rates, non-negative)', () => {
    for (const pricing of BUILTIN_PRICING) {
      assert.equal(
        typeof pricing.modelKey,
        'string',
        `entry ${pricing.modelKey} needs a string modelKey`,
      );
      assert.ok(pricing.modelKey.length > 0, 'modelKey must be non-empty');
      assert.equal(
        typeof pricing.inputUsdPer1M,
        'number',
        `entry ${pricing.modelKey} needs numeric inputUsdPer1M`,
      );
      assert.equal(
        typeof pricing.outputUsdPer1M,
        'number',
        `entry ${pricing.modelKey} needs numeric outputUsdPer1M`,
      );
      assert.ok(
        pricing.inputUsdPer1M >= 0,
        `entry ${pricing.modelKey} inputUsdPer1M must be non-negative`,
      );
      assert.ok(
        pricing.outputUsdPer1M >= 0,
        `entry ${pricing.modelKey} outputUsdPer1M must be non-negative`,
      );
    }
  });

  test('local supplements override generated entries with the same modelKey', () => {
    // zai-coding-plan tiers are the local supplement; they must be present and
    // resolve via getBuiltinPricing (they are not priced by models.dev).
    for (const modelKey of [
      'zai-coding-plan:glm-4.7',
      'zai-coding-plan:glm-4.6',
      'zai-coding-plan:glm-4.5-air',
    ]) {
      const pricing = getBuiltinPricing(modelKey);
      assert.ok(pricing, `${modelKey} must resolve via getBuiltinPricing (local supplement)`);
      assert.equal(pricing?.inputUsdPer1M, modelKey.endsWith('4.5-air') ? 0.2 : 0.6);
    }
  });

  test('getBuiltinPricing returns null for unknown keys', () => {
    assert.equal(getBuiltinPricing('unknown:nonexistent-model'), null);
  });

  test('getBuiltinPricing returns the same object as the table entry', () => {
    const first = BUILTIN_PRICING[0] as PricingConfig;
    assert.deepEqual(getBuiltinPricing(first.modelKey), first);
  });

  test('the former hand-maintained entries still resolve through the new lookup', () => {
    // Issue #2329 validation: "A diff test that the current 17 hand entries
    // still resolve through the new lookup." models.dev has since renamed some
    // ids (e.g. claude-opus-4-1→-20250805, haiku-4→haiku-4-5, kimi-k2→kimi-k2-0711-preview);
    // those resolve to undefined by design — the generated table tracks
    // models.dev, not the retired hand snapshot. The entries still present in
    // models.dev must resolve so billing never silently falls to 0.
    const stillInModelsDev = [
      'anthropic:claude-sonnet-4-5',
      'openai:gpt-4o',
      'openai:gpt-4o-mini',
      'google:gemini-2.5-pro',
      'google:gemini-2.5-flash',
      'deepseek:deepseek-chat',
      'deepseek:deepseek-reasoner',
      'MiniMax:MiniMax-M3',
      'MiniMax-cn:MiniMax-M3',
    ];
    for (const modelKey of stillInModelsDev) {
      const pricing = getBuiltinPricing(modelKey);
      assert.ok(
        pricing,
        `${modelKey} must resolve (present in models.dev, was in the 17-entry hand snapshot)`,
      );
      assert.equal(typeof pricing?.inputUsdPer1M, 'number');
      assert.equal(typeof pricing?.outputUsdPer1M, 'number');
    }
    // Renamed-away ids are intentionally absent — generated table tracks
    // models.dev, not the retired hand snapshot.
    for (const retired of [
      'anthropic:claude-opus-4-1',
      'anthropic:claude-haiku-4',
      'moonshot:kimi-k2',
    ]) {
      assert.equal(
        getBuiltinPricing(retired),
        null,
        `${retired} was renamed in models.dev; the generated table must not carry stale ids`,
      );
    }
  });
});
