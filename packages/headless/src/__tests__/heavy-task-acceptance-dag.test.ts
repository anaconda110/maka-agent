import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createHeavyTaskAcceptanceDagRecorder,
  heavyTaskAcceptanceDagBlocker,
  heavyTaskAcceptanceDagSubmitSchema,
  heavyTaskAcceptanceDagWorkStartBlocker,
} from '../heavy-task-acceptance-dag.js';
import type { HeavyTaskAcceptanceDagState } from '../task-contracts.js';
import { createInMemoryTaskRunStore } from '../task-run-store.js';

describe('heavy-task acceptance DAG', () => {
  test('records accepted public DAG state', async () => {
    const store = createInMemoryTaskRunStore();
    const recorder = createHeavyTaskAcceptanceDagRecorder({
      taskRunId: 'run-1',
      attemptId: 'attempt-1',
      store,
      now: () => 10,
      newId: idFactory(),
    });

    const result = await recorder.recordAcceptanceDag(validDagInput(), {
      sessionId: 's',
      turnId: 't',
      cwd: '/app',
      toolCallId: 'tool-dag',
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
    });

    assert.equal(result.accepted, true);
    const projection = await store.project('run-1');
    assert.equal(projection.latestHeavyTaskAcceptanceDag?.summary, 'public DAG');
    assert.equal(projection.latestHeavyTaskAcceptanceDag?.nodes[0]?.dependsOn.length, 0);
    assert.equal(await recorder.acceptedDagForWorkBlocker(), undefined);
    assert.equal(heavyTaskAcceptanceDagWorkStartBlocker(projection.latestHeavyTaskAcceptanceDag), undefined);
    assert.equal(heavyTaskAcceptanceDagBlocker(projection.latestHeavyTaskAcceptanceDag), undefined);
  });

  test('rejects private/evaluator-only DAG text before projecting state', async () => {
    const store = createInMemoryTaskRunStore();
    const recorder = createHeavyTaskAcceptanceDagRecorder({
      taskRunId: 'run-1',
      store,
      now: () => 10,
      newId: idFactory(),
    });
    const input = validDagInput();
    input.nodes[0].description = 'Use hidden tests to infer private behavior.';

    const result = await recorder.recordAcceptanceDag(input, {
      sessionId: 's',
      turnId: 't',
      cwd: '/app',
      toolCallId: 'tool-dag',
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
    });

    assert.equal(result.accepted, false);
    assert.match(result.accepted ? '' : result.guard.categories.join(','), /hidden_tests/);
    const projection = await store.project('run-1');
    assert.equal(projection.latestHeavyTaskAcceptanceDag, undefined);
  });

  test('validates dependency ids', () => {
    assert.throws(() => heavyTaskAcceptanceDagSubmitSchema.parse({
      ...validDagInput(),
      nodes: [
        { ...validDagInput().nodes[0], dependsOn: ['missing-node'] },
        ...validDagInput().nodes.slice(1),
      ],
    }), /unknown dependency missing-node/);
  });

  test('blocks finalization when a required node is missing self-check evidence', () => {
    const base = validDagInput();
    const firstNode = base.nodes[0];
    const deliverableNode = base.nodes[1];
    assert.ok(firstNode);
    assert.ok(deliverableNode);
    const deliverableWithoutSelfCheck = { ...deliverableNode };
    const { selfCheck: _selfCheck, ...deliverable } = deliverableWithoutSelfCheck;
    const input = {
      ...base,
      nodes: [
        firstNode,
        deliverable,
        ...base.nodes.slice(2),
      ],
    };
    const parsed = heavyTaskAcceptanceDagSubmitSchema.parse(input);
    const dag: HeavyTaskAcceptanceDagState = {
      schemaVersion: 1 as const,
      dagId: 'dag-1',
      taskRunId: 'run-1',
      ts: 1,
      summary: parsed.summary,
      publicReason: parsed.publicReason,
      nodes: parsed.nodes.map((node) => {
        const { selfCheck, ...nodeWithoutSelfCheck } = node;
        const normalized = {
          ...nodeWithoutSelfCheck,
          dependsOn: node.dependsOn ?? [],
          required: node.required ?? true,
        };
        if (!selfCheck) return normalized;
        return {
          ...normalized,
          selfCheck: {
            status: selfCheck.status,
            publicReason: selfCheck.publicReason,
            commandEvidence: selfCheck.commandEvidence ?? [],
            artifactEvidence: selfCheck.artifactEvidence ?? [],
          },
        };
      }),
      guard: {
        status: 'accepted' as const,
        checkedAt: 1,
        categories: [],
        publicReason: 'Accepted as public, task-derived heavy-task acceptance DAG.',
      },
      source: { kind: 'model_tool' as const, toolCallId: 'tool-dag' },
    };

    assert.match(heavyTaskAcceptanceDagBlocker(dag) ?? '', /missing node self-checks: deliverable/);
  });
});

function validDagInput() {
  const check = {
    status: 'pass' as const,
    publicReason: 'public check passed',
    commandEvidence: [{ command: 'test -f /app/result.txt', exitCode: 0, outputExcerpt: 'present', artifactRefs: ['/app/result.txt'] }],
    artifactEvidence: [{ path: '/app/result.txt', kind: 'file' as const, exists: true }],
  };
  return {
    summary: 'public DAG',
    publicReason: 'DAG is derived from visible task instructions.',
    nodes: [
      { id: 'requirements', kind: 'requirement' as const, title: 'Requirements', description: 'Extract public requirements', status: 'completed' as const, dependsOn: [], acceptanceCriteria: ['requirements listed'], required: true, selfCheck: check },
      { id: 'deliverable', kind: 'deliverable' as const, title: 'Deliverable', description: 'Create result file', status: 'completed' as const, dependsOn: ['requirements'], acceptanceCriteria: ['result exists'], required: true, selfCheck: check },
      { id: 'implementation', kind: 'implementation' as const, title: 'Implementation', description: 'Implement visible task', status: 'completed' as const, dependsOn: ['deliverable'], acceptanceCriteria: ['implementation complete'], required: true, selfCheck: check },
      { id: 'public-check', kind: 'public_check' as const, title: 'Public check', description: 'Run visible command', status: 'completed' as const, dependsOn: ['implementation'], acceptanceCriteria: ['command exits zero'], required: true, selfCheck: check },
      { id: 'final-audit', kind: 'final_audit' as const, title: 'Final audit', description: 'Review evidence', status: 'completed' as const, dependsOn: ['public-check'], acceptanceCriteria: ['evidence covers nodes'], required: true, selfCheck: check },
    ],
  };
}

function idFactory(): () => string {
  let next = 0;
  return () => `id-${++next}`;
}
