import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { BackendRegistry, FakeBackend, SessionManager, type AgentBackend, type MakaTool, type SessionStore } from '@maka/runtime';
import {
  isTerminalRuntimeEvent,
  type AgentRunHeader,
  type AgentSpec,
  type BackendKind,
  type RuntimeEvent,
  type RuntimeEventStore,
  type SessionEvent,
  type SessionHeader,
} from '@maka/core';
import type { BackendSendInput, PermissionDecision } from '@maka/core/backend-types';
import { createRuntimeEventStore } from '@maka/storage';
import type { Config, Task } from '../contracts.js';
import type { HeadlessBackendContext } from '../isolation.js';
import { commandResourceScope, hashNormalizedArgs } from '../permission-grants.js';
import { runTaskOnce } from '../task-agent-controller.js';
import { resolveHeavyTaskMode } from '../heavy-task-policy.js';
import type { TaskPermissionGrant } from '../task-contracts.js';
import { buildIsolatedHeadlessTools } from '../tools.js';

const fakeConfig: Config = {
  id: 'fake-cfg',
  backend: 'fake',
  llmConnectionSlug: 'fake',
  model: 'fake-model',
};

const aiSdkConfig: Config = {
  id: 'ai-sdk-cfg',
  backend: 'ai-sdk',
  llmConnectionSlug: 'fake',
  model: 'fake-model',
};

const registerFakeBackend = (registry: BackendRegistry): void => {
  registry.register('fake', (ctx) =>
    new FakeBackend({ sessionId: ctx.sessionId, header: ctx.header, store: ctx.store }),
  );
};

class ReportingBackend implements AgentBackend {
  readonly kind: BackendKind = 'ai-sdk';
  readonly sessionId: string;

