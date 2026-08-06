import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  resolveSelectedModelContextWindow,
  resolveSelectedModelMaxInputTokens,
} from '../context-budget-policy.js';
import type { RuntimeExecutionConnection } from '@maka/core/llm-connections';

// Issue #2329: a model like gpt-5.2 has context 400K but a real input limit of
// 272K. Budgeting against contextWindow over-admits input the model cannot
// take; resolveSelectedModelMaxInputTokens must prefer maxInputTokens.

function fakeConnection(providerType: string, modelId: string): RuntimeExecutionConnection {
  return {
    slug: 'test',
    providerType,
    enabled: true,
    defaultModel: modelId,
    models: [],
  } as unknown as RuntimeExecutionConnection;
}

describe('resolveSelectedModelMaxInputTokens', () => {
  test('returns maxInputTokens when the model metadata has it', () => {
    // gpt-5.2 is a real models.dev model with context 400K, input 272K.
    const connection = fakeConnection('openai', 'gpt-5.2');
    const input = resolveSelectedModelMaxInputTokens(connection, 'gpt-5.2');
    const context = resolveSelectedModelContextWindow(connection, 'gpt-5.2');
    assert.ok(input !== undefined, 'gpt-5.2 should resolve an input limit');
    assert.ok(context !== undefined, 'gpt-5.2 should resolve a context window');
    assert.notEqual(input, context, 'input limit must differ from context window for gpt-5.2');
    assert.equal(input, 272_000, 'gpt-5.2 input limit should be 272K');
  });

  test('falls back to contextWindow when maxInputTokens is absent', () => {
    // claude-sonnet-4-5 has no limit.input in models.dev; the input ceiling
    // equals the context window.
    const connection = fakeConnection('anthropic', 'claude-sonnet-4-5');
    const input = resolveSelectedModelMaxInputTokens(connection, 'claude-sonnet-4-5');
    const context = resolveSelectedModelContextWindow(connection, 'claude-sonnet-4-5');
    assert.equal(input, context, 'without maxInputTokens, input limit should equal context window');
  });

  test('returns undefined for an unknown model with no metadata', () => {
    const connection = fakeConnection('anthropic', 'claude-opus-99');
    const input = resolveSelectedModelMaxInputTokens(connection, 'claude-opus-99');
    assert.equal(input, undefined, 'an unknown model resolves no input limit');
  });
});
