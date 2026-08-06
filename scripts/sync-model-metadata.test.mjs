import assert from 'node:assert/strict';
import test from 'node:test';

import { toMetadata, toLifecycle, toPricingConfig, PROVIDERS } from './sync-model-metadata.mjs';

const PROVIDER = { doc: 'https://example.com/docs' };
const BASE_MODEL = {
  name: 'Test Model',
  limit: { context: 128_000, output: 8_192 },
  reasoning: true,
  tool_call: true,
};

test('models.dev reasoning_options effort values pass through to thinkingOptions', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, {
    ...BASE_MODEL,
    reasoning_options: [{ type: 'effort', values: ['high', 'max'] }],
  });
  assert.deepEqual(metadata.thinkingOptions, { efforts: ['high', 'max'] });
});

test('models.dev reasoning_options toggle passes through to thinkingOptions', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, {
    ...BASE_MODEL,
    reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high'] }],
  });
  assert.deepEqual(metadata.thinkingOptions, { efforts: ['low', 'high'], toggle: true });
});

test('models without reasoning_options declare no thinkingOptions', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, BASE_MODEL);
  assert.equal('thinkingOptions' in metadata, false);
});

test('a toggle-only model declares thinkingOptions without efforts', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, {
    ...BASE_MODEL,
    reasoning_options: [{ type: 'toggle' }],
  });
  assert.deepEqual(metadata.thinkingOptions, { toggle: true });
});

test('budget_tokens is recognized and skipped until a wire consumes it', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, {
    ...BASE_MODEL,
    reasoning_options: [{ type: 'budget_tokens' }, { type: 'effort', values: ['high'] }],
  });
  assert.deepEqual(metadata.thinkingOptions, { efforts: ['high'] });
});

test('an unknown reasoning_options type fails loudly instead of drifting', () => {
  assert.throws(
    () =>
      toMetadata('test', 'm', PROVIDER, {
        ...BASE_MODEL,
        reasoning_options: [{ type: 'mystery' }],
      }),
    /unsupported shape/,
  );
});

test('an empty reasoning_options list declares no thinkingOptions', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, { ...BASE_MODEL, reasoning_options: [] });
  assert.equal('thinkingOptions' in metadata, false);
});

test('malformed reasoning_options are rejected as an unsupported shape', () => {
  assert.throws(
    () => toMetadata('test', 'm', PROVIDER, { ...BASE_MODEL, reasoning_options: 'effort' }),
    /unsupported shape/,
  );
  assert.throws(
    () =>
      toMetadata('test', 'm', PROVIDER, {
        ...BASE_MODEL,
        reasoning_options: [{ type: 'effort', values: 'high' }],
      }),
    /unsupported shape/,
  );
});

test('main() syncs only the mapped providers into the generated snapshot', async () => {
  // End-to-end over the real main() path (the place the kimi/stepfun orphan
  // bug lived): a fixture catalog covering every mapped source id plus one
  // unmapped neighbour; only the mapped ones may produce segments.
  const catalog = {};
  for (const sourceId of Object.values(PROVIDERS)) {
    catalog[sourceId] = {
      id: sourceId,
      name: sourceId,
      doc: `https://${sourceId}.example/docs`,
      api: `https://${sourceId}.example/v1`,
      models: {},
    };
  }
  catalog['kimi-for-coding'].api = 'https://api.kimi.com/coding/v1';
  catalog['kimi-for-coding'].models.k3 = {
    name: 'Kimi K3',
    limit: { context: 1_048_576, output: 131_072 },
    reasoning: true,
    tool_call: true,
    reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high', 'max'] }],
  };
  catalog['unmapped-provider'] = {
    id: 'unmapped-provider',
    name: 'Unmapped',
    doc: 'https://example.com/docs',
    api: 'https://unmapped.example/v1',
    models: {
      'm-1': {
        name: 'M1',
        limit: { context: 8_192, output: 4_096 },
        reasoning: false,
        tool_call: true,
      },
    },
  };
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'maka-sync-'));
  const input = join(dir, 'catalog.json');
  const output = join(dir, 'out.ts');
  const pricingOutput = join(dir, 'pricing.ts');
  await writeFile(input, JSON.stringify(catalog));
  const { main } = await import('./sync-model-metadata.mjs');
  await main(['--input', input, '--output', output, '--pricing-output', pricingOutput]);
  const out = await readFile(output, 'utf8');
  await rm(dir, { recursive: true, force: true });

  assert.match(out, /"kimi-coding-plan": \{/);
  assert.match(out, /"k3": \{/);
  assert.match(out, /"thinkingOptions":\{"efforts":\["low","high","max"\],"toggle":true\}/);
  assert.match(out, /"kimi-for-coding": \{/);
  assert.match(out, /"kimi-for-coding": \{"api":"https:\/\/api\.kimi\.com\/coding\/v1"\}/);
  // The unmapped provider must appear only in the directory (the complete
  // upstream catalog), never as a snapshot segment or provider fact.
  const directoryStart = out.indexOf('GENERATED_MODELS_DEV_DIRECTORY');
  assert.ok(directoryStart > 0);
  assert.doesNotMatch(out.slice(0, directoryStart), /unmapped-provider/);
  assert.match(out.slice(directoryStart), /"unmapped-provider": \{/);
});

// ── #2329: full models.dev fact set sync ────────────────────────────────────

test('toMetadata maps description from models.dev', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, {
    ...BASE_MODEL,
    description: 'A balanced model',
  });
  assert.equal(metadata.description, 'A balanced model');
});

