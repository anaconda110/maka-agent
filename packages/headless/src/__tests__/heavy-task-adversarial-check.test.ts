import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createHeavyTaskAdversarialCheckRecorder } from '../heavy-task-adversarial-check.js';
import { createInMemoryTaskRunStore } from '../task-run-store.js';

describe('heavy-task adversarial check recorder', () => {
  test('accepts public generated-suite expected/actual execution output', async () => {
    let id = 0;
    const store = createInMemoryTaskRunStore([
      { type: 'task_run_created', id: 'e-1', taskRunId: 'run-adversarial', ts: 1, taskId: 'task-1', configId: 'cfg-1' },
    ]);
    const recorder = createHeavyTaskAdversarialCheckRecorder({
      taskRunId: 'run-adversarial',
      attemptId: 'attempt-1',
      store,
      now: () => 10,
      newId: () => `id-${++id}`,
    });
    const ctx = {
      sessionId: 'session-1',
      runId: 'run-1',
      turnId: 'turn-1',
      cwd: '/app',
      toolCallId: 'tool-1',
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
    };

    const plan = await recorder.recordPlan({
      checks: [{
        id: 'generated-expected-fixture',
        description: 'Run public generated expected fixture diff.',
        command: 'bash /tmp/maka-adversarial/example/run_tests.sh',
        expectedOutcome: 'diff exits 0 for generated public fixture',
        source: 'subagent_plan',
      }],
      suite: {
        root: '/tmp/maka-adversarial/example',
        planPath: '/tmp/maka-adversarial/example/plan.json',
        runnerPath: '/tmp/maka-adversarial/example/run_tests.sh',
        rerunCommand: 'bash /tmp/maka-adversarial/example/run_tests.sh',
        generatedPaths: [
          '/tmp/maka-adversarial/example/fixtures/input.html',
          '/tmp/maka-adversarial/example/results/expected.html',
          '/tmp/maka-adversarial/example/run_tests.sh',
        ],
        publicReason: 'Generated public adversarial suite under /tmp/maka-adversarial.',
      },
      publicReason: 'Generated public adversarial suite from visible task requirements.',
    }, ctx);

    const execution = await recorder.recordExecution({
      planId: plan.plan.planId,
      status: 'fail',
      suite: {
        root: '/tmp/maka-adversarial/example',
        runnerPath: '/tmp/maka-adversarial/example/run_tests.sh',
        rerunCommand: 'bash /tmp/maka-adversarial/example/run_tests.sh',
      },
      publicReason: 'Generated public suite found expected output differed from actual output.',
      commandEvidence: [{
        command: 'bash /tmp/maka-adversarial/example/run_tests.sh',
        exitCode: 1,
        outputExcerpt: 'FAIL: expected output differed from actual output for generated public fixture',
        artifactRefs: ['/tmp/maka-adversarial/example/run_tests.sh'],
      }],
      repairRecommendations: ['Update the public implementation to match the generated public expected fixture.'],
    }, ctx);

    assert.equal(execution.execution.status, 'fail');
    assert.equal((await store.project('run-adversarial')).latestHeavyTaskAdversarialCheckExecution?.executionId, execution.execution.executionId);
  });

  test('still rejects hidden material in adversarial execution output', async () => {
    let id = 0;
    const store = createInMemoryTaskRunStore([
      { type: 'task_run_created', id: 'e-1', taskRunId: 'run-hidden', ts: 1, taskId: 'task-1', configId: 'cfg-1' },
    ]);
    const recorder = createHeavyTaskAdversarialCheckRecorder({
      taskRunId: 'run-hidden',
      attemptId: 'attempt-1',
      store,
      now: () => 10,
      newId: () => `id-${++id}`,
    });
    const ctx = {
      sessionId: 'session-1',
      runId: 'run-1',
      turnId: 'turn-1',
      cwd: '/app',
      toolCallId: 'tool-1',
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
    };
    const plan = await recorder.recordPlan({
      checks: [{
        id: 'public-check',
        description: 'Run public suite.',
        command: 'bash /tmp/maka-adversarial/example/run_tests.sh',
        expectedOutcome: 'pass',
        source: 'subagent_plan',
      }],
      suite: {
        root: '/tmp/maka-adversarial/example',
        planPath: '/tmp/maka-adversarial/example/plan.json',
        runnerPath: '/tmp/maka-adversarial/example/run_tests.sh',
        rerunCommand: 'bash /tmp/maka-adversarial/example/run_tests.sh',
        generatedPaths: ['/tmp/maka-adversarial/example/run_tests.sh'],
        publicReason: 'Generated public adversarial suite under /tmp/maka-adversarial.',
      },
      publicReason: 'Generated public adversarial suite from visible task requirements.',
    }, ctx);

    await assert.rejects(
      recorder.recordExecution({
        planId: plan.plan.planId,
        status: 'fail',
        suite: {
          root: '/tmp/maka-adversarial/example',
          runnerPath: '/tmp/maka-adversarial/example/run_tests.sh',
          rerunCommand: 'bash /tmp/maka-adversarial/example/run_tests.sh',
        },
        publicReason: 'Hidden tests revealed the failure.',
        commandEvidence: [{
          command: 'bash /tmp/maka-adversarial/example/run_tests.sh',
          exitCode: 1,
          outputExcerpt: 'hidden/tests/private_case.py failed',
        }],
        repairRecommendations: [],
      }, ctx),
      /private, hidden, or evaluator-only material/,
    );
  });
});
