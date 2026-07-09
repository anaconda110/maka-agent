import type { MakaTool, MakaToolContext } from '@maka/runtime';
import { z } from 'zod';
import {
  heavyTaskCommandEvidenceSchema,
  validateHeavyTaskPublicStrings,
} from './heavy-task-self-check.js';
import type {
  HeavyTaskAdversarialCheckExecutionState,
  HeavyTaskAdversarialCheckPlanState,
  HeavyTaskCommandEvidence,
  TaskEvent,
} from './task-contracts.js';
import type { TaskRunStore } from './task-run-store.js';

const MAX_REASON_CHARS = 2_000;
const MAX_CHECKS = 20;
const MAX_CHECK_ID_CHARS = 80;
const MAX_CHECK_TEXT_CHARS = 1_000;
const MAX_REPAIR_ITEMS = 12;
const MAX_SUITE_PATHS = 40;

export const HEAVY_TASK_ADVERSARIAL_CHECK_TOOL_NAMES = [
  'adversarial_check_plan_submit',
  'adversarial_check_execution_submit',
] as const;

export const heavyTaskAdversarialMustRunCheckSchema = z.object({
  id: z.string().trim().min(1).max(MAX_CHECK_ID_CHARS),
  description: z.string().trim().min(1).max(MAX_CHECK_TEXT_CHARS),
  command: z.string().trim().min(1).max(MAX_CHECK_TEXT_CHARS).optional(),
  expectedOutcome: z.string().trim().min(1).max(MAX_CHECK_TEXT_CHARS),
  source: z.literal('subagent_plan').default('subagent_plan'),
}).strict();

export const heavyTaskAdversarialSuiteManifestSchema = z.object({
  root: z.string().trim().min(1).max(MAX_CHECK_TEXT_CHARS),
  planPath: z.string().trim().min(1).max(MAX_CHECK_TEXT_CHARS),
  runnerPath: z.string().trim().min(1).max(MAX_CHECK_TEXT_CHARS),
  rerunCommand: z.string().trim().min(1).max(MAX_CHECK_TEXT_CHARS),
  generatedPaths: z.array(z.string().trim().min(1).max(MAX_CHECK_TEXT_CHARS)).max(MAX_SUITE_PATHS).default([]),
  publicReason: z.string().trim().min(1).max(MAX_REASON_CHARS),
}).strict();

export const heavyTaskAdversarialSuiteExecutionSchema = heavyTaskAdversarialSuiteManifestSchema.pick({
  root: true,
  runnerPath: true,
  rerunCommand: true,
}).strict();

export const heavyTaskAdversarialCheckPlanSubmitSchema = z.object({
  checks: z.array(heavyTaskAdversarialMustRunCheckSchema).min(1).max(MAX_CHECKS),
  suite: heavyTaskAdversarialSuiteManifestSchema,
  publicReason: z.string().trim().min(1).max(MAX_REASON_CHARS),
}).strict();

export const heavyTaskAdversarialCheckExecutionSubmitSchema = z.object({
  planId: z.string().trim().min(1).max(MAX_CHECK_ID_CHARS),
  status: z.enum(['pass', 'fail', 'inconclusive']),
  suite: heavyTaskAdversarialSuiteExecutionSchema,
  publicReason: z.string().trim().min(1).max(MAX_REASON_CHARS),
  commandEvidence: z.array(heavyTaskCommandEvidenceSchema).min(1).max(MAX_CHECKS),
  repairRecommendations: z.array(z.string().trim().min(1).max(MAX_CHECK_TEXT_CHARS)).max(MAX_REPAIR_ITEMS).default([]),
}).strict();

export type HeavyTaskAdversarialCheckPlanSubmitInput = z.infer<typeof heavyTaskAdversarialCheckPlanSubmitSchema>;
export type HeavyTaskAdversarialCheckExecutionSubmitInput = z.infer<typeof heavyTaskAdversarialCheckExecutionSubmitSchema>;

export interface HeavyTaskAdversarialCheckRecorder {
  recordPlan(input: HeavyTaskAdversarialCheckPlanSubmitInput, ctx: MakaToolContext): Promise<{
    accepted: true;
    plan: HeavyTaskAdversarialCheckPlanState;
  }>;
  recordExecution(input: HeavyTaskAdversarialCheckExecutionSubmitInput, ctx: MakaToolContext): Promise<{
    accepted: true;
    execution: HeavyTaskAdversarialCheckExecutionState;
  }>;
}