  constructor(private readonly ctx: { sessionId: string; header: SessionHeader; store: SessionStore }) {
    this.sessionId = ctx.sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    const { turnId } = input;
    const ts = Date.now();
    const messageId = 'reporting-message';
    await this.ctx.store.appendMessage(this.sessionId, {
      type: 'assistant',
      id: messageId,
      turnId,
      ts,
      text: 'done',
      modelId: this.ctx.header.model,
    });
    yield { type: 'text_complete', id: 'report-text', turnId, ts, messageId, text: 'done' };
    yield {
      type: 'tool_result',
      id: 'report-artifact',
      turnId,
      ts,
      toolUseId: 'tool-1',
      isError: false,
      content: {
        kind: 'archived_tool_result',
        status: 'not_loaded',
        runtimeEventId: 'runtime-old',
        toolCallId: 'tool-1',
        toolName: 'bash',
        artifactId: 'artifact-1',
        originalEstimatedTokens: 12,
        originalBytes: 34,
        rewriteVersion: 1,
        reason: 'stale_tool_result_pruned_before_compact',
      },
    };
    yield {
      type: 'token_usage',
      id: 'report-usage',
      turnId,
      ts,
      input: 10,
      output: 5,
      reasoning: 2,
      total: 17,
      costUsd: 0.123,
      contextBudget: { policyName: 'unit-budget', droppedTurns: 1 } as never,
    };
    yield { type: 'complete', id: 'report-complete', turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerReportingBackend = (registry: BackendRegistry): void => {
  registry.register('ai-sdk', (ctx) =>
    new ReportingBackend({ sessionId: ctx.sessionId, header: ctx.header, store: ctx.store }),
  );
};

class ParentSpawnToolBackend implements AgentBackend {
  readonly kind: BackendKind = 'ai-sdk';
  readonly sessionId: string;

  constructor(private readonly ctx: {
    sessionId: string;
    header: SessionHeader;
    store: SessionStore;
    tools: readonly MakaTool[];
    spawnChildAgent?: (input: {
      parentRunId: string;
      spec: AgentSpec;
      prompt: string;
      abortSignal: AbortSignal;
    }) => Promise<unknown>;
  }) {
    this.sessionId = ctx.sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    const ts = Date.now();
    const spawn = this.ctx.tools.find((candidate) => candidate.name === 'agent_spawn');
    assert.ok(spawn, 'parent tool surface should include agent_spawn');
    const abortController = new AbortController();
    const result = await spawn.impl({
      profile: 'local_read',
      task: 'Return a strict semantic self-check checklist.',
    }, {
      sessionId: this.sessionId,
      turnId: input.turnId,
      cwd: this.ctx.header.cwd,
      toolCallId: 'spawn-tool',
      abortSignal: abortController.signal,
      emitOutput: () => {},
      ...(this.ctx.spawnChildAgent
        ? {
            spawnChildAgent: ({ spec, prompt }) => this.ctx.spawnChildAgent!({
              parentRunId: input.runId ?? 'parent-run',
              spec,
              prompt,
              abortSignal: abortController.signal,
            }),
          }
        : {}),
    });
    assert.match(JSON.stringify(result), /semantic checklist from child/);
    const messageId = 'parent-spawn-message';
    await this.ctx.store.appendMessage(this.sessionId, {
      type: 'assistant',
      id: messageId,
      turnId: input.turnId,
      ts,
      text: 'spawned child',
      modelId: this.ctx.header.model,
    });
    yield { type: 'text_complete', id: 'parent-spawn-text', turnId: input.turnId, ts, messageId, text: 'spawned child' };
    yield { type: 'complete', id: 'parent-spawn-complete', turnId: input.turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

class ChildChecklistBackend implements AgentBackend {
  readonly kind: BackendKind = 'ai-sdk';
  readonly sessionId: string;

  constructor(private readonly ctx: {
    sessionId: string;
    header: SessionHeader;
    store: SessionStore;
    tools: readonly MakaTool[];
    seenChildToolNames: string[][];
  }) {
    this.sessionId = ctx.sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    this.ctx.seenChildToolNames.push(this.ctx.tools.map((tool) => tool.name).sort());
    const ts = Date.now();
    const messageId = 'child-checklist-message';
    await this.ctx.store.appendMessage(this.sessionId, {
      type: 'assistant',
      id: messageId,
      turnId: input.turnId,
      ts,
      text: 'semantic checklist from child',
      modelId: this.ctx.header.model,
    });
    yield { type: 'text_complete', id: 'child-checklist-text', turnId: input.turnId, ts, messageId, text: 'semantic checklist from child' };
    yield { type: 'complete', id: 'child-checklist-complete', turnId: input.turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerParentSpawnToolBackend = (
  seenChildToolNames: string[][],
) => (registry: BackendRegistry, context: HeadlessBackendContext): void => {
  assert.ok(context.toolExecutor);
  registry.register('ai-sdk', (ctx) => {
    if (ctx.systemPrompt) {
      return new ChildChecklistBackend({
        sessionId: ctx.sessionId,
        header: ctx.header,
        store: ctx.store,
        tools: ctx.tools ?? [],
        seenChildToolNames,
      });
    }
    return new ParentSpawnToolBackend({
      sessionId: ctx.sessionId,
      header: ctx.header,
      store: ctx.store,
      tools: buildIsolatedHeadlessTools(context.toolExecutor!),
      spawnChildAgent: ctx.spawnChildAgent,
    });
  });
};

class ProtectedTamperBackend implements AgentBackend {
  readonly kind: BackendKind = 'fake';
  readonly sessionId: string;

  constructor(private readonly ctx: { sessionId: string; header: SessionHeader; store: SessionStore }) {
    this.sessionId = ctx.sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    const { turnId } = input;
    const ts = Date.now();
    const messageId = 'tamper-message';
    await writeFile(join(this.ctx.header.cwd, 'check.mjs'), 'process.exit(0);\n', 'utf8');
    await this.ctx.store.appendMessage(this.sessionId, {
      type: 'assistant',
      id: messageId,
      turnId,
      ts,
      text: 'tampered with verifier asset',
      modelId: this.ctx.header.model,
    });
    yield { type: 'text_complete', id: 'tamper-text', turnId, ts, messageId, text: 'tampered with verifier asset' };
    yield { type: 'complete', id: 'tamper-complete', turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerProtectedTamperBackend = (registry: BackendRegistry): void => {
  registry.register('fake', (ctx) =>
    new ProtectedTamperBackend({ sessionId: ctx.sessionId, header: ctx.header, store: ctx.store }),
  );
};

class FailingBackend implements AgentBackend {
  readonly kind: BackendKind = 'fake';
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    const ts = Date.now();
    yield {
      type: 'error',
      id: 'fail-error',
      turnId: input.turnId,
      ts,
      recoverable: false,
      reason: 'backend_failed',
      message: 'backend exploded',
    };
    yield { type: 'complete', id: 'fail-complete', turnId: input.turnId, ts, stopReason: 'error' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerFailingBackend = (registry: BackendRegistry): void => {
  registry.register('fake', (ctx) => new FailingBackend(ctx.sessionId));
};

class IncompleteBackend implements AgentBackend {
  readonly kind: BackendKind = 'fake';
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    const ts = Date.now();
    yield {
      type: 'token_usage',
      id: 'incomplete-usage',
      turnId: input.turnId,
      ts,
      input: 1,
      output: 2,
      rawFinishReason: 'tool_calls',
    };
    yield { type: 'complete', id: 'incomplete-complete', turnId: input.turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerIncompleteBackend = (registry: BackendRegistry): void => {
  registry.register('fake', (ctx) => new IncompleteBackend(ctx.sessionId));
};

class PermissionRequestBackend implements AgentBackend {
  readonly kind: BackendKind = 'fake';
  readonly sessionId: string;

  constructor(sessionId: string, private readonly onRespond: () => void, private readonly command: string) {
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
      args: { command: this.command },
    };
    yield { type: 'complete', id: 'permission-complete', turnId: input.turnId, ts, stopReason: 'permission_handoff' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {
    this.onRespond();
    throw new Error('headless task facade must not answer interactive permission requests');
  }
  async dispose(): Promise<void> {}
}

const registerPermissionRequestBackend = (onRespond: () => void, command = 'rm -rf /tmp/example') => (registry: BackendRegistry): void => {
  registry.register('fake', (ctx) => new PermissionRequestBackend(ctx.sessionId, onRespond, command));
};

class AdversarialCheckpointBackend implements AgentBackend {
  readonly kind: BackendKind = 'ai-sdk';
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    const rerunMatch = /Exact rerun command: (.+)/.exec(input.text);
    const command = rerunMatch?.[1]?.trim() || 'cd /tmp/maka-adversarial/unit && bash run_tests.sh';
    const isRerun = Boolean(rerunMatch);
    const payload = isRerun
      ? {
          execution: {
            status: 'pass',
            publicReason: 'recorded adversarial suite rerun passed',
            commandEvidence: [{ command, exitCode: 0, outputExcerpt: 'adversarial suite passed' }],
            repairRecommendations: [],
          },
        }
      : {
          plan: {
            checks: [{
              id: 'adv-1',
              description: 'public adversarial marker check',
              command,
              expectedOutcome: 'marker check passes',
              source: 'subagent_plan',
            }],
            suite: {
              root: '/tmp/maka-adversarial/unit',
              planPath: '/tmp/maka-adversarial/unit/plan.json',
              runnerPath: '/tmp/maka-adversarial/unit/run_tests.sh',
              rerunCommand: command,
              generatedPaths: ['/tmp/maka-adversarial/unit/plan.json', '/tmp/maka-adversarial/unit/run_tests.sh'],
              publicReason: 'unit test suite is derived from public task evidence',
            },
            publicReason: 'unit test adversarial plan covers public task evidence',
          },
          execution: {
            status: 'pass',
            publicReason: 'initial adversarial suite execution passed',
            commandEvidence: [{ command, exitCode: 0, outputExcerpt: 'adversarial suite passed' }],
            repairRecommendations: [],
          },
        };
    const text = `ADVERSARIAL_CHECK_RESULT_JSON\n${JSON.stringify(payload)}\nEND_ADVERSARIAL_CHECK_RESULT_JSON`;
    const ts = Date.now();
    yield { type: 'text_complete', id: `adversarial-text-${input.turnId}`, turnId: input.turnId, ts, messageId: `adversarial-message-${input.turnId}`, text };
    yield { type: 'complete', id: `adversarial-complete-${input.turnId}`, turnId: input.turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

function isAdversarialChildContext(ctx: { systemPrompt?: string; tools?: readonly MakaTool[] }): boolean {
  return Boolean(ctx.systemPrompt?.includes('foreground adversarial-check child agent'));
}

class ProgressToolBackend implements AgentBackend {
  readonly kind: BackendKind = 'ai-sdk';
  readonly sessionId: string;

  constructor(private readonly ctx: {
    sessionId: string;
    header: SessionHeader;
    tools: ReturnType<typeof buildIsolatedHeadlessTools>;
  }) {
    this.sessionId = ctx.sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    const inventorySubmit = this.ctx.tools.find((tool) => tool.name === 'inventory_submit');
    const todoUpdate = this.ctx.tools.find((tool) => tool.name === 'todo_update');
    const acceptanceDagSubmit = this.ctx.tools.find((tool) => tool.name === 'acceptance_dag_submit');
    const selfCheckPlanSubmit = this.ctx.tools.find((tool) => tool.name === 'self_check_plan_submit');
    const selfCheckSubmit = this.ctx.tools.find((tool) => tool.name === 'self_check_submit');
    const taskCreate = this.ctx.tools.find((tool) => tool.name === 'task_create');
    assert.ok(inventorySubmit);
    assert.ok(todoUpdate);
    assert.ok(acceptanceDagSubmit);
    assert.ok(selfCheckPlanSubmit);
    assert.ok(selfCheckSubmit);
    assert.ok(taskCreate);
    const toolCtx = {
      sessionId: this.sessionId,
      turnId: input.turnId,
      cwd: this.ctx.header.cwd,
      toolCallId: 'progress-tool-call',
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
    };
    await taskCreate.impl({
      tasks: [{ subject: 'Track heavy-task runnable artifact and public check' }],
    }, toolCtx);
    await submitAcceptanceDag(acceptanceDagSubmit, toolCtx, 'README.md');
    await inventorySubmit.impl({
      summary: 'Inspected public files.',
      items: [{ path: 'README.md', kind: 'file', status: 'observed' }],
    }, toolCtx);
    await todoUpdate.impl({
      items: [
        { id: 'artifact', kind: 'runnable_artifact', content: 'Use README.md as the public artifact', status: 'completed', priority: 'high', evidence: 'README.md exists' },
        { id: 'check', kind: 'public_check', content: 'Run public check after artifact exists', status: 'completed', priority: 'high', evidence: 'npm test passed' },
      ],
    }, toolCtx);
    await selfCheckPlanSubmit.impl({
      finalArtifacts: [{
        path: 'README.md',
        purpose: 'visible public artifact inspected by the check',
        publicReason: 'visible task notes are public',
      }],
      selfCheckScratch: {
        root: '/tmp/maka-self-check/progress',
        expectedGeneratedPaths: ['/tmp/maka-self-check/progress/check.log'],
        publicReason: 'public check outputs stay under scratch',
      },
      workspaceGuardPlan: {
        checkedPaths: ['README.md'],
        expectedAddedPaths: [],
        expectedGeneratedPathsOutsideScratch: [],
        publicReason: 'public guard checks visible artifact paths',
      },
      publicReason: 'plan is derived from visible public task files',
    }, toolCtx);
    await selfCheckSubmit.impl({
      status: 'pass',
      publicReason: 'npm test passed using public README.md-backed fixture state.',
      commandEvidence: [{ command: 'npm test README.md', exitCode: 0, outputExcerpt: 'public tests passed for README.md', artifactRefs: ['README.md'] }],
      artifactEvidence: [{ path: 'README.md', kind: 'file', exists: true }],
      executionHygiene: {
        sandbox: {
          root: '/tmp/maka-self-check/progress',
          strategy: 'read_only_deliverable_refs',
          commandCwd: '/tmp/maka-self-check/progress',
          outputPolicy: 'scratch_only',
        },
        scratchUsed: true,
        scratchPath: '/tmp/maka-self-check/progress',
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
    const ts = Date.now();
    yield { type: 'complete', id: 'progress-complete', turnId: input.turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerProgressToolBackend = (seen: HeadlessBackendContext[]) => {
  return (registry: BackendRegistry, context: HeadlessBackendContext): void => {
  seen.push(context);
  assert.ok(context.toolExecutor);
  registry.register('ai-sdk', (ctx) => isAdversarialChildContext(ctx)
    ? new AdversarialCheckpointBackend(ctx.sessionId)
    : new ProgressToolBackend({
    sessionId: ctx.sessionId,
    header: ctx.header,
    tools: buildIsolatedHeadlessTools(context.toolExecutor!, {
      exposeAgentTools: false,
      exposeAdversarialCheckTools: false,
      ...(context.heavyTaskEvidence ? { heavyTaskEvidence: context.heavyTaskEvidence } : {}),
      ...(context.heavyTaskProgress ? { heavyTaskProgress: context.heavyTaskProgress } : {}),
      ...(context.heavyTaskAcceptanceDag ? { heavyTaskAcceptanceDag: context.heavyTaskAcceptanceDag } : {}),
      ...(context.heavyTaskAdversarialCheck ? { heavyTaskAdversarialCheck: context.heavyTaskAdversarialCheck } : {}),
      ...(context.heavyTaskSelfCheck ? { heavyTaskSelfCheck: context.heavyTaskSelfCheck } : {}),
      ...(context.taskLedger ? { taskLedger: { store: context.taskLedger.store } } : {}),
    }),
  }));
  };
};

class GateRepairBackend implements AgentBackend {
  readonly kind: BackendKind = 'ai-sdk';
  readonly sessionId: string;

  constructor(private readonly ctx: {
    sessionId: string;
    header: SessionHeader;
    tools: ReturnType<typeof buildIsolatedHeadlessTools>;
    prompts: string[];
    repairSubmitsSelfCheck: boolean | number;
    repairFailsAfterSelfCheck?: boolean;
  }) {
    this.sessionId = ctx.sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    this.ctx.prompts.push(input.text);
    const ts = Date.now();
    const turnNumber = this.ctx.prompts.length;
    const selfCheckTurn = typeof this.ctx.repairSubmitsSelfCheck === 'number'
      ? this.ctx.repairSubmitsSelfCheck
      : this.ctx.repairSubmitsSelfCheck ? 2 : Number.POSITIVE_INFINITY;
    if (turnNumber === selfCheckTurn) {
      const todoUpdate = this.ctx.tools.find((tool) => tool.name === 'todo_update');
      const acceptanceDagSubmit = this.ctx.tools.find((tool) => tool.name === 'acceptance_dag_submit');
      const selfCheckPlanSubmit = this.ctx.tools.find((tool) => tool.name === 'self_check_plan_submit');
      const selfCheckSubmit = this.ctx.tools.find((tool) => tool.name === 'self_check_submit');
      assert.ok(todoUpdate);
      assert.ok(acceptanceDagSubmit);
      assert.ok(selfCheckPlanSubmit);
      assert.ok(selfCheckSubmit);
      const toolCtx = {
        sessionId: this.sessionId,
        turnId: input.turnId,
        cwd: this.ctx.header.cwd,
        toolCallId: 'gate-repair-tool-call',
        abortSignal: new AbortController().signal,
        emitOutput: () => {},
      };
      await todoUpdate.impl({
        items: [
          {
            id: 'artifact',
            kind: 'runnable_artifact',
            content: 'Keep marker.txt as the runnable artifact',
            status: 'completed',
            priority: 'high',
            evidence: 'test -f marker.txt passed.',
          },
          {
            id: 'check',
            kind: 'public_check',
            content: 'Run public marker check',
            status: 'completed',
            priority: 'high',
            evidence: 'test -f marker.txt passed.',
          },
        ],
      }, toolCtx);
      await submitAcceptanceDag(acceptanceDagSubmit, toolCtx, 'marker.txt');
      await selfCheckPlanSubmit.impl({
        finalArtifacts: [{
          path: 'marker.txt',
          purpose: 'visible runnable artifact',
          publicReason: 'visible task asks for marker.txt to exist',
        }],
        selfCheckScratch: {
          root: '/tmp/maka-self-check/gate-repair',
          expectedGeneratedPaths: ['/tmp/maka-self-check/gate-repair/check.log'],
          publicReason: 'public check outputs stay under scratch',
        },
        workspaceGuardPlan: {
          checkedPaths: ['marker.txt'],
          expectedAddedPaths: [],
          expectedGeneratedPathsOutsideScratch: [],
          publicReason: 'public guard checks marker.txt',
        },
        publicReason: 'plan is derived from visible public task evidence',
      }, toolCtx);
      await selfCheckSubmit.impl({
        status: 'pass',
        publicReason: 'test -f marker.txt passed from public workspace evidence.',
        commandEvidence: [{
          command: 'test -f marker.txt',
          exitCode: 0,
          outputExcerpt: 'marker present',
          artifactRefs: ['marker.txt'],
        }],
        artifactEvidence: [{ path: 'marker.txt', kind: 'file', exists: true }],
        executionHygiene: {
          sandbox: {
            root: '/tmp/maka-self-check/gate-repair',
            strategy: 'read_only_deliverable_refs',
            commandCwd: '/tmp/maka-self-check/gate-repair',
            outputPolicy: 'scratch_only',
          },
          scratchUsed: true,
          scratchPath: '/tmp/maka-self-check/gate-repair',
          cleanupPerformed: true,
          workspaceSideEffects: 'none',
          workspaceGuard: {
            checked: true,
            checkedPaths: ['marker.txt'],
            beforeListingCommand: 'find . -maxdepth 1 -type f | sort',
            afterListingCommand: 'find . -maxdepth 1 -type f | sort',
            addedPaths: [],
            modifiedPaths: [],
            removedPaths: [],
          },
        },
      }, toolCtx);
      if (this.ctx.repairFailsAfterSelfCheck) {
        yield {
          type: 'error',
          id: 'gate-repair-late-error',
          turnId: input.turnId,
          ts,
          recoverable: false,
          reason: 'backend_failed',
          message: 'repair stream terminated after accepted self-check',
        };
        yield { type: 'complete', id: `gate-complete-${turnNumber}`, turnId: input.turnId, ts, stopReason: 'error' };
        return;
      }
    }
    yield { type: 'text_complete', id: `gate-text-${turnNumber}`, turnId: input.turnId, ts, messageId: `gate-message-${turnNumber}`, text: 'done' };
    yield { type: 'complete', id: `gate-complete-${turnNumber}`, turnId: input.turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerGateRepairBackend = (
  prompts: string[],
  repairSubmitsSelfCheck: boolean | number,
  repairFailsAfterSelfCheck = false,
) => (registry: BackendRegistry, context: HeadlessBackendContext): void => {
  assert.ok(context.toolExecutor);
  registry.register('ai-sdk', (ctx) => isAdversarialChildContext(ctx)
    ? new AdversarialCheckpointBackend(ctx.sessionId)
    : new GateRepairBackend({
    sessionId: ctx.sessionId,
    header: ctx.header,
    tools: buildIsolatedHeadlessTools(context.toolExecutor!, {
      exposeAgentTools: false,
      exposeAdversarialCheckTools: false,
      ...(context.heavyTaskEvidence ? { heavyTaskEvidence: context.heavyTaskEvidence } : {}),
      ...(context.heavyTaskProgress ? { heavyTaskProgress: context.heavyTaskProgress } : {}),
      ...(context.heavyTaskAcceptanceDag ? { heavyTaskAcceptanceDag: context.heavyTaskAcceptanceDag } : {}),
      ...(context.heavyTaskAdversarialCheck ? { heavyTaskAdversarialCheck: context.heavyTaskAdversarialCheck } : {}),
      ...(context.heavyTaskSelfCheck ? { heavyTaskSelfCheck: context.heavyTaskSelfCheck } : {}),
      ...(context.taskLedger ? { taskLedger: { store: context.taskLedger.store } } : {}),
    }),
    prompts,
    repairSubmitsSelfCheck,
    repairFailsAfterSelfCheck,
  }));
};

class GateLaunderBackend implements AgentBackend {
  readonly kind: BackendKind = 'ai-sdk';
  readonly sessionId: string;

  constructor(private readonly ctx: {
    sessionId: string;
    header: SessionHeader;
    tools: ReturnType<typeof buildIsolatedHeadlessTools>;
    prompts: string[];
  }) {
    this.sessionId = ctx.sessionId;
  }

  async *send(input: BackendSendInput): AsyncIterable<SessionEvent> {
    this.ctx.prompts.push(input.text);
    const ts = Date.now();
    const turnNumber = this.ctx.prompts.length;
    const repaired = turnNumber >= 3;
    const todoUpdate = this.ctx.tools.find((tool) => tool.name === 'todo_update');
    const acceptanceDagSubmit = this.ctx.tools.find((tool) => tool.name === 'acceptance_dag_submit');
    const selfCheckPlanSubmit = this.ctx.tools.find((tool) => tool.name === 'self_check_plan_submit');
    const selfCheckSubmit = this.ctx.tools.find((tool) => tool.name === 'self_check_submit');
    assert.ok(todoUpdate);
    assert.ok(acceptanceDagSubmit);
    assert.ok(selfCheckPlanSubmit);
    assert.ok(selfCheckSubmit);
    const toolCtx = {
      sessionId: this.sessionId,
      turnId: input.turnId,
      cwd: this.ctx.header.cwd,
      toolCallId: `launder-tool-call-${turnNumber}`,
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
    };
    await todoUpdate.impl({
      items: [
        {
          id: 'artifact',
          kind: 'runnable_artifact',
          content: 'Write /app/polyglot/main.py.c as the single final artifact',
          status: 'completed',
          priority: 'high',
          evidence: 'test -f /app/polyglot/main.py.c passed.',
        },
        {
          id: 'check',
          kind: 'public_check',
          content: 'Run Python and C public checks without leaving generated outputs in /app/polyglot',
          status: 'completed',
          priority: 'high',
          evidence: repaired
            ? 'gcc output was written under /tmp/maka-self-check/polyglot and the workspace guard showed no added paths.'
            : 'gcc output still remained in /app/polyglot/cmain and needs repair.',
        },
      ],
    }, toolCtx);
    await submitAcceptanceDag(acceptanceDagSubmit, toolCtx, '/app/polyglot/main.py.c', {
      command: 'test -f /app/polyglot/main.py.c',
      artifactPath: '/app/polyglot/main.py.c',
    });
    await selfCheckPlanSubmit.impl({
      finalArtifacts: [{
        path: '/app/polyglot/main.py.c',
        purpose: 'single-file polyglot source',
        publicReason: 'visible task asks for this final file',
      }],
      selfCheckScratch: {
        root: '/tmp/maka-self-check/polyglot',
        expectedGeneratedPaths: ['/tmp/maka-self-check/polyglot/cmain'],
        publicReason: 'compile checks should stay under scratch',
      },
      workspaceGuardPlan: {
        checkedPaths: ['/app/polyglot'],
        expectedAddedPaths: [],
        expectedGeneratedPathsOutsideScratch: [],
        publicReason: !repaired
          ? 'first plan only declares the final source file'
          : 'repair keeps compiled outputs under scratch',
      },
      publicReason: 'public polyglot self-check plan',
    }, toolCtx);
    await selfCheckSubmit.impl({
      status: 'pass',
      publicReason: repaired
        ? 'python and gcc checks passed with compiled output kept under scratch'
        : 'python and gcc checks passed, but cmain remains in /app/polyglot',
      commandEvidence: [{
        command: repaired
          ? 'gcc /app/polyglot/main.py.c -o /tmp/maka-self-check/polyglot/cmain && /tmp/maka-self-check/polyglot/cmain 10'
          : 'gcc /app/polyglot/main.py.c -o /app/polyglot/cmain && /app/polyglot/cmain 10',
        exitCode: 0,
        outputExcerpt: '55',
        artifactRefs: repaired
          ? ['/app/polyglot/main.py.c', '/tmp/maka-self-check/polyglot/cmain']
          : ['/app/polyglot/main.py.c', '/app/polyglot/cmain'],
      }],
      artifactEvidence: repaired
        ? [{ path: '/app/polyglot/main.py.c', kind: 'file', exists: true }]
        : [
            { path: '/app/polyglot/main.py.c', kind: 'file', exists: true },
            { path: '/app/polyglot/cmain', kind: 'file', exists: true },
          ],
      executionHygiene: {
        sandbox: {
          root: '/tmp/maka-self-check/polyglot',
          strategy: 'copied_inputs',
          commandCwd: '/tmp/maka-self-check/polyglot',
          outputPolicy: 'scratch_only',
        },
        scratchUsed: true,
        scratchPath: '/tmp/maka-self-check/polyglot',
        cleanupPerformed: true,
        workspaceSideEffects: repaired ? 'none' : 'present',
        workspaceGuard: {
          checked: true,
          checkedPaths: ['/app/polyglot'],
          beforeListingCommand: 'find /app/polyglot -maxdepth 1',
          afterListingCommand: 'find /app/polyglot -maxdepth 1',
          addedPaths: repaired ? [] : ['/app/polyglot/cmain'],
          modifiedPaths: [],
          removedPaths: [],
        },
      },
    }, toolCtx);
    yield { type: 'text_complete', id: `launder-text-${turnNumber}`, turnId: input.turnId, ts, messageId: `launder-message-${turnNumber}`, text: 'done' };
    yield { type: 'complete', id: `launder-complete-${turnNumber}`, turnId: input.turnId, ts, stopReason: 'end_turn' };
  }

  async stop(): Promise<void> {}
  async respondToPermission(_decision: PermissionDecision): Promise<void> {}
  async dispose(): Promise<void> {}
}

const registerGateLaunderBackend = (
  prompts: string[],
) => (registry: BackendRegistry, context: HeadlessBackendContext): void => {
  assert.ok(context.toolExecutor);
  registry.register('ai-sdk', (ctx) => isAdversarialChildContext(ctx)
    ? new AdversarialCheckpointBackend(ctx.sessionId)
    : new GateLaunderBackend({
    sessionId: ctx.sessionId,
    header: ctx.header,
    tools: buildIsolatedHeadlessTools(context.toolExecutor!, {
      exposeAgentTools: false,
      exposeAdversarialCheckTools: false,
      ...(context.heavyTaskEvidence ? { heavyTaskEvidence: context.heavyTaskEvidence } : {}),
      ...(context.heavyTaskProgress ? { heavyTaskProgress: context.heavyTaskProgress } : {}),
      ...(context.heavyTaskAcceptanceDag ? { heavyTaskAcceptanceDag: context.heavyTaskAcceptanceDag } : {}),
      ...(context.heavyTaskAdversarialCheck ? { heavyTaskAdversarialCheck: context.heavyTaskAdversarialCheck } : {}),
      ...(context.heavyTaskSelfCheck ? { heavyTaskSelfCheck: context.heavyTaskSelfCheck } : {}),
      ...(context.taskLedger ? { taskLedger: { store: context.taskLedger.store } } : {}),
    }),
    prompts,
  }));
};

type HeadlessTool = ReturnType<typeof buildIsolatedHeadlessTools>[number];

async function submitAcceptanceDag(
  tool: HeadlessTool,
  toolCtx: Parameters<HeadlessTool['impl']>[1],
  artifactPath: string,
  options: { command?: string; artifactPath?: string } = {},
): Promise<void> {
  const command = options.command ?? `test -f ${artifactPath}`;
  const evidenceArtifact = options.artifactPath ?? artifactPath;
  const checked = {
    status: 'pass' as const,
    publicReason: `${command} passed using visible public task evidence.`,
    commandEvidence: [{ command, exitCode: 0, outputExcerpt: 'public check passed', artifactRefs: [evidenceArtifact] }],
    artifactEvidence: [{ path: evidenceArtifact, kind: 'file' as const, exists: true }],
  };
  await tool.impl({
    summary: `public acceptance DAG for ${artifactPath}`,
    publicReason: 'DAG is derived from visible task instructions and public workspace evidence.',
    nodes: [
      { id: 'requirements', kind: 'requirement', title: 'Extract visible requirements', description: 'Read only public task instructions and workspace files', status: 'completed', dependsOn: [], acceptanceCriteria: ['visible requirements are identified'], required: true, selfCheck: checked },
      { id: 'deliverable', kind: 'deliverable', title: `Produce ${artifactPath}`, description: 'Create or preserve the visible final deliverable', status: 'completed', dependsOn: ['requirements'], acceptanceCriteria: [`${artifactPath} exists or is intentionally preserved`], required: true, selfCheck: checked },
      { id: 'implementation', kind: 'implementation', title: 'Implement task changes', description: 'Apply the public task work', status: 'completed', dependsOn: ['deliverable'], acceptanceCriteria: ['implementation work is complete'], required: true, selfCheck: checked },
      { id: 'public-check', kind: 'public_check', title: 'Run public check', description: 'Run a visible command or artifact inspection', status: 'completed', dependsOn: ['implementation'], acceptanceCriteria: ['public check exits successfully'], required: true, selfCheck: checked },
      { id: 'final-audit', kind: 'final_audit', title: 'Audit final state', description: 'Confirm visible evidence covers the deliverable', status: 'completed', dependsOn: ['public-check'], acceptanceCriteria: ['all required DAG nodes have pass self-check evidence'], required: true, selfCheck: checked },
    ],
  }, toolCtx);
}

async function submitAdversarialChecks(
  planTool: HeadlessTool,
  executionTool: HeadlessTool,
  toolCtx: Parameters<HeadlessTool['impl']>[1],
  existingPlanId?: string,
): Promise<string> {
  let planId = existingPlanId;
  if (!planId) {
    const planResult = await planTool.impl({
      publicReason: 'adversarial checks are derived from visible task requirements and public artifacts.',
      suite: {
        root: '/tmp/maka-adversarial/test-suite',
        planPath: '/tmp/maka-adversarial/test-suite/plan.json',
        runnerPath: '/tmp/maka-adversarial/test-suite/run.sh',
        rerunCommand: 'sh /tmp/maka-adversarial/test-suite/run.sh',
        generatedPaths: ['/tmp/maka-adversarial/test-suite/plan.json', '/tmp/maka-adversarial/test-suite/run.sh'],
        publicReason: 'adversarial test-duty subagent generated and executed this public scratch suite.',
      },
      checks: [{
        id: 'adversarial-marker-check',
        description: 'Verify the visible required artifact with a public command.',
        command: 'test -f marker.txt || test -f README.md',
        expectedOutcome: 'at least one visible required artifact exists',
        source: 'subagent_plan',
      }],
    }, toolCtx) as { plan?: { planId?: string } };
    planId = planResult.plan?.planId ?? 'adversarial-plan-1';
  }
  await executionTool.impl({
    planId,
    status: 'pass',
    suite: {
      root: '/tmp/maka-adversarial/test-suite',
      runnerPath: '/tmp/maka-adversarial/test-suite/run.sh',
      rerunCommand: 'sh /tmp/maka-adversarial/test-suite/run.sh',
    },
    publicReason: 'adversarial subagent public artifact check passed.',
    commandEvidence: [{
      command: 'test -f marker.txt || test -f README.md',
      exitCode: 0,
      outputExcerpt: 'visible artifact present',
      artifactRefs: ['marker.txt', 'README.md'],
    }],
    repairRecommendations: [],
  }, toolCtx);
  return planId;
}

async function withDirs<T>(fn: (fixtureDir: string, storageRoot: string) => Promise<T>): Promise<T> {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'maka-task-controller-fx-'));
  const storageRoot = await mkdtemp(join(tmpdir(), 'maka-task-controller-store-'));
  try {
    return await fn(fixtureDir, storageRoot);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  }
}

async function readRuntimeEventLedger(storageRoot: string, sessionId: string, runId: string): Promise<RuntimeEvent[]> {
  const runtimeEventsPath = join(storageRoot, 'sessions', sessionId, 'runs', runId, 'runtime-events.jsonl');
  const content = await readFile(runtimeEventsPath, 'utf8');
  return content.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as RuntimeEvent);
}

async function readAgentRunHeader(storageRoot: string, sessionId: string, runId: string): Promise<AgentRunHeader> {
  const runPath = join(storageRoot, 'sessions', sessionId, 'runs', runId, 'run.json');
  return JSON.parse(await readFile(runPath, 'utf8')) as AgentRunHeader;
}

describe('runTaskOnce', () => {
  test('uses RuntimeRunner path without SessionManager.sendMessage and writes a passing ledger', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const original = SessionManager.prototype.sendMessage;
      SessionManager.prototype.sendMessage = async function* () {
        throw new Error('interactive sendMessage path must not be used');
      } as typeof original;
      try {
        const task: Task = {
          id: 'pass-task',
          instruction: 'do the thing',
          workspaceDir: fixtureDir,
          verification: { command: 'test -f marker.txt', protectedPaths: [] },
        };

        const result = await runTaskOnce(fakeConfig, task, {
          storageRoot,
          registerBackends: registerFakeBackend,
        });

        assert.equal(result.resultRecord.status, 'completed');
        assert.equal(result.resultRecord.passed, true);
        assert.equal(result.projection.status, 'completed');
        assert.equal(result.projection.latestScoreResult?.passed, true);
        assert.deepEqual(
          result.projection.events.map((event) => event.type),
          [
            'task_run_created',
            'task_run_queued',
            'heavy_task_mode_recorded',
            'economy_task_mode_recorded',
            'isolation_policy_recorded',
            'workspace_lease_recorded',
            'tool_executor_identity_recorded',
            'task_run_started',
            'task_attempt_started',
            'feedback_observed',
            'task_run_verifying',
            'verifier_result_recorded',
            'score_result_recorded',
            'task_attempt_completed',
            'task_run_completed',
          ],
        );
        assert.equal(result.projection.heavyTaskMode?.enabled, false);
        assert.equal(result.projection.isolation?.mode, 'inert_fake_backend');
        assert.equal(result.projection.workspaceLease?.taskRunId, result.taskRunId);
        assert.equal(result.projection.toolExecutors[0]?.isolationMode, 'inert_fake_backend');
        const tools = result.projection.latestScoreResult?.details?.tools as Record<string, unknown> | undefined;
        assert.ok(tools, 'score details should include tool economy summary');
        assert.equal(tools.actualToolCalls, 0);
        assert.deepEqual(tools.actualToolNames, []);
        assert.deepEqual(tools.actualToolCallCounts, {});
      } finally {
        SessionManager.prototype.sendMessage = original;
      }
    });
  });

  test('wires task-run agent_spawn to a real local-read child agent', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const seenChildToolNames: string[][] = [];
      const task: Task = {
        id: 'spawn-child-task',
        instruction: 'ask a local-read child for a checklist',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f marker.txt', protectedPaths: [] },
      };

      const result = await runTaskOnce(aiSdkConfig, task, {
        storageRoot,
        registerBackends: registerParentSpawnToolBackend(seenChildToolNames),
        realBackendIsolation: {
          kind: 'external',
          label: 'unit-test isolated executor',
          toolExecutor: {
            async exec() {
              return { exitCode: 0, stdout: '', stderr: '' };
            },
          },
        },
      });

      assert.equal(result.invocation.status, 'completed');
      assert.equal(result.resultRecord.passed, true);
      assert.deepEqual(seenChildToolNames, [['Glob', 'Grep', 'Read']]);
    });
  });

  test('records task-metadata heavy-task mode selection without changing scoring authority', async () => {
    await withDirs(async (fixtureDir) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const task: Task = {
        id: 'heavy-task',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f marker.txt', protectedPaths: [] },
        benchmark: { metadata: { heavyTaskMode: { enabled: true, reason: 'declared long task' } } },
      };

      const selection = resolveHeavyTaskMode(fakeConfig, task);

      assert.equal(selection.enabled, true);
      assert.equal(selection.triggerSource, 'task_metadata');
      assert.equal(selection.triggerReason, 'declared long task');
    });
  });

  test('records config economy-task mode selection without changing scoring authority', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const task: Task = {
        id: 'economy-task',
        instruction: 'write a csv summary',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f marker.txt', protectedPaths: [] },
      };

      const result = await runTaskOnce({
        ...fakeConfig,
        economyTaskMode: { enabled: true, reason: 'declared simple task' },
      }, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
      });

      assert.equal(result.projection.economyTaskMode?.enabled, true);
      assert.equal(result.projection.economyTaskMode?.triggerSource, 'config');
      assert.equal(result.projection.economyTaskMode?.triggerReason, 'declared simple task');
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'passed');
      assert.equal(result.resultRecord.passed, true);
    });
  });

  test('enabled heavy-task run exposes progress tools and records submitted snapshots', { skip: 'legacy aggregate fixture does not model the unbounded self-check loop; split into focused unit tests' }, async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'README.md'), 'public task notes\n', 'utf8');
      const seenContexts: HeadlessBackendContext[] = [];
      const config: Config = {
        ...fakeConfig,
        backend: 'ai-sdk',
        heavyTaskMode: true,
      };
      const task: Task = {
        id: 'progress-task',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f README.md', protectedPaths: [] },
      };

      const result = await runTaskOnce(config, task, {
        storageRoot,
        registerBackends: registerProgressToolBackend(seenContexts),
        realBackendIsolation: {
          kind: 'external',
          label: 'unit isolated executor',
          toolExecutor: {
            async exec() {
              return { exitCode: 0, stdout: '', stderr: '' };
            },
          },
        },
      });

      assert.equal(seenContexts[0]?.heavyTaskMode?.enabled, true);
      assert.ok(seenContexts[0]?.heavyTaskEvidence);
      assert.ok(seenContexts[0]?.heavyTaskProgress);
      assert.ok(seenContexts[0]?.heavyTaskAcceptanceDag);
      assert.ok(seenContexts[0]?.heavyTaskAdversarialCheck);
      assert.ok(seenContexts[0]?.heavyTaskSelfCheck);
      assert.ok(seenContexts[0]?.taskLedger);
      assert.ok(result.projection.toolExecutors[0]?.toolNames.includes('inventory_submit'));
      assert.ok(result.projection.toolExecutors[0]?.toolNames.includes('todo_update'));
      assert.ok(result.projection.toolExecutors[0]?.toolNames.includes('acceptance_dag_submit'));
      assert.ok(!result.projection.toolExecutors[0]?.toolNames.includes('agent_spawn'));
      assert.ok(!result.projection.toolExecutors[0]?.toolNames.includes('adversarial_check_plan_submit'));
      assert.ok(!result.projection.toolExecutors[0]?.toolNames.includes('adversarial_check_execution_submit'));
      assert.ok(result.projection.toolExecutors[0]?.toolNames.includes('self_check_plan_submit'));
      assert.ok(result.projection.toolExecutors[0]?.toolNames.includes('self_check_submit'));
      assert.ok(result.projection.toolExecutors[0]?.toolNames.includes('task_create'));
      assert.ok(result.projection.toolExecutors[0]?.toolNames.includes('task_update'));
      assert.ok(result.projection.toolExecutors[0]?.toolNames.includes('task_list'));
      assert.ok(result.projection.toolExecutors[0]?.toolNames.includes('task_get'));
      const taskLedger = seenContexts[0]?.taskLedger;
      assert.ok(taskLedger);
      const ledgerTasks = await taskLedger.store.list(result.projection.sessionId ?? '');
      assert.equal(ledgerTasks.length, 2);
      assert.equal(ledgerTasks[0]?.subject, 'Track heavy-task runnable artifact and public check');
      assert.equal(ledgerTasks[1]?.subject, 'Track heavy-task runnable artifact and public check');
      assert.equal(result.projection.latestHeavyTaskInventory?.summary, 'Inspected public files.');
      assert.equal(result.projection.latestHeavyTaskInventory?.items[0]?.path, 'README.md');
      assert.equal(result.projection.latestHeavyTaskTodos?.items[0]?.status, 'in_progress');
      assert.equal(result.projection.latestHeavyTaskTodos?.items[0]?.kind, 'runnable_artifact');
      assert.equal(result.projection.latestHeavyTaskTodos?.items[1]?.kind, 'public_check');
      assert.equal(result.projection.latestHeavyTaskAcceptanceDag?.nodes[0]?.id, 'requirements');
      assert.equal(result.projection.latestHeavyTaskSelfCheck?.status, 'pass');
      assert.equal(result.projection.latestHeavyTaskSelfCheckPlan?.guard.status, 'accepted');
      assert.equal(result.projection.latestHeavyTaskSelfCheck?.guard.status, 'accepted');
      assert.equal(
        result.projection.events.filter((event) => event.type === 'heavy_task_inventory_recorded').length,
        2,
      );
      assert.equal(
        result.projection.events.filter((event) => event.type === 'heavy_task_todos_recorded').length,
        2,
      );
      assert.equal(
        result.projection.events.filter((event) => event.type === 'heavy_task_acceptance_dag_recorded').length,
        2,
      );
      assert.equal(
        result.projection.events.filter((event) => event.type === 'heavy_task_adversarial_check_plan_recorded').length,
        1,
      );
      assert.equal(
        result.projection.events.filter((event) => event.type === 'heavy_task_adversarial_check_execution_recorded').length,
        2,
      );
      assert.equal(
        result.projection.events.filter((event) => event.type === 'heavy_task_self_check_plan_recorded').length,
        2,
      );
      assert.equal(
        result.projection.events.filter((event) => event.type === 'heavy_task_self_check_recorded').length,
        2,
      );
      assert.equal(
        result.projection.events.filter((event) => event.type === 'heavy_task_self_check_gate_recorded').length,
        2,
      );
    });
  });

  test('enabled heavy-task run performs a self-check repair turn before verifying', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const prompts: string[] = [];
      const config: Config = {
        ...fakeConfig,
        backend: 'ai-sdk',
        heavyTaskMode: true,
      };
      const task: Task = {
        id: 'gate-repair-task',
        instruction: 'Ensure marker.txt exists and verify it publicly.',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f marker.txt', protectedPaths: [] },
      };

      const result = await runTaskOnce(config, task, {
        storageRoot,
        registerBackends: registerGateRepairBackend(prompts, true),
        realBackendIsolation: {
          kind: 'external',
          label: 'unit isolated executor',
          toolExecutor: {
            async exec() {
              return { exitCode: 0, stdout: '', stderr: '' };
            },
          },
        },
      });

      assert.equal(prompts.length, 2);
      assert.match(prompts[1] ?? '', /not accepted for heavy-task finalization/);
      assert.equal(result.projection.latestHeavyTaskSelfCheckPlan?.guard.status, 'accepted');
      assert.equal(result.projection.latestHeavyTaskSelfCheck?.status, 'pass');
      assert.equal(result.projection.latestHeavyTaskSelfCheckGate?.action, 'allow_finalize');
      assert.equal(result.projection.latestVerifierResult?.passed, true);
      assert.equal(result.resultRecord.passed, true);
      const gateIndexes = result.projection.events
        .map((event, index) => event.type === 'heavy_task_self_check_gate_recorded' ? index : -1)
        .filter((index) => index >= 0);
      const verifyingIndex = result.projection.events.findIndex((event) => event.type === 'task_run_verifying');
      assert.equal(gateIndexes.length, 2);
      assert.ok(gateIndexes.every((index) => index < verifyingIndex));
    });
  });

  test('accepted repair self-check is not poisoned by late repair stream failure', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const prompts: string[] = [];
      const config: Config = {
        ...fakeConfig,
        backend: 'ai-sdk',
        heavyTaskMode: true,
      };
      const task: Task = {
        id: 'gate-repair-late-failure-task',
        instruction: 'Ensure marker.txt exists and verify it publicly.',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f marker.txt', protectedPaths: [] },
      };

      const result = await runTaskOnce(config, task, {
        storageRoot,
        registerBackends: registerGateRepairBackend(prompts, true, true),
        realBackendIsolation: {
          kind: 'external',
          label: 'unit isolated executor',
          toolExecutor: {
            async exec() {
              return { exitCode: 0, stdout: '', stderr: '' };
            },
          },
        },
      });

      assert.equal(prompts.length, 2);
      assert.equal(result.projection.latestHeavyTaskSelfCheck?.status, 'pass');
      assert.equal(result.projection.latestHeavyTaskSelfCheckGate?.action, 'allow_finalize');
      assert.equal(result.projection.latestVerifierResult?.passed, true);
      assert.equal(result.resultRecord.status, 'completed');
      assert.equal(result.resultRecord.passed, true);
      assert.equal(result.projection.latestScoreResult?.details?.invocationStatus, 'completed');
    });
  });

  test('self-check gate keeps looping until repair satisfies the gate', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const prompts: string[] = [];
      const config: Config = {
        ...fakeConfig,
        backend: 'ai-sdk',
        heavyTaskMode: true,
      };
      const task: Task = {
        id: 'gate-still-missing-task',
        instruction: 'Ensure marker.txt exists and verify it publicly.',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f marker.txt', protectedPaths: [] },
      };

      const result = await runTaskOnce(config, task, {
        storageRoot,
        registerBackends: registerGateRepairBackend(prompts, 3),
        realBackendIsolation: {
          kind: 'external',
          label: 'unit isolated executor',
          toolExecutor: {
            async exec() {
              return { exitCode: 0, stdout: '', stderr: '' };
            },
          },
        },
      });

      assert.equal(prompts.length, 3);
      assert.equal(result.projection.latestHeavyTaskSelfCheck?.status, 'pass');
      assert.equal(result.projection.latestHeavyTaskSelfCheckGate?.action, 'allow_finalize');
      assert.equal(result.projection.latestVerifierResult?.passed, true);
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'passed');
      assert.equal(result.resultRecord.passed, true);
      assert.equal(
        result.projection.events.filter((event) => event.type === 'heavy_task_self_check_gate_recorded').length,
        3,
      );
    });
  });

  test('repair loop records model-reported workspace side-effect diagnostic before official verifier', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const prompts: string[] = [];
      const config: Config = {
        ...fakeConfig,
        backend: 'ai-sdk',
        heavyTaskMode: true,
      };
      const task: Task = {
        id: 'polyglot-launder-task',
        instruction: 'Write a single file in /app/polyglot/main.py.c.',
        workspaceDir: fixtureDir,
        verification: { command: 'true', protectedPaths: [] },
      };

      const result = await runTaskOnce(config, task, {
        storageRoot,
        registerBackends: registerGateLaunderBackend(prompts),
        realBackendIsolation: {
          kind: 'external',
          label: 'unit isolated executor',
          toolExecutor: {
            async exec() {
              const repaired = prompts.length >= 3;
              return {
                exitCode: 0,
                stdout: repaired
                  ? 'file\t/app/polyglot/main.py.c\t\n'
                  : 'file\t/app/polyglot/main.py.c\t\nfile\t/app/polyglot/cmain\t\n',
                stderr: '',
              };
            },
          },
        },
      });

      assert.equal(prompts.length, 3);
      const gateReasons = result.projection.events
        .filter((event) => event.type === 'heavy_task_self_check_gate_recorded')
        .map((event) => event.gate.reason);
      assert.ok(gateReasons.some((reason) => /\/app\/polyglot\/cmain/.test(reason)));
      assert.ok(gateReasons.some((reason) => /unplanned_added_path/.test(reason)));
      assert.equal(result.projection.latestHeavyTaskSelfCheckGate?.action, 'allow_finalize');
      assert.equal(result.projection.latestVerifierResult?.passed, true);
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'passed');
      assert.equal(result.resultRecord.status, 'completed');
      assert.equal(result.resultRecord.passed, true);
      assert.equal(result.projection.events.some((event) => event.type === 'task_run_verifying'), true);
    });
  });

  test('records a failing verifier as a completed task run with passed=false', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const task: Task = {
        id: 'verify-fails',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f missing.txt', protectedPaths: [] },
      };

      const result = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
      });

      assert.equal(result.resultRecord.status, 'completed');
      assert.equal(result.resultRecord.passed, false);
      assert.equal(result.resultRecord.runnerCompleted, true);
      assert.equal(result.resultRecord.scored, true);
      assert.equal(result.resultRecord.eligible, true);
      assert.equal(result.projection.status, 'completed');
      assert.equal(result.projection.result?.passed, false);
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'verification_failed');
    });
  });

  test('records benchmark adapter hooks as unsupported instead of silently scoring', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const task: Task = {
        id: 'terminal-bench-hook',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verifier: {
          kind: 'terminal_bench',
          adapter: 'terminal-bench',
          instanceId: 'terminal-bench/example',
          protectedPaths: [],
        },
      };

      const result = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
      });

      assert.equal(result.resultRecord.status, 'completed');
      assert.equal(result.resultRecord.runnerCompleted, true);
      assert.equal(result.resultRecord.passed, false);
      assert.equal(result.resultRecord.scored, false);
      assert.equal(result.resultRecord.eligible, false);
      assert.equal(result.resultRecord.errorClass, 'unsupported_adapter');
      assert.equal(result.projection.status, 'completed');
      assert.equal(result.projection.latestVerifierResult?.kind, 'terminal_bench');
      assert.equal(result.projection.latestVerifierResult?.errorClass, 'unsupported_adapter');
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'unsupported_adapter');
    });
  });

  test('records official Harbor verifier result and container artifacts from benchmark adapter', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      const task: Task = {
        id: 'terminal-bench-official',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verifier: {
          kind: 'terminal_bench',
          adapter: 'terminal-bench',
          instanceId: 'terminal-bench/example',
          protectedPaths: [],
        },
      };

      const result = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
        benchmarkAdapters: {
          'terminal-bench': {
            name: 'terminal-bench',
            runVerifier: () => ({
              kind: 'terminal_bench',
              passed: true,
              exitCode: 0,
              score: 1,
              maxScore: 1,
              authority: { source: 'official_harbor_verifier', authoritative: true },
              details: { source: 'harbor', official: true, instanceId: 'terminal-bench/example' },
              artifacts: [
                {
                  kind: 'container_workspace',
                  workspacePath: '/app',
                  authority: { source: 'container_capture', authoritative: true },
                },
                {
                  kind: 'workspace_diff',
                  path: '/logs/artifacts/submission.diff',
                  workspacePath: '/app',
                  authority: { source: 'container_capture', authoritative: true },
                },
                {
                  kind: 'source_code',
                  path: '/logs/artifacts/app/vm.js',
                  workspacePath: '/app/vm.js',
                  authority: { source: 'container_capture', authoritative: true },
                },
                {
                  kind: 'generated_output',
                  path: '/logs/artifacts/frame.bmp',
                  workspacePath: '/app/frame.bmp',
                  authority: { source: 'container_capture', authoritative: true },
                },
                {
                  kind: 'benchmark_manifest',
                  path: '/logs/artifacts/manifest.json',
                  authority: { source: 'official_harbor_verifier', authoritative: true },
                },
              ],
            }),
          },
        },
      });

      assert.equal(result.resultRecord.passed, true);
      assert.equal(result.resultRecord.scored, true);
      assert.equal(result.projection.latestVerifierResult?.authority?.source, 'official_harbor_verifier');
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'passed');
      assert.equal(result.projection.artifacts.length, 5);
      assert.equal(result.projection.artifacts[0]?.workspacePath, '/app');
      assert.equal(result.projection.artifacts[2]?.workspacePath, '/app/vm.js');
      assert.equal(result.projection.artifacts[3]?.path, '/logs/artifacts/frame.bmp');
      assert.equal(result.projection.artifacts[4]?.kind, 'benchmark_manifest');
    });
  });

  test('freezes submitted workspace before restoring protected paths for verifier', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'src.mjs'), 'export const add = (a, b) => a - b;\n', 'utf8');
      await writeFile(
        join(fixtureDir, 'check.mjs'),
        "import { add } from './src.mjs';\nprocess.exit(add(2, 3) === 5 ? 0 : 1);\n",
        'utf8',
      );
      const task: Task = {
        id: 'freeze-before-restore',
        instruction: 'fix the bug',
        workspaceDir: fixtureDir,
        verification: { command: 'node check.mjs', protectedPaths: ['check.mjs'] },
      };

      const result = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        registerBackends: registerProtectedTamperBackend,
      });

      assert.equal(result.resultRecord.status, 'completed');
      assert.equal(result.resultRecord.passed, false);
      assert.equal(result.resultRecord.scored, true);
      assert.equal(result.projection.latestVerifierResult?.exitCode, 1);
      const snapshot = result.projection.latestScoreResult?.details?.submittedSnapshot as { snapshotPath?: string } | undefined;
      assert.ok(snapshot?.snapshotPath, 'expected submitted snapshot metadata in score details');
      assert.equal(await readFile(join(snapshot.snapshotPath, 'check.mjs'), 'utf8'), 'process.exit(0);\n');
    });
  });

  test('maps backend failure and incomplete runtime to terminal failure taxonomy', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const task: Task = {
        id: 'backend-fails',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f marker.txt', protectedPaths: [] },
      };

      const failed = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        taskRunId: 'backend-failure-run',
        registerBackends: registerFailingBackend,
      });
      assert.equal(failed.resultRecord.status, 'failed');
      assert.equal(failed.projection.status, 'failed');
      assert.equal(failed.projection.latestScoreResult?.taxonomy, 'agent_failed');
      assert.equal(failed.projection.error?.class, 'backend_failed');
      const failedRuntimeEvents = await readRuntimeEventLedger(
        storageRoot,
        failed.invocation.sessionId,
        failed.invocation.runId,
      );
      assert.deepEqual(
        failedRuntimeEvents
          .filter((event) => event.content?.kind === 'error' && !isTerminalRuntimeEvent(event))
          .map((event) => event.id),
        [],
      );
      const failedTerminalEvents = failedRuntimeEvents.filter(isTerminalRuntimeEvent);
      assert.equal(failedTerminalEvents.length, 1);
      assert.equal(failedTerminalEvents[0]?.status, 'failed');

      const incomplete = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        taskRunId: 'incomplete-run',
        registerBackends: registerIncompleteBackend,
      });
      assert.equal(incomplete.resultRecord.status, 'failed');
      assert.equal(incomplete.projection.status, 'incomplete');
      assert.equal(incomplete.projection.latestScoreResult?.taxonomy, 'agent_incomplete');
    });
  });

  test('does not persist terminal headless run headers when terminal runtime event append fails', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const task: Task = {
        id: 'terminal-append-fails',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f marker.txt', protectedPaths: [] },
      };
      const backingRuntimeEventStore = createRuntimeEventStore(storageRoot);
      const runtimeEventStore: RuntimeEventStore = {
        appendRuntimeEvent(sessionId, runId, event) {
          if (isTerminalRuntimeEvent(event)) {
            throw new Error('terminal append failed');
          }
          return backingRuntimeEventStore.appendRuntimeEvent(sessionId, runId, event);
        },
        readRuntimeEvents: (sessionId, runId) => backingRuntimeEventStore.readRuntimeEvents(sessionId, runId),
        readSessionRuntimeEvents: (sessionId) => backingRuntimeEventStore.readSessionRuntimeEvents(sessionId),
      };

      const result = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        registerBackends: registerFakeBackend,
        runtimeEventStore,
      });

      assert.equal(result.invocation.status, 'failed');
      assert.equal(result.invocation.failure?.message, 'terminal append failed');
      const runtimeEvents = await runtimeEventStore.readRuntimeEvents(result.invocation.sessionId, result.invocation.runId);
      assert.equal(runtimeEvents.some(isTerminalRuntimeEvent), false);
      const runHeader = await readAgentRunHeader(storageRoot, result.invocation.sessionId, result.invocation.runId);
      assert.notEqual(runHeader.status, 'completed');
      assert.notEqual(runHeader.status, 'failed');
      assert.notEqual(runHeader.status, 'cancelled');
    });
  });

  test('fails closed on permission requests without answering the interactive permission API', async () => {
    await withDirs(async (_fixtureDir, storageRoot) => {
      let respondCalls = 0;
      const task: Task = {
        id: 'permission-handoff',
        instruction: 'run a dangerous command',
        workspaceDir: _fixtureDir,
        verification: { command: 'true', protectedPaths: [] },
      };

      const result = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        registerBackends: registerPermissionRequestBackend(() => {
          respondCalls += 1;
        }),
      });

      assert.equal(respondCalls, 0);
      assert.equal(result.resultRecord.status, 'failed');
      assert.equal(result.resultRecord.passed, false);
      assert.equal(result.resultRecord.errorClass, 'policy_denied');
      assert.equal(result.projection.status, 'policy_denied');
      assert.equal(result.projection.latestVerifierResult?.exitCode, 0);
      assert.equal(result.projection.latestScoreResult?.passed, false);
      assert.equal(result.projection.latestScoreResult?.taxonomy, 'policy_denied');
      assert.ok(
        result.projection.events.some((event) => event.type === 'task_run_policy_denied'),
        'expected a policy-denied terminal task event',
      );
      assert.equal(result.projection.permissionRequests.length, 1);
      assert.equal(result.projection.permissionRequests[0]?.toolName, 'Bash');
      assert.equal(result.projection.permissionRequests[0]?.resourceScope.kind, 'command');
      const runtimeEvents = await readRuntimeEventLedger(storageRoot, result.invocation.sessionId, result.invocation.runId);
      assert.equal(runtimeEvents.some(isTerminalRuntimeEvent), false);
      assert.ok(
        runtimeEvents.some((event) => event.actions?.permissionRequest?.requestId === 'permission-request-1'),
        'expected the permission request fact to stay in the runtime ledger',
      );
      assert.equal(result.projection.inboxItems[0]?.kind, 'approval_request');
      assert.equal(result.projection.inboxItems[0]?.status, 'resolved');
      assert.ok(
        result.projection.events.some((event) => event.type === 'permission_decision_recorded' && event.decision === 'deny'),
        'expected a fail-closed permission denial event',
      );
    });
  });

  test('does not treat post-hoc matching permission grants as runtime authorization', async () => {
    await withDirs(async (_fixtureDir, storageRoot) => {
      let respondCalls = 0;
      const taskRunId = 'grant-run';
      const command = 'rm -rf /tmp/example';
      const grant: TaskPermissionGrant = {
        schemaVersion: 1,
        grantId: 'grant-posthoc',
        requestId: 'permission-request-1',
        taskRunId,
        attemptId: `${taskRunId}-attempt-1`,
        toolCallId: 'tool-1',
        toolName: 'Bash',
        normalizedArgsHash: hashNormalizedArgs({ command }),
        resourceScope: commandResourceScope(command),
        decision: 'allow',
        actor: { kind: 'test', id: 'unit' },
        source: 'test_fixture',
        decidedAt: 10,
        expiresAt: Number.MAX_SAFE_INTEGER,
      };
      const task: Task = {
        id: 'permission-grant-posthoc',
        instruction: 'run a dangerous command',
        workspaceDir: _fixtureDir,
        verification: { command: 'true', protectedPaths: [] },
      };

      const result = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        taskRunId,
        registerBackends: registerPermissionRequestBackend(() => {
          respondCalls += 1;
        }, command),
        permissionGrants: [grant],
      });

      assert.equal(respondCalls, 0);
      assert.equal(result.resultRecord.status, 'failed');
      assert.equal(result.resultRecord.errorClass, 'policy_denied');
      assert.equal(result.projection.status, 'policy_denied');
      assert.equal(result.projection.permissionGrants.length, 1);
      assert.equal(result.projection.permissionGrants[0]?.grantId, 'grant-posthoc');
      assert.equal(
        result.projection.events.some((event) => event.type === 'permission_decision_recorded' && event.decision === 'allow'),
        false,
      );
      const denyDecision = result.projection.events.find((event) => event.type === 'permission_decision_recorded');
      assert.ok(denyDecision);
      if (denyDecision.type !== 'permission_decision_recorded') {
        throw new Error('expected permission_decision_recorded event');
      }
      assert.equal(denyDecision.decision, 'deny');
      assert.match(denyDecision.reason ?? '', /post-hoc permission requests/);
    });
  });

  test('redacts bash permission scopes and inbox previews while preserving args hash', async () => {
    await withDirs(async (_fixtureDir, storageRoot) => {
      const secret = 'SECRET_TOKEN_123456';
      const command = `printf ${secret} > /tmp/secret-output`;
      const task: Task = {
        id: 'permission-redaction',
        instruction: 'request permission',
        workspaceDir: _fixtureDir,
        verification: { command: 'true', protectedPaths: [] },
      };

      const result = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        registerBackends: registerPermissionRequestBackend(() => {}, command),
      });

      const request = result.projection.permissionRequests[0];
      assert.ok(request);
      assert.equal(request.normalizedArgsHash, hashNormalizedArgs({ command }));
      assert.deepEqual(request.resourceScope, commandResourceScope(command));
      const serializedPermissionFacts = JSON.stringify({
        permissionRequests: result.projection.permissionRequests,
        inboxItems: result.projection.inboxItems,
        permissionEvents: result.projection.events.filter((event) =>
          event.type === 'permission_request_recorded' ||
          event.type === 'task_inbox_item_recorded' ||
          event.type === 'task_inbox_item_resolved',
        ),
      });
      assert.equal(serializedPermissionFacts.includes(secret), false);
      assert.equal(serializedPermissionFacts.includes(command), false);
      assert.match(serializedPermissionFacts, new RegExp(request.normalizedArgsHash));
    });
  });

  test('parks permission requests in desktop intervention mode without verifying', async () => {
    await withDirs(async (_fixtureDir, storageRoot) => {
      const task: Task = {
        id: 'permission-park',
        instruction: 'run a dangerous command',
        workspaceDir: _fixtureDir,
        verification: { command: 'false', protectedPaths: [] },
      };

      const result = await runTaskOnce(fakeConfig, task, {
        storageRoot,
        registerBackends: registerPermissionRequestBackend(() => {}),
        interventionPolicy: { mode: 'park' },
      });

      assert.equal(result.resultRecord.status, 'failed');
      assert.equal(result.resultRecord.errorClass, 'needs_approval');
      assert.equal(result.projection.status, 'needs_approval');
      assert.equal(result.projection.parked?.reason, 'approval');
      assert.equal(result.projection.latestVerifierResult, undefined);
      assert.equal(result.projection.latestScoreResult, undefined);
      assert.equal(result.projection.attempts[0]?.status, 'needs_approval');
      assert.equal(result.projection.inboxItems[0]?.kind, 'approval_request');
      assert.equal(result.projection.inboxItems[0]?.status, 'open');
    });
  });

  test('persists runtime refs, isolation, budget, and artifact metadata', async () => {
    await withDirs(async (fixtureDir, storageRoot) => {
      await writeFile(join(fixtureDir, 'marker.txt'), 'present', 'utf8');
      const task: Task = {
        id: 'metadata-task',
        instruction: 'do the thing',
        workspaceDir: fixtureDir,
        verification: { command: 'test -f marker.txt', protectedPaths: [] },
      };
      const config: Config = {
        id: 'real-cfg',
        backend: 'ai-sdk',
        llmConnectionSlug: 'test',
        model: 'test-model',
      };

      const result = await runTaskOnce(config, task, {
        storageRoot,
        registerBackends: registerReportingBackend,
        realBackendIsolation: { kind: 'external', label: 'unit isolation' },
      });

      const feedback = result.projection.feedback.find((entry) => entry.source === 'runtime');
      assert.ok(feedback?.details);
      assert.equal((feedback.details.isolation as { label?: string }).label, 'unit isolation');
      assert.equal((feedback.details.runtimeRefs as { runId?: string }).runId, result.invocation.runId);
      assert.ok((feedback.details.runtimeRefs as { runtimeEventIds?: string[] }).runtimeEventIds?.includes('report-usage'));
      assert.deepEqual(feedback.details.artifactRefs, [
        { runtimeEventId: 'report-artifact', artifactId: 'artifact-1', toolCallId: 'tool-1' },
      ]);
      assert.equal(((feedback.details.budget as { totals: { input: number } }).totals.input), 10);
      assert.deepEqual(result.projection.latestScoreResult?.details?.artifactRefs, feedback.details.artifactRefs);

      const runtimeEventsPath = join(storageRoot, 'sessions', result.invocation.sessionId, 'runs', result.invocation.runId, 'runtime-events.jsonl');
      const runtimeEvents = await readFile(runtimeEventsPath, 'utf8');
      assert.match(runtimeEvents, /report-usage/);
      assert.match(runtimeEvents, /report-artifact/);
    });
  });
});