test('toMetadata omits description when models.dev lacks it', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, BASE_MODEL);
  assert.equal('description' in metadata, false);
});

test('toMetadata maps knowledge cutoff from models.dev knowledge', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, { ...BASE_MODEL, knowledge: '2025-07-31' });
  assert.equal(metadata.knowledgeCutoff, '2025-07-31');
});

test('toMetadata maps maxInputTokens from models.dev limit.input', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, {
    ...BASE_MODEL,
    limit: { context: 400_000, output: 8_192, input: 272_000 },
  });
  assert.equal(metadata.maxInputTokens, 272_000);
});

test('toMetadata omits maxInputTokens when limit.input is absent', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, BASE_MODEL);
  assert.equal('maxInputTokens' in metadata, false);
});

test('toMetadata maps structured_output when true', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, { ...BASE_MODEL, structured_output: true });
  assert.equal(metadata.structuredOutput, true);
});

test('toMetadata omits structuredOutput when false or absent', () => {
  assert.equal(
    'structuredOutput' in
      toMetadata('test', 'm', PROVIDER, { ...BASE_MODEL, structured_output: false }),
    false,
  );
  assert.equal('structuredOutput' in toMetadata('test', 'm', PROVIDER, BASE_MODEL), false);
});

test('toMetadata sets pdfInput when models.dev input_modalities include pdf', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, {
    ...BASE_MODEL,
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
  });
  assert.equal(metadata.pdfInput, true);
  // pdf also survives the input modalities filter (#2329), not dropped as before
  assert.deepEqual(metadata.modalities.input, ['text', 'image', 'pdf']);
});

test('toMetadata omits pdfInput when no pdf modality', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, {
    ...BASE_MODEL,
    modalities: { input: ['text', 'image'], output: ['text'] },
  });
  assert.equal('pdfInput' in metadata, false);
});

test('toMetadata maps last_updated as lastUpdated', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, { ...BASE_MODEL, last_updated: '2025-09-29' });
  assert.equal(metadata.lastUpdated, '2025-09-29');
});

test('toMetadata omits lastUpdated when models.dev lacks last_updated', () => {
  const metadata = toMetadata('test', 'm', PROVIDER, BASE_MODEL);
  assert.equal('lastUpdated' in metadata, false);
});

test('toLifecycle preserves beta distinctly instead of folding into active', () => {
  assert.equal(toLifecycle('beta'), 'beta');
});

test('toLifecycle preserves alpha distinctly instead of folding into active', () => {
  assert.equal(toLifecycle('alpha'), 'alpha');
});

test('toLifecycle maps deprecated verbatim', () => {
  assert.equal(toLifecycle('deprecated'), 'deprecated');
});

test('toLifecycle falls back to active for unknown status', () => {
  assert.equal(toLifecycle('preview'), 'active');
  assert.equal(toLifecycle(undefined), 'active');
});

test('toPricingConfig converts a flat models.dev cost to PricingConfig', () => {
  const pricing = toPricingConfig('anthropic', 'claude-sonnet-4-5', {
    cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  });
  assert.deepEqual(pricing, {
    modelKey: 'anthropic:claude-sonnet-4-5',
    inputUsdPer1M: 3,
    outputUsdPer1M: 15,
    cacheReadUsdPer1M: 0.3,
    cacheWriteUsdPer1M: 3.75,
  });
});

test('toPricingConfig omits cache rates when models.dev lacks them', () => {
  const pricing = toPricingConfig('google', 'gemini-2.5-pro', {
    cost: { input: 1.25, output: 10 },
  });
  assert.deepEqual(pricing, {
    modelKey: 'google:gemini-2.5-pro',
    inputUsdPer1M: 1.25,
    outputUsdPer1M: 10,
  });
});

test('toPricingConfig returns null when cost is absent', () => {
  assert.equal(toPricingConfig('test', 'm', BASE_MODEL), null);
});

test('toPricingConfig returns null when input or output is missing', () => {
  assert.equal(toPricingConfig('test', 'm', { cost: { output: 10 } }), null);
  assert.equal(toPricingConfig('test', 'm', { cost: { input: 3 } }), null);
});

test('toPricingConfig skips zero-rate models (special tiers stay overrides)', () => {
  // Coding plans / free tiers report cost 0; they belong in the local supplement
  // / override layer, not generated (#2329 non-goals).
  assert.equal(toPricingConfig('kimi-coding-plan', 'k3', { cost: { input: 0, output: 0 } }), null);
  assert.equal(toPricingConfig('test', 'm', { cost: { input: 0, output: 10 } }), null);
});
