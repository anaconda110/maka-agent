import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runHeavyTaskAdversarialSelfCheckCheckpoint } from '../heavy-task-adversarial-orchestrator.js';
import type { Task } from '../contracts.js';
import type {
  HeavyTaskAdversarialCheckExecutionState,
  HeavyTaskAdversarialCheckPlanState,
  HeavyTaskSemanticSelfCheckState,
} from '../task-contracts.js';
import type { TaskRunProjection } from '../task-run-store.js';

const task: Task = {
  id: 'adversarial-orchestrator-task',
  instruction: 'Create /app/filter.py and preserve clean HTML exactly.',
  workspaceDir: '/app',
  verification: { command: 'python3 /app/filter.py sample.html', protectedPaths: [] },
};

describe('heavy-task adversarial orchestrator', () => {
  test('accepts adversarial records created by child tools without parsing final JSON', async () => {
    const plan = adversarialPlan();
    const execution = adversarialExecution(plan.planId);
    let projection = {
      latestHeavyTaskSelfCheck: selfCheckPass(),
    } as TaskRunProjection;
    let spawnCalls = 0;

    const result = await runHeavyTaskAdversarialSelfCheckCheckpoint({
      task,
      taskRunId: 'run-adversarial',
      attemptId: 'attempt-1',
      projection,
      recorder: {
        async recordPlan() {
          throw new Error('recordPlan should not be called when child tools already recorded the plan');
        },
        async recordExecution() {
          throw new Error('recordExecution should not be called when child tools already recorded execution');
        },
      },
      cwd: '/app',
      sessionId: 'session-1',
      runId: 'run-1',
      turnId: 'turn-1',
      now: () => 10,
      newId: () => 'id-1',
      spawnAdversarialChild: async () => {
        spawnCalls += 1;
        projection = {
          ...projection,
          latestHeavyTaskAdversarialCheckPlan: plan,
          latestHeavyTaskAdversarialCheckExecution: execution,
        } as TaskRunProjection;
        return { summary: 'child recorded via tools but did not emit parseable result JSON' };
      },
      getProjection: async () => projection,
    });

    assert.equal(spawnCalls, 1);
    assert.deepEqual(result, {
      ran: true,
      action: 'plan_and_execute',
      reason: 'runtime adversarial tester recorded initial suite through tools',
    });
  });

  test('harvests child-generated suite files when child returns no parseable result', async () => {
    const selfCheck = selfCheckPass();
    const recorded: { plan?: HeavyTaskAdversarialCheckPlanState; execution?: HeavyTaskAdversarialCheckExecutionState } = {};
    const commands: string[] = [];

    const result = await runHeavyTaskAdversarialSelfCheckCheckpoint({
      task,
      taskRunId: 'run-adversarial',
      attemptId: 'attempt-1',
      projection: { latestHeavyTaskSelfCheck: selfCheck } as TaskRunProjection,
      recorder: {
        async recordPlan(input) {
          recorded.plan = {
            schemaVersion: 1,
            planId: 'harvested-plan-1',
            taskRunId: 'run-adversarial',
            attemptId: 'attempt-1',
            ts: 2,
            checks: input.checks,
            suite: input.suite,
            publicReason: input.publicReason,
            source: { kind: 'model_tool', toolCallId: 'harvest-plan' },
          };
          return { accepted: true, plan: recorded.plan };
        },
        async recordExecution(input) {
          recorded.execution = {
            schemaVersion: 1,
            executionId: 'harvested-execution-1',
            taskRunId: 'run-adversarial',
            attemptId: 'attempt-1',
            ts: 3,
            planId: input.planId,
            status: input.status,
            suite: input.suite,
            publicReason: input.publicReason,
            commandEvidence: input.commandEvidence,
            repairRecommendations: input.repairRecommendations,
            source: { kind: 'model_tool', toolCallId: 'harvest-execution' },
          };
          return { accepted: true, execution: recorded.execution };
        },
      },
      cwd: '/app',
      sessionId: 'session-1',
      runId: 'run-1',
      turnId: 'turn-1',
      now: () => 10,
      newId: () => 'id-1',
      spawnAdversarialChild: async () => ({ summary: 'no result block' }),
      runWorkspaceCommand: async (command) => {
        commands.push(command);
        if (command.includes('__MAKA_PLAN_JSON__')) {
          return {
            exitCode: 0,
            stderr: '',
            stdout: [
              '__MAKA_SUITE_ROOT__',
              '/tmp/maka-adversarial/run-adversarial',
              '__MAKA_PLAN_PATH__',
              '/tmp/maka-adversarial/run-adversarial/plan.json',
              '__MAKA_RUNNER_PATH__',
              '/tmp/maka-adversarial/run-adversarial/run_tests.sh',
              '__MAKA_GENERATED_PATHS__',
              '/tmp/maka-adversarial/run-adversarial/plan.json',
              '/tmp/maka-adversarial/run-adversarial/run_tests.sh',
              '__MAKA_PLAN_JSON__',
              JSON.stringify({
                checks: [{
                  id: 'clean-html-full-document',
                  description: 'Full clean HTML document remains unchanged.',
                  command: 'cd /tmp/maka-adversarial/run-adversarial && bash run_tests.sh',
                  expectedOutcome: 'diff exits 0',
                  source: 'subagent_plan',
                }],
              }),
            ].join('\n'),
          };
        }
        return { exitCode: 0, stdout: 'all adversarial tests passed', stderr: '' };
      },
    });

    assert.deepEqual(result, {
      ran: true,
      action: 'plan_and_execute',
      reason: 'runtime harvested child-generated adversarial suite and executed runner',
    });
    assert.equal(commands.length, 2);
    assert.equal(recorded.plan?.suite.rerunCommand, 'cd /tmp/maka-adversarial/run-adversarial && bash run_tests.sh');
    assert.equal(recorded.execution?.planId, 'harvested-plan-1');
    assert.equal(recorded.execution?.status, 'pass');
  });

  test('harvests child-generated suite files when child times out', async () => {
    const recorded: { plan?: HeavyTaskAdversarialCheckPlanState; execution?: HeavyTaskAdversarialCheckExecutionState } = {};
    let aborted = false;

    const result = await runHeavyTaskAdversarialSelfCheckCheckpoint({
      task,
      taskRunId: 'run-adversarial',
      attemptId: 'attempt-1',
      projection: { latestHeavyTaskSelfCheck: selfCheckPass() } as TaskRunProjection,
      recorder: {
        async recordPlan(input) {
          recorded.plan = {
            schemaVersion: 1,
            planId: 'timeout-harvested-plan',
            taskRunId: 'run-adversarial',
            attemptId: 'attempt-1',
            ts: 2,
            checks: input.checks,
            suite: input.suite,
            publicReason: input.publicReason,
            source: { kind: 'model_tool', toolCallId: 'harvest-plan' },
          };
          return { accepted: true, plan: recorded.plan };
        },
        async recordExecution(input) {
          recorded.execution = {
            schemaVersion: 1,
            executionId: 'timeout-harvested-execution',
            taskRunId: 'run-adversarial',
            attemptId: 'attempt-1',
            ts: 3,
            planId: input.planId,
            status: input.status,
            suite: input.suite,
            publicReason: input.publicReason,
            commandEvidence: input.commandEvidence,
            repairRecommendations: input.repairRecommendations,
            source: { kind: 'model_tool', toolCallId: 'harvest-execution' },
          };
          return { accepted: true, execution: recorded.execution };
        },
      },
      cwd: '/app',
      sessionId: 'session-1',
      runId: 'run-1',
      turnId: 'turn-1',
      now: () => 10,
      newId: () => 'id-1',
      adversarialChildTimeoutMs: 1,
      spawnAdversarialChild: async (_prompt, abortSignal) => {
        abortSignal.addEventListener('abort', () => {
          aborted = true;
        });
        return new Promise(() => {});
      },
      runWorkspaceCommand: async (command) => {
        if (command.includes('__MAKA_PLAN_JSON__')) {
          return {
            exitCode: 0,
            stderr: '',
            stdout: [
              '__MAKA_SUITE_ROOT__',
              '/tmp/maka-adversarial/run-adversarial',
              '__MAKA_PLAN_PATH__',
              '/tmp/maka-adversarial/run-adversarial/plan.json',
              '__MAKA_RUNNER_PATH__',
              '/tmp/maka-adversarial/run-adversarial/run_tests.sh',
              '__MAKA_GENERATED_PATHS__',
              '/tmp/maka-adversarial/run-adversarial/plan.json',
              '/tmp/maka-adversarial/run-adversarial/run_tests.sh',
              '__MAKA_PLAN_JSON__',
              JSON.stringify({
                checks: [{
                  id: 'timeout-clean-html',
                  description: 'Full clean HTML document remains unchanged.',
                  expectedOutcome: 'diff exits 0',
                  source: 'subagent_plan',
                }],
              }),
            ].join('\n'),
          };
        }
        return { exitCode: 0, stdout: 'timeout-harvest suite passed', stderr: '' };
      },
    });

    assert.equal(aborted, true);
    assert.deepEqual(result, {
      ran: true,
      action: 'plan_and_execute',
      reason: 'runtime harvested child-generated adversarial suite and executed runner',
    });
    assert.equal(recorded.plan?.planId, 'timeout-harvested-plan');
    assert.equal(recorded.execution?.status, 'pass');
  });

  test('executes recorded suite when child records plan but no execution before timeout', async () => {
    const plan = adversarialPlan();
    let projection = {
      latestHeavyTaskSelfCheck: selfCheckPass(),
      latestHeavyTaskAdversarialCheckPlan: plan,
    } as TaskRunProjection;
    let execution: HeavyTaskAdversarialCheckExecutionState | undefined;
    let runnerCommand = '';

    const result = await runHeavyTaskAdversarialSelfCheckCheckpoint({
      task,
      taskRunId: 'run-adversarial',
      attemptId: 'attempt-1',
      projection: { latestHeavyTaskSelfCheck: selfCheckPass() } as TaskRunProjection,
      recorder: {
        async recordPlan() {
          throw new Error('recordPlan should not be called when a plan is already recorded');
        },
        async recordExecution(input) {
          execution = {
            schemaVersion: 1,
            executionId: 'execution-after-timeout',
            taskRunId: 'run-adversarial',
            attemptId: 'attempt-1',
            ts: 3,
            planId: input.planId,
            status: input.status,
            suite: input.suite,
            publicReason: input.publicReason,
            commandEvidence: input.commandEvidence,
            repairRecommendations: input.repairRecommendations,
            source: { kind: 'model_tool', toolCallId: 'timeout-execution' },
          };
          projection = {
            ...projection,
            latestHeavyTaskAdversarialCheckExecution: execution,
          } as TaskRunProjection;
          return { accepted: true, execution };
        },
      },
      cwd: '/app',
      sessionId: 'session-1',
      runId: 'run-1',
      turnId: 'turn-1',
      now: () => 10,
      newId: () => 'id-1',
      adversarialChildTimeoutMs: 1,
      spawnAdversarialChild: async () => new Promise(() => {}),
      getProjection: async () => projection,
      runWorkspaceCommand: async (command) => {
        runnerCommand = command;
        return { exitCode: 0, stdout: 'recorded suite passed', stderr: '' };
      },
    });

    assert.deepEqual(result, {
      ran: true,
      action: 'plan_and_execute',
      reason: 'runtime executed recorded adversarial suite after child recorded only the plan',
    });
    assert.equal(runnerCommand, plan.suite.rerunCommand);
    assert.equal(execution?.planId, plan.planId);
    assert.equal(execution?.status, 'pass');
  });

  test('reruns recorded suite directly without spawning child', async () => {
    const plan = adversarialPlan();
    let execution: HeavyTaskAdversarialCheckExecutionState | undefined;
    let runnerCommand = '';

    const result = await runHeavyTaskAdversarialSelfCheckCheckpoint({
      task,
      taskRunId: 'run-adversarial',
      attemptId: 'attempt-1',
      projection: {
        latestHeavyTaskSelfCheck: selfCheckPass(),
        latestHeavyTaskAdversarialCheckPlan: plan,
        latestHeavyTaskAdversarialCheckExecution: adversarialExecution(plan.planId),
      } as TaskRunProjection,
      recorder: {
        async recordPlan() {
          throw new Error('recordPlan should not be called when rerunning a recorded suite');
        },
        async recordExecution(input) {
          execution = {
            schemaVersion: 1,
            executionId: 'direct-rerun-execution',
            taskRunId: 'run-adversarial',
            attemptId: 'attempt-1',
            ts: 3,
            planId: input.planId,
            status: input.status,
            suite: input.suite,
            publicReason: input.publicReason,
            commandEvidence: input.commandEvidence,
            repairRecommendations: input.repairRecommendations,
            source: { kind: 'model_tool', toolCallId: 'direct-rerun-execution' },
          };
          return { accepted: true, execution };
        },
      },
      cwd: '/app',
      sessionId: 'session-1',
      runId: 'run-1',
      turnId: 'turn-1',
      now: () => 10,
      newId: () => 'id-1',
      spawnAdversarialChild: async () => {
        throw new Error('rerun should execute the recorded suite directly');
      },
      runWorkspaceCommand: async (command) => {
        runnerCommand = command;
        return { exitCode: 0, stdout: 'direct rerun passed', stderr: '' };
      },
    });

    assert.deepEqual(result, {
      ran: true,
      action: 'rerun',
      reason: 'runtime reran recorded adversarial suite directly',
    });
    assert.equal(runnerCommand, plan.suite.rerunCommand);
    assert.equal(execution?.planId, plan.planId);
    assert.equal(execution?.status, 'pass');
  });
});