export function createHeavyTaskAdversarialCheckRecorder(input: {
  taskRunId: string;
  attemptId?: string;
  store: TaskRunStore;
  now: () => number;
  newId: () => string;
}): HeavyTaskAdversarialCheckRecorder {
  return {
    async recordPlan(args, ctx) {
      const ts = input.now();
      const projection = await input.store.project(input.taskRunId);
      if (projection.latestHeavyTaskAdversarialCheckPlan) {
        throw new Error('An adversarial test suite plan is already recorded; rerun the recorded suite and submit adversarial_check_execution_submit only.');
      }
      const validation = validateHeavyTaskPublicStrings(stringsFromPlan(args), ts, 'Accepted as public adversarial check plan.');
      if (!validation.ok) {
        throw new Error(validation.guard.publicReason);
      }
      const plan: HeavyTaskAdversarialCheckPlanState = {
        schemaVersion: 1,
        planId: input.newId(),
        taskRunId: input.taskRunId,
        ...(input.attemptId ? { attemptId: input.attemptId } : {}),
        ts,
        checks: args.checks,
        suite: args.suite,
        publicReason: args.publicReason,
        source: sourceFromContext(ctx),
      };
      await append(input.store, input.taskRunId, {
        type: 'heavy_task_adversarial_check_plan_recorded',
        id: input.newId(),
        taskRunId: input.taskRunId,
        ts,
        plan,
      });
      return { accepted: true, plan };
    },
    async recordExecution(args, ctx) {
      const ts = input.now();
      const projection = await input.store.project(input.taskRunId);
      const plan = projection.latestHeavyTaskAdversarialCheckPlan;
      if (!plan) {
        throw new Error('No adversarial test suite plan is recorded; submit the initial subagent-generated suite plan first.');
      }
      if (args.planId !== plan.planId) {
        throw new Error('Adversarial execution must reference the recorded adversarial suite plan id.');
      }
      if (args.suite.root !== plan.suite.root || args.suite.runnerPath !== plan.suite.runnerPath || args.suite.rerunCommand !== plan.suite.rerunCommand) {
        throw new Error('Adversarial execution must rerun the recorded suite root, runner, and rerun command without replacing the plan.');
      }
      const validation = validateHeavyTaskPublicStrings(
        stringsFromExecution(args),
        ts,
        'Accepted as public adversarial check execution.',
        { allowCategories: ['pytest_assertions'] },
      );
      if (!validation.ok) {
        throw new Error(validation.guard.publicReason);
      }
      const execution: HeavyTaskAdversarialCheckExecutionState = {
        schemaVersion: 1,
        executionId: input.newId(),
        taskRunId: input.taskRunId,
        ...(input.attemptId ? { attemptId: input.attemptId } : {}),
        ts,
        planId: args.planId,
        status: args.status,
        suite: args.suite,
        publicReason: args.publicReason,
        commandEvidence: args.commandEvidence,
        repairRecommendations: args.repairRecommendations,
        source: sourceFromContext(ctx),
      };
      await append(input.store, input.taskRunId, {
        type: 'heavy_task_adversarial_check_execution_recorded',
        id: input.newId(),
        taskRunId: input.taskRunId,
        ts,
        execution,
      });
      return { accepted: true, execution };
    },
  };
}

export function buildHeavyTaskAdversarialCheckTools(recorder: HeavyTaskAdversarialCheckRecorder): MakaTool[] {
  return [
    {
      name: 'adversarial_check_plan_submit',
      description: 'Record the exactly-once adversarial subagent test suite plan, including persisted plan and runner files.',
      parameters: heavyTaskAdversarialCheckPlanSubmitSchema,
      permissionRequired: false,
      impl: async (args, ctx) => recorder.recordPlan(heavyTaskAdversarialCheckPlanSubmitSchema.parse(args), ctx),
    },
    {
      name: 'adversarial_check_execution_submit',
      description: 'Record an adversarial subagent rerun of the persisted test suite and its repair recommendations.',
      parameters: heavyTaskAdversarialCheckExecutionSubmitSchema,
      permissionRequired: false,
      impl: async (args, ctx) => recorder.recordExecution(heavyTaskAdversarialCheckExecutionSubmitSchema.parse(args), ctx),
    },
  ];
}

