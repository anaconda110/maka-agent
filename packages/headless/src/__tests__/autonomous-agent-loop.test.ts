import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { BackendRegistry, FakeBackend, SessionManager, type SessionStore, type AgentBackend } from '@maka/runtime';
import type { BackendKind, SessionEvent, SessionHeader } from '@maka/core';
import type { BackendSendInput, PermissionDecision } from '@maka/core/backend-types';
import type { Config, Task } from '../contracts.js';
import type { HeadlessBackendContext } from '../isolation.js';
import { runAutonomousTask } from '../autonomous-agent-loop.js';

const fakeConfig: Config = {
  id: 'fake-cfg',
  backend: 'fake',
  llmConnectionSlug: 'fake',
  model: 'fake-model',
};

const registerFakeBackend = (registry: BackendRegistry): void => {
  registry.register('fake', (ctx) =>
    new FakeBackend({ sessionId: ctx.sessionId, header: ctx.header, store: ctx.store }),
  );
};

class PermissionRequestBackend implements AgentBackend {
  readonly kind: BackendKind = 'fake';
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    const ts = Date.now();
    yield {
      type: 'permission_request',
      id: 'permission-request-event',
      turnId: input.turnId,
      ts,
      requestId: 'permission-request-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      category: 'shell_unsafe',
      reason: 'shell_dangerous',
      args: { command: 'rm -rf /tmp/example' },
    };
    yield { type: 'complete', id: 'permission-complete', turnId: input.turnId, ts, stopReason: 'permission_handoff' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerPermissionRequestBackend = (registry: BackendRegistry): void => {
  registry.register('fake', (ctx) => new PermissionRequestBackend(ctx.sessionId));
};

class RuntimeContextCapturingBackend implements AgentBackend {
  readonly kind: BackendKind = 'fake';
  readonly sessionId: string;

  constructor(
    sessionId: string,
    private readonly runtimeContextCounts: number[],
  ) {
    this.sessionId = sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    this.runtimeContextCounts.push(input.runtimeContext?.length ?? 0);
    const ts = Date.now();
    yield { type: 'complete', id: `context-complete-${this.runtimeContextCounts.length}`, turnId: input.turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerRuntimeContextCapturingBackend = (runtimeContextCounts: number[]) => (registry: BackendRegistry): void => {
  registry.register('fake', (ctx) => new RuntimeContextCapturingBackend(ctx.sessionId, runtimeContextCounts));
};

class PromptCapturingProgressBackend implements AgentBackend {
  readonly kind: BackendKind = 'fake';
  readonly sessionId: string;

  constructor(
    sessionId: string,
    private readonly progress: HeadlessBackendContext['heavyTaskProgress'],
    private readonly evidence: HeadlessBackendContext['heavyTaskEvidence'],
    private readonly acceptanceDag: HeadlessBackendContext['heavyTaskAcceptanceDag'],
    private readonly adversarialCheck: HeadlessBackendContext['heavyTaskAdversarialCheck'],
    private readonly selfCheck: HeadlessBackendContext['heavyTaskSelfCheck'],
    private readonly prompts: string[],
    private readonly isAdversarialChild = false,
  ) {
    this.sessionId = sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    if (this.isAdversarialChild) {
      const command = 'test -f README.md';
      const payload = {
        plan: {
          checks: [{
            id: 'adv-readme',
            description: 'Verify the visible README artifact exists.',
            command,
            expectedOutcome: 'README.md exists',
            source: 'subagent_plan',
          }],
          suite: {
            root: '/tmp/maka-adversarial/autonomous-progress',
            planPath: '/tmp/maka-adversarial/autonomous-progress/plan.json',
            runnerPath: '/tmp/maka-adversarial/autonomous-progress/run.sh',
            rerunCommand: command,
            generatedPaths: [
              '/tmp/maka-adversarial/autonomous-progress/plan.json',
              '/tmp/maka-adversarial/autonomous-progress/run.sh',
            ],
            publicReason: 'unit adversarial suite uses only public README.md evidence.',
          },
          publicReason: 'unit adversarial plan checks public task artifacts only.',
        },
        execution: {
          status: 'pass',
          publicReason: 'README.md public adversarial check passed.',
          commandEvidence: [{ command, exitCode: 0, outputExcerpt: 'README.md present', artifactRefs: ['README.md'] }],
          repairRecommendations: [],
        },
      };
      const ts = Date.now();
      yield {
        type: 'text_complete',
        id: `adversarial-text-${input.turnId}`,
        turnId: input.turnId,
        ts,
        messageId: `adversarial-message-${input.turnId}`,
        text: `ADVERSARIAL_CHECK_RESULT_JSON\n${JSON.stringify(payload)}\nEND_ADVERSARIAL_CHECK_RESULT_JSON`,
      };
      yield { type: 'complete', id: `adversarial-complete-${input.turnId}`, turnId: input.turnId, ts, stopReason: 'end_turn' };
      return;
    }
    this.prompts.push(input.text);
    if (this.progress) {
      const toolCtx = {
        sessionId: this.sessionId,
        turnId: input.turnId,
        cwd: '/workspace',
        toolCallId: 'progress-tool-call',
        abortSignal: new AbortController().signal,
        emitOutput: () => {},
      };
      await this.progress.recordInventory({
        summary: 'Inspected public task files.',
        items: [{ path: 'README.md', kind: 'file', status: 'observed' }],
      }, toolCtx);
      await this.progress.recordTodos({
        items: [
          {
            id: 'artifact',
            kind: 'runnable_artifact',
            content: 'Use README.md as the visible artifact',
            status: 'completed',
            priority: 'high',
            evidence: 'README.md exists in the public workspace.',
          },
          {
            id: 'fix',
            kind: 'public_check',
            content: 'Patch implementation',
            status: 'completed',
            priority: 'high',
            evidence: 'test -f README.md passed.',
          },
        ],
      }, toolCtx);
      await this.evidence?.recordToolEvidence({
        name: 'Bash',
        input: { command: 'npm test', cwd: '/workspace', timeoutMs: 120_000 },
        result: { exitCode: 1, stdout: `public failure summary\n${'x'.repeat(5_000)}`, stderr: 'short stderr\n' },
      }, toolCtx);
      if (this.prompts.length === 1) {
        const adversarialPlan = await this.adversarialCheck?.recordPlan({
          checks: [{
            id: 'adv-readme',
            description: 'Verify the visible README artifact exists.',
            command: 'test -f README.md',
            expectedOutcome: 'README.md exists',
            source: 'subagent_plan',
          }],
          suite: {
            root: '/tmp/maka-adversarial/autonomous-progress',
            planPath: '/tmp/maka-adversarial/autonomous-progress/plan.json',
            runnerPath: '/tmp/maka-adversarial/autonomous-progress/run.sh',
            rerunCommand: 'test -f README.md',
            generatedPaths: [
              '/tmp/maka-adversarial/autonomous-progress/plan.json',
              '/tmp/maka-adversarial/autonomous-progress/run.sh',
            ],
            publicReason: 'unit adversarial suite uses only public README.md evidence.',
          },
          publicReason: 'unit adversarial plan checks public task artifacts only.',
        }, toolCtx);
        const planId = adversarialPlan?.accepted === true ? adversarialPlan.plan.planId : 'adv-readme-plan';
        await this.adversarialCheck?.recordExecution({
          planId,
          status: 'pass',
          suite: {
            root: '/tmp/maka-adversarial/autonomous-progress',
            runnerPath: '/tmp/maka-adversarial/autonomous-progress/run.sh',
            rerunCommand: 'test -f README.md',
          },
          publicReason: 'README.md public adversarial check passed.',
          commandEvidence: [{ command: 'test -f README.md', exitCode: 0, outputExcerpt: 'README.md present', artifactRefs: ['README.md'] }],
          repairRecommendations: [],
        }, toolCtx);
      }
      const selfCheckEvidence = {
        status: 'pass' as const,
        publicReason: 'test -f README.md passed using public workspace evidence.',
        commandEvidence: [{ command: 'test -f README.md', exitCode: 0, outputExcerpt: 'README.md present', artifactRefs: ['README.md'] }],
        artifactEvidence: [{ path: 'README.md', kind: 'file' as const, exists: true }],
      };
      await this.acceptanceDag?.recordAcceptanceDag({
        summary: 'public acceptance DAG for README.md',
        publicReason: 'DAG is derived from visible task instructions and public workspace files.',
        nodes: [
          { id: 'requirements', kind: 'requirement', title: 'Extract visible requirements', description: 'Read public task instructions', status: 'completed', dependsOn: [], acceptanceCriteria: ['requirements identified'], required: true, selfCheck: selfCheckEvidence },
          { id: 'artifact', kind: 'deliverable', title: 'Preserve README.md', description: 'Use README.md as public artifact evidence', status: 'completed', dependsOn: ['requirements'], acceptanceCriteria: ['README.md exists'], required: true, selfCheck: selfCheckEvidence },
          { id: 'implementation', kind: 'implementation', title: 'Complete public fixture implementation', description: 'Keep the public README artifact in place', status: 'completed', dependsOn: ['artifact'], acceptanceCriteria: ['artifact remains visible'], required: true, selfCheck: selfCheckEvidence },
          { id: 'check', kind: 'public_check', title: 'Run public artifact check', description: 'Run test -f README.md', status: 'completed', dependsOn: ['implementation'], acceptanceCriteria: ['command exits zero'], required: true, selfCheck: selfCheckEvidence },
          { id: 'audit', kind: 'final_audit', title: 'Audit public final state', description: 'Confirm public evidence covers the deliverable', status: 'completed', dependsOn: ['check'], acceptanceCriteria: ['self-check evidence covers README.md'], required: true, selfCheck: selfCheckEvidence },
        ],
      }, toolCtx);
      await this.selfCheck?.recordSelfCheckPlan({
        finalArtifacts: [{
          path: 'README.md',
          purpose: 'visible public artifact',
          publicReason: 'README.md is a public workspace file used for this unit fixture',
        }],
        selfCheckScratch: {
          root: '/tmp/maka-self-check/autonomous-progress',
          expectedGeneratedPaths: ['/tmp/maka-self-check/autonomous-progress/check.log'],
          publicReason: 'public check outputs stay under scratch',
        },
        workspaceGuardPlan: {
          checkedPaths: ['README.md'],
          expectedAddedPaths: [],
          expectedGeneratedPathsOutsideScratch: [],
          publicReason: 'guard checks public README artifact only',
        },
        publicReason: 'plan is derived from visible public workspace evidence',
      }, toolCtx);
      await this.selfCheck?.recordSelfCheck({
        ...selfCheckEvidence,
        executionHygiene: {
          sandbox: {
            root: '/tmp/maka-self-check/autonomous-progress',
            strategy: 'read_only_deliverable_refs',
            commandCwd: '/tmp/maka-self-check/autonomous-progress',
            outputPolicy: 'scratch_only',
          },
          scratchUsed: true,
          scratchPath: '/tmp/maka-self-check/autonomous-progress',
          cleanupPerformed: true,
          workspaceSideEffects: 'none',
          workspaceGuard: {
            checked: true,
            checkedPaths: ['README.md'],
            beforeListingCommand: 'find . -maxdepth 1 -type f | sort',
            afterListingCommand: 'find . -maxdepth 1 -type f | sort',
            addedPaths: [],
            modifiedPaths: [],
            removedPaths: [],
          },
        },
      }, toolCtx);
    }
    const ts = Date.now();
    yield { type: 'complete', id: `progress-complete-${this.prompts.length}`, turnId: input.turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerPromptCapturingProgressBackend = (prompts: string[]) => (registry: BackendRegistry, context: HeadlessBackendContext): void => {
  registry.register('fake', (ctx) => new PromptCapturingProgressBackend(
    ctx.sessionId,
    context.heavyTaskProgress,
    context.heavyTaskEvidence,
    context.heavyTaskAcceptanceDag,
    context.heavyTaskAdversarialCheck,
    context.heavyTaskSelfCheck,
    prompts,
    Boolean(ctx.systemPrompt?.includes('foreground adversarial-check child agent')),
  ));
};

async function withDirs<T>(fn: (fixtureDir: string, storageRoot: string) => Promise<T>): Promise<T> {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'maka-autonomous-loop-fx-'));
  const storageRoot = await mkdtemp(join(tmpdir(), 'maka-autonomous-loop-store-'));
  try {
    return await fn(fixtureDir, storageRoot);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  }
}

function idFactory(): () => string {
  let i = 0;
  return () => `id-${++i}`;
}

describe('runAutonomousTask', () => {
  test('uses RuntimeRunner path without SessionManager.sendMessage', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const original = SessionManager.prototype.sendMessage;
      SessionManager.prototype.sendMessage = async function* () {
        throw new Error('autonomous loop must not use interactive sendMessage');
      } as typeof original;
      try {
        const task: Task = {
          id: 'no-send-message',
          instruction: 'do the thing',
          workspaceDir: fixtureDir,
          verification: { command: 'test -f marker.txt', protectedPaths: [] },
        };

        const result = await runAutonomousTask(fakeConfig, task, {
          storageRoot,
          registerBackends: registerFakeBackend,
          budget: { maxAttempts: 2 },
          newId: idFactory(),
        });

        assert.equal(result.attempts.length, 1);
        assert.equal(result.resultRecord.passed, true);
        assert.equal(result.projection.status, 'completed');
      } finally {
        SessionManager.prototype.sendMessage = original;
      }
    });
  });

  test('runs one passing attempt and records stop decision', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const task: Task = {
        id: 'pass-task',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f marker.txt', protectedPaths: [] },
      };

      const result = await runAutonomousTask(fakeConfig, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
        budget: { maxAttempts: 3 },
        newId: idFactory(),
      });

      assert.equal(result.attempts.length, 1);
      assert.equal(result.resultRecord.passed, true);
      assert.equal(result.projection.status, 'completed');
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'passed');
      assert.equal(result.projection.decisions[0]?.decision, 'stop');
      assert.equal(result.projection.decisions[0]?.reason, 'authoritative verification passed');
      assert.equal(result.projection.feedback.some((entry) => entry.source === 'verifier'), true);
      assert.deepEqual(
        result.projection.events
          .filter((event) => event.type.startsWith('task_run_'))
          .map((event) => event.type),
        [
          'task_run_created',
          'task_run_queued',
          'task_run_started',
          'task_run_verifying',
          'task_run_completed',
        ],
      );
    });
  });

  test('continues after verifier failure until maxAttempts records budget terminal', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const task: Task = {
        id: 'verify-fails',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f missing.txt', protectedPaths: [] },
      };

      const result = await runAutonomousTask(fakeConfig, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
        budget: { maxAttempts: 2 },
        newId: idFactory(),
      });

      assert.equal(result.attempts.length, 2);
      assert.equal(result.resultRecord.passed, false);
      assert.equal(result.projection.status, 'budget_exhausted');
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'verification_failed');
      assert.deepEqual(result.projection.decisions.map((decision) => decision.decision), ['continue', 'stop']);
      assert.equal(result.projection.error?.class, 'budget_exhausted');
      assert.equal(
        result.projection.events.filter((event) => event.type === 'task_run_budget_exhausted').length,
        1,
      );
    });
  });

  test('can replay prior attempt runtime events into the next autonomous attempt', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const runtimeContextCounts: number[] = [];
      const task: Task = {
        id: 'replay-prior-runtime-context',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f missing.txt', protectedPaths: [] },
      };

      const result = await runAutonomousTask(fakeConfig, task, {
        storageRoot,
        registerBackends: registerRuntimeContextCapturingBackend(runtimeContextCounts),
        replayPriorAttemptRuntimeContext: true,
        budget: { maxAttempts: 2 },
        newId: idFactory(),
      });

      assert.equal(result.attempts.length, 2);
      assert.equal(runtimeContextCounts[0], 0);
      assert.ok((runtimeContextCounts[1] ?? 0) > 0, 'expected second attempt to receive prior runtime events');
    });
  });

  test('heavy-task continuation prompt includes compact progress from replay', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'README.md'), 'public notes\n', 'utf8');
      const prompts: string[] = [];
      const task: Task = {
        id: 'heavy-progress-retry',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f missing.txt', protectedPaths: [] },
      };

      const result = await runAutonomousTask({ ...fakeConfig, heavyTaskMode: true }, task, {
        storageRoot,
        registerBackends: registerPromptCapturingProgressBackend(prompts),
        budget: { maxAttempts: 2 },
        newId: idFactory(),
      });

      assert.equal(result.attempts.length, 2);
      assert.equal(result.projection.latestHeavyTaskInventory?.items[0]?.path, 'README.md');
      assert.equal(result.projection.latestHeavyTaskTodos?.items.some((item) => item.id === 'fix'), true);

      const continuationPrompt = prompts.find((prompt) =>
        prompt.includes('Heavy-task progress state from prior task-run events'),
      );
      assert.ok(continuationPrompt, 'expected autonomous retry prompt to include replayed heavy-task progress');
      assert.match(continuationPrompt, /Inventory summary: Inspected public task files/);
      assert.match(continuationPrompt, /Active todo: none/);
      assert.match(continuationPrompt, /public_check fix: Patch implementation/);
      assert.match(continuationPrompt, /Heavy-task compact evidence from prior public tool\/check\/artifact observations/);
      assert.match(continuationPrompt, /tool:Bash exit=1/);
      assert.match(continuationPrompt, /truncated=true/);
      assert.doesNotMatch(continuationPrompt, new RegExp(`x{${3_000}}`));
      assert.equal((continuationPrompt.match(/Heavy-task progress state/g) ?? []).length, 1);
      assert.equal((continuationPrompt.match(/Heavy-task compact evidence/g) ?? []).length, 1);
    });
  });

  test('self-check pass-like language is non-authoritative when verifier fails', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const task: Task = {
        id: 'self-check-does-not-score',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f missing.txt', protectedPaths: [] },
      };

      const result = await runAutonomousTask(fakeConfig, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
        budget: { maxAttempts: 1 },
        selfCheck: {
          observe: () => ({ summary: 'self-check passed: looks solved', details: { passed: true } }),
        },
        newId: idFactory(),
      });

      assert.equal(result.projection.selfChecks[0]?.summary, 'self-check passed: looks solved');
      assert.equal(result.resultRecord.passed, false);
      assert.equal(result.projection.result?.passed, false);
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'verification_failed');
      assert.notEqual(result.projection.latestScoreResult?.taxonomy, 'passed');
      assert.equal(result.projection.status, 'budget_exhausted');
    });
  });

  test('maxRuntimeSteps fails closed after an over-cap attempt', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const task: Task = {
        id: 'runtime-step-cap',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f missing.txt', protectedPaths: [] },
      };

      const result = await runAutonomousTask(fakeConfig, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
        budget: { maxAttempts: 3, maxRuntimeSteps: 1 },
        newId: idFactory(),
      });

      assert.equal(result.attempts.length, 1);
      assert.equal(result.projection.status, 'budget_exhausted');
      assert.equal(result.projection.decisions[0]?.reason, 'runtime step cap reached');
      assert.equal(result.projection.error?.class, 'budget_exhausted');
    });
  });

  test('maxRuntimeSteps can park for budget extension in desktop mode', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const task: Task = {
        id: 'runtime-step-cap-park',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f missing.txt', protectedPaths: [] },
      };

      const result = await runAutonomousTask(fakeConfig, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
        budget: { maxAttempts: 3, maxRuntimeSteps: 1 },
        interventionPolicy: { mode: 'park', allowBudgetExtensionRequests: true },
        newId: idFactory(),
      });

      assert.equal(result.attempts.length, 1);
      assert.equal(result.projection.status, 'needs_approval');
      assert.equal(result.projection.parked?.reason, 'budget_extension');
      assert.equal(result.projection.inboxItems[0]?.kind, 'budget_extension');
      assert.equal(result.projection.events.some((event) => event.type === 'task_run_budget_exhausted'), false);
    });
  });

  test('maxWallTimeMs fails closed before starting another attempt', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const task: Task = {
        id: 'wall-cap',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f missing.txt', protectedPaths: [] },
      };
      let t = 0;

      const result = await runAutonomousTask(fakeConfig, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
        budget: { maxAttempts: 3, maxWallTimeMs: 1 },
        now: () => {
          t += 10;
          return t;
        },
        newId: idFactory(),
      });

      assert.equal(result.attempts.length, 0);
      assert.equal(result.projection.status, 'budget_exhausted');
      assert.equal(result.projection.feedback[0]?.source, 'system');
      assert.equal(result.projection.error?.class, 'budget_exhausted');
    });
  });

  test('non-retryable policy-denied taxonomy stops without continuation', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const task: Task = {
        id: 'policy-denied',
        instruction: 'run a dangerous command',
        workspaceDir: fixtureDir,
        verification: { command: 'true', protectedPaths: [] },
      };

      const result = await runAutonomousTask(fakeConfig, task, {
        storageRoot,
        registerBackends: registerPermissionRequestBackend,
        budget: { maxAttempts: 3 },
        newId: idFactory(),
      });

      assert.equal(result.attempts.length, 1);
      assert.equal(result.projection.status, 'policy_denied');
      assert.equal(result.projection.decisions[0]?.decision, 'stop');
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'policy_denied');
    });
  });
});