function selfCheckPass(): HeavyTaskSemanticSelfCheckState {
  return {
    schemaVersion: 1,
    selfCheckId: 'self-check-1',
    taskRunId: 'run-adversarial',
    attemptId: 'attempt-1',
    ts: 1,
    status: 'pass',
    publicReason: 'public self-check passed',
    commandEvidence: [{ command: 'python3 /tmp/check.py', exitCode: 0, outputExcerpt: 'pass' }],
    artifactEvidence: [{ path: '/app/filter.py', kind: 'file', exists: true }],
    executionHygiene: {
      sandbox: {
        root: '/tmp/maka-self-check/run-adversarial',
        strategy: 'scratch_dir',
        commandCwd: '/tmp/maka-self-check/run-adversarial',
        outputPolicy: 'scratch_only',
      },
      scratchUsed: true,
      scratchPath: '/tmp/maka-self-check/run-adversarial',
      cleanupPerformed: true,
      workspaceSideEffects: 'none',
      workspaceGuard: {
        checked: true,
        checkedPaths: ['/app/filter.py'],
        addedPaths: [],
        modifiedPaths: [],
        removedPaths: [],
      },
    },
    guard: {
      status: 'accepted',
      checkedAt: 1,
      categories: [],
      publicReason: 'accepted public self-check',
    },
    source: { kind: 'model_tool', toolCallId: 'self-check-tool' },
  };
}