export function adversarialCheckBlocker(input: {
  plan?: HeavyTaskAdversarialCheckPlanState;
  execution?: HeavyTaskAdversarialCheckExecutionState;
}): string | undefined {
  if (!input.plan) return 'missing adversarial subagent self-check plan';
  if (!input.execution) return 'missing adversarial subagent execution evidence';
  if (input.execution.planId !== input.plan.planId) return 'latest adversarial execution does not reference latest plan';
  if (input.execution.suite.root !== input.plan.suite.root || input.execution.suite.runnerPath !== input.plan.suite.runnerPath || input.execution.suite.rerunCommand !== input.plan.suite.rerunCommand) {
    return 'latest adversarial execution did not rerun the recorded suite';
  }
  if (input.execution.status !== 'pass') return `latest adversarial execution status is ${input.execution.status}`;
  return undefined;
}

export function renderHeavyTaskAdversarialCheckForPrompt(input: {
  latestPlan?: HeavyTaskAdversarialCheckPlanState;
  latestExecution?: HeavyTaskAdversarialCheckExecutionState;
}): string | undefined {
  if (!input.latestPlan && !input.latestExecution) return undefined;
  const lines = ['Prior adversarial self-check state:'];
  if (input.latestPlan) {
    lines.push(`- latest plan id=${input.latestPlan.planId}; checks=${input.latestPlan.checks.length}; reason=${oneLine(input.latestPlan.publicReason)}`);
    lines.push(`- recorded suite: root=${input.latestPlan.suite.root}; runner=${input.latestPlan.suite.runnerPath}; rerun=${input.latestPlan.suite.rerunCommand}`);
    for (const check of input.latestPlan.checks.slice(0, 8)) {
      lines.push(`  - ${check.id}: ${oneLine(check.description)} => ${oneLine(check.expectedOutcome)}`);
    }
  } else {
    lines.push('- latest plan: none');
  }
  if (input.latestExecution) {
    lines.push(`- latest execution id=${input.latestExecution.executionId}; status=${input.latestExecution.status}; planId=${input.latestExecution.planId}; reason=${oneLine(input.latestExecution.publicReason)}`);
    lines.push(`- latest execution suite rerun=${input.latestExecution.suite.rerunCommand}`);
    for (const item of input.latestExecution.repairRecommendations.slice(0, 6)) {
      lines.push(`  - repair: ${oneLine(item)}`);
    }
  } else {
    lines.push('- latest execution: none');
  }
  return lines.join('\n');
}

function stringsFromPlan(input: HeavyTaskAdversarialCheckPlanSubmitInput): string[] {
  return [
    input.publicReason,
    input.suite.root,
    input.suite.planPath,
    input.suite.runnerPath,
    input.suite.rerunCommand,
    input.suite.publicReason,
    ...input.suite.generatedPaths,
    ...input.checks.flatMap((check) => [
      check.id,
      check.description,
      check.command ?? '',
      check.expectedOutcome,
      check.source,
    ]),
  ];
}

function stringsFromExecution(input: HeavyTaskAdversarialCheckExecutionSubmitInput): string[] {
  return [
    input.planId,
    input.status,
    input.suite.root,
    input.suite.runnerPath,
    input.suite.rerunCommand,
    input.publicReason,
    ...input.repairRecommendations,
    ...input.commandEvidence.flatMap((evidence: HeavyTaskCommandEvidence) => [
      evidence.command,
      evidence.outputExcerpt ?? '',
      ...(evidence.artifactRefs ?? []),
    ]),
  ];
}

function sourceFromContext(ctx: MakaToolContext) {
  return {
    kind: 'model_tool' as const,
    toolCallId: ctx.toolCallId,
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
  };
}

async function append(store: TaskRunStore, taskRunId: string, event: TaskEvent): Promise<void> {
  await store.appendEvent(taskRunId, event);
}

function oneLine(value: string, max = 180): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}