function adversarialPlan(): HeavyTaskAdversarialCheckPlanState {
  return {
    schemaVersion: 1,
    planId: 'plan-1',
    taskRunId: 'run-adversarial',
    attemptId: 'attempt-1',
    ts: 2,
    checks: [{
      id: 'preserve-clean-html',
      description: 'clean full document remains byte-identical',
      command: 'bash run_tests.sh',
      expectedOutcome: 'diff exits 0',
      source: 'subagent_plan',
    }],
    suite: {
      root: '/tmp/maka-adversarial/run-adversarial',
      planPath: '/tmp/maka-adversarial/run-adversarial/plan.json',
      runnerPath: '/tmp/maka-adversarial/run-adversarial/run_tests.sh',
      rerunCommand: 'cd /tmp/maka-adversarial/run-adversarial && bash run_tests.sh',
      generatedPaths: ['/tmp/maka-adversarial/run-adversarial/run_tests.sh'],
      publicReason: 'suite checks public preserve contract',
    },
    publicReason: 'plan checks public task requirements',
    source: { kind: 'model_tool', toolCallId: 'adversarial-plan-tool' },
  };
}

function adversarialExecution(planId: string): HeavyTaskAdversarialCheckExecutionState {
  return {
    schemaVersion: 1,
    executionId: 'execution-1',
    taskRunId: 'run-adversarial',
    attemptId: 'attempt-1',
    ts: 3,
    planId,
    status: 'pass',
    suite: {
      root: '/tmp/maka-adversarial/run-adversarial',
      runnerPath: '/tmp/maka-adversarial/run-adversarial/run_tests.sh',
      rerunCommand: 'cd /tmp/maka-adversarial/run-adversarial && bash run_tests.sh',
    },
    publicReason: 'suite passed',
    commandEvidence: [{ command: 'cd /tmp/maka-adversarial/run-adversarial && bash run_tests.sh', exitCode: 0, outputExcerpt: 'pass' }],
    repairRecommendations: [],
    source: { kind: 'model_tool', toolCallId: 'adversarial-execution-tool' },
  };
}
