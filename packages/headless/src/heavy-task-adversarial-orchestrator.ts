import type { MakaToolContext } from '@maka/runtime';
import { z } from 'zod';
import type { Task } from './contracts.js';
import {
  heavyTaskAdversarialCheckExecutionSubmitSchema,
  heavyTaskAdversarialCheckPlanSubmitSchema,
  type HeavyTaskAdversarialCheckRecorder,
} from './heavy-task-adversarial-check.js';
import { isAcceptedHeavyTaskSelfCheck } from './heavy-task-self-check.js';
import type { TaskRunProjection } from './task-run-store.js';

const JSON_START = 'ADVERSARIAL_CHECK_RESULT_JSON';
const JSON_END = 'END_ADVERSARIAL_CHECK_RESULT_JSON';

const adversarialExecutionResultSchema = heavyTaskAdversarialCheckExecutionSubmitSchema.omit({
  planId: true,
  suite: true,
});

const adversarialInitialResultSchema = z.object({
  plan: heavyTaskAdversarialCheckPlanSubmitSchema,
  execution: adversarialExecutionResultSchema,
}).strict();

const adversarialRerunResultSchema = z.object({
  execution: adversarialExecutionResultSchema,
}).strict();

export interface HeavyTaskAdversarialSelfCheckCheckpointInput {
  task: Task;
  taskRunId: string;
  attemptId: string;
  projection: TaskRunProjection;
  recorder: HeavyTaskAdversarialCheckRecorder;
  cwd: string;
  sessionId: string;
  runId: string;
  turnId: string;
  now: () => number;
  newId: () => string;
  spawnAdversarialChild: (prompt: string, abortSignal: AbortSignal) => Promise<unknown>;
  adversarialChildTimeoutMs?: number;
  runWorkspaceCommand?: (
    command: string,
    options: { timeoutMs: number; abortSignal: AbortSignal },
  ) => Promise<AdversarialWorkspaceCommandResult>;
  getProjection?: () => Promise<TaskRunProjection>;
}

export interface AdversarialWorkspaceCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface HeavyTaskAdversarialSelfCheckCheckpointResult {
  ran: boolean;
  action: 'skip' | 'plan_and_execute' | 'rerun';
  reason: string;
}

export async function runHeavyTaskAdversarialSelfCheckCheckpoint(
  input: HeavyTaskAdversarialSelfCheckCheckpointInput,
): Promise<HeavyTaskAdversarialSelfCheckCheckpointResult> {
  const selfCheck = input.projection.latestHeavyTaskSelfCheck;
  if (!selfCheck) {
    return { ran: false, action: 'skip', reason: 'no model self-check submitted yet' };
  }
  if (!isAcceptedHeavyTaskSelfCheck(selfCheck) || selfCheck.status !== 'pass') {
    return { ran: false, action: 'skip', reason: `latest model self-check is not an accepted pass: ${selfCheck.status}` };
  }

  const checkpointAbort = new AbortController();
  const ctx = runtimeContext(input, checkpointAbort.signal);
  const plan = input.projection.latestHeavyTaskAdversarialCheckPlan;
  if (!plan) {
    let result: unknown;
    try {
      result = await spawnAdversarialChildWithTimeout(input, renderInitialAdversarialPrompt(input));
    } catch (error) {
      const recovered = await recoverInitialAdversarialState(input, ctx, checkpointAbort.signal);
      if (recovered) return recovered;
      throw error;
    }
    const toolRecorded = await recoverInitialAdversarialState(input, ctx, checkpointAbort.signal);
    if (toolRecorded) return toolRecorded;
    let parsed: z.infer<typeof adversarialInitialResultSchema>;
    try {
      parsed = adversarialInitialResultSchema.parse(normalizePayload(parseJsonResult(result)));
    } catch (error) {
      const recovered = await recoverInitialAdversarialState(input, ctx, checkpointAbort.signal);
      if (recovered) return recovered;
      throw error;
    }
    const recordedPlan = await input.recorder.recordPlan(parsed.plan, ctx);
    await input.recorder.recordExecution({
      planId: recordedPlan.plan.planId,
      suite: {
        root: recordedPlan.plan.suite.root,
        runnerPath: recordedPlan.plan.suite.runnerPath,
        rerunCommand: recordedPlan.plan.suite.rerunCommand,
      },
      ...parsed.execution,
    }, ctx);
    return { ran: true, action: 'plan_and_execute', reason: 'runtime adversarial tester generated and executed initial suite' };
  }

  const directRerun = await harvestRerunSuiteResult(input, plan, ctx, checkpointAbort.signal);
  if (directRerun) return {
    ...directRerun,
    reason: 'runtime reran recorded adversarial suite directly',
  };

  let result: unknown;
  try {
    result = await spawnAdversarialChildWithTimeout(input, renderRerunAdversarialPrompt(input, plan));
  } catch (error) {
    const toolRecorded = await rerunToolRecordedResult(input, plan);
    if (toolRecorded) return toolRecorded;
    const harvested = await harvestRerunSuiteResult(input, plan, ctx, checkpointAbort.signal);
    if (harvested) return harvested;
    throw error;
  }
  const toolRecorded = await rerunToolRecordedResult(input, plan);
  if (toolRecorded) return toolRecorded;
  let parsed: z.infer<typeof adversarialRerunResultSchema>;
  try {
    parsed = adversarialRerunResultSchema.parse(normalizePayload(parseJsonResult(result)));
  } catch (error) {
    const harvested = await harvestRerunSuiteResult(input, plan, ctx, checkpointAbort.signal);
    if (harvested) return harvested;
    throw error;
  }
  await input.recorder.recordExecution({
    planId: plan.planId,
    suite: {
      root: plan.suite.root,
      runnerPath: plan.suite.runnerPath,
      rerunCommand: plan.suite.rerunCommand,
    },
    ...parsed.execution,
  }, ctx);
  return { ran: true, action: 'rerun', reason: 'runtime adversarial tester reran recorded suite' };
}

async function recoverInitialAdversarialState(
  input: HeavyTaskAdversarialSelfCheckCheckpointInput,
  ctx: MakaToolContext,
  abortSignal: AbortSignal,
): Promise<HeavyTaskAdversarialSelfCheckCheckpointResult | undefined> {
  const projection = await input.getProjection?.();
  const plan = projection?.latestHeavyTaskAdversarialCheckPlan;
  const execution = projection?.latestHeavyTaskAdversarialCheckExecution;
  if (plan && execution && executionMatchesPlan(execution, plan)) {
    return { ran: true, action: 'plan_and_execute', reason: 'runtime adversarial tester recorded initial suite through tools' };
  }
  if (plan) {
    return recordExecutionForPlan({
      input,
      plan,
      ctx,
      abortSignal,
      action: 'plan_and_execute',
      reason: 'runtime executed recorded adversarial suite after child recorded only the plan',
    });
  }
  return harvestInitialSuiteResult(input, ctx, abortSignal);
}

async function spawnAdversarialChildWithTimeout(
  input: HeavyTaskAdversarialSelfCheckCheckpointInput,
  prompt: string,
): Promise<unknown> {
  const timeoutMs = Math.max(1, input.adversarialChildTimeoutMs ?? 300_000);
  const childAbort = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.spawnAdversarialChild(prompt, childAbort.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          childAbort.abort();
          reject(new Error(`Adversarial child timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function harvestInitialSuiteResult(
  input: HeavyTaskAdversarialSelfCheckCheckpointInput,
  ctx: MakaToolContext,
  abortSignal: AbortSignal,
): Promise<HeavyTaskAdversarialSelfCheckCheckpointResult | undefined> {
  if (!input.runWorkspaceCommand) return undefined;
  const suite = await readGeneratedSuite(input.runWorkspaceCommand, abortSignal);
  if (!suite) return undefined;
  const recordedPlan = await input.recorder.recordPlan(suite.plan, ctx);
  const execution = await runRecordedSuite(input.runWorkspaceCommand, recordedPlan.plan.suite.rerunCommand, abortSignal);
  await input.recorder.recordExecution({
    planId: recordedPlan.plan.planId,
    suite: {
      root: recordedPlan.plan.suite.root,
      runnerPath: recordedPlan.plan.suite.runnerPath,
      rerunCommand: recordedPlan.plan.suite.rerunCommand,
    },
    ...execution,
  }, ctx);
  return {
    ran: true,
    action: 'plan_and_execute',
    reason: 'runtime harvested child-generated adversarial suite and executed runner',
  };
}

async function harvestRerunSuiteResult(
  input: HeavyTaskAdversarialSelfCheckCheckpointInput,
  plan: NonNullable<TaskRunProjection['latestHeavyTaskAdversarialCheckPlan']>,
  ctx: MakaToolContext,
  abortSignal: AbortSignal,
): Promise<HeavyTaskAdversarialSelfCheckCheckpointResult | undefined> {
  if (!input.runWorkspaceCommand) return undefined;
  return recordExecutionForPlan({
    input,
    plan,
    ctx,
    abortSignal,
    action: 'rerun',
    reason: 'runtime executed recorded adversarial suite after child returned unparseable output',
  });
}

async function recordExecutionForPlan(input: {
  input: HeavyTaskAdversarialSelfCheckCheckpointInput;
  plan: NonNullable<TaskRunProjection['latestHeavyTaskAdversarialCheckPlan']>;
  ctx: MakaToolContext;
  abortSignal: AbortSignal;
  action: HeavyTaskAdversarialSelfCheckCheckpointResult['action'];
  reason: string;
}): Promise<HeavyTaskAdversarialSelfCheckCheckpointResult | undefined> {
  if (!input.input.runWorkspaceCommand) return undefined;
  const execution = await runRecordedSuite(input.input.runWorkspaceCommand, input.plan.suite.rerunCommand, input.abortSignal);
  await input.input.recorder.recordExecution({
    planId: input.plan.planId,
    suite: {
      root: input.plan.suite.root,
      runnerPath: input.plan.suite.runnerPath,
      rerunCommand: input.plan.suite.rerunCommand,
    },
    ...execution,
  }, input.ctx);
  return {
    ran: true,
    action: input.action,
    reason: input.reason,
  };
}

async function readGeneratedSuite(
  runWorkspaceCommand: NonNullable<HeavyTaskAdversarialSelfCheckCheckpointInput['runWorkspaceCommand']>,
  abortSignal: AbortSignal,
): Promise<{ plan: z.infer<typeof heavyTaskAdversarialCheckPlanSubmitSchema> } | undefined> {
  const result = await runWorkspaceCommand([
    'set -eu',
    "plan_path=$(find /tmp/maka-adversarial -type f -name plan.json 2>/dev/null | sort | tail -n 1)",
    'test -n "$plan_path"',
    'suite_root=$(dirname "$plan_path")',
    'runner_path="$suite_root/run_tests.sh"',
    'test -f "$runner_path"',
    'printf "__MAKA_SUITE_ROOT__\\n%s\\n" "$suite_root"',
    'printf "__MAKA_PLAN_PATH__\\n%s\\n" "$plan_path"',
    'printf "__MAKA_RUNNER_PATH__\\n%s\\n" "$runner_path"',
    'printf "__MAKA_GENERATED_PATHS__\\n"',
    'find "$suite_root" -maxdepth 2 -type f | sort | sed -n "1,40p"',
    'printf "__MAKA_PLAN_JSON__\\n"',
    'cat "$plan_path"',
  ].join('\n'), { timeoutMs: 120_000, abortSignal });
  if (result.exitCode !== 0) return undefined;
  return parseGeneratedSuite(result.stdout);
}

async function runRecordedSuite(
  runWorkspaceCommand: NonNullable<HeavyTaskAdversarialSelfCheckCheckpointInput['runWorkspaceCommand']>,
  command: string,
  abortSignal: AbortSignal,
): Promise<z.infer<typeof adversarialExecutionResultSchema>> {
  const result = await runWorkspaceCommand(command, { timeoutMs: 600_000, abortSignal });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const excerpt = oneLine(output, 1800);
  return {
    status: result.exitCode === 0 ? 'pass' : 'fail',
    publicReason: result.exitCode === 0
      ? 'Runtime executed the recorded adversarial suite runner successfully.'
      : `Runtime executed the recorded adversarial suite runner and it failed with exit code ${result.exitCode ?? 'unknown'}.`,
    commandEvidence: [{
      command,
      exitCode: result.exitCode,
      outputExcerpt: excerpt,
      artifactRefs: [],
    }],
    repairRecommendations: result.exitCode === 0
      ? []
      : ['Repair the deliverable so the recorded adversarial suite runner exits successfully, then submit a new model self-check.'],
  };
}

function parseGeneratedSuite(stdout: string): { plan: z.infer<typeof heavyTaskAdversarialCheckPlanSubmitSchema> } | undefined {
  const root = markerBody(stdout, '__MAKA_SUITE_ROOT__', '__MAKA_PLAN_PATH__')?.trim();
  const planPath = markerBody(stdout, '__MAKA_PLAN_PATH__', '__MAKA_RUNNER_PATH__')?.trim();
  const runnerPath = markerBody(stdout, '__MAKA_RUNNER_PATH__', '__MAKA_GENERATED_PATHS__')?.trim();
  const generatedPaths = markerBody(stdout, '__MAKA_GENERATED_PATHS__', '__MAKA_PLAN_JSON__')
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40) ?? [];
  const jsonText = stdout.slice(stdout.indexOf('__MAKA_PLAN_JSON__') + '__MAKA_PLAN_JSON__'.length).trim();
  if (!root || !planPath || !runnerPath || !jsonText || !root.startsWith('/tmp/maka-adversarial/')) return undefined;
  const parsed = JSON.parse(jsonText);
  const sourcePlan = isRecord(parsed.plan) ? parsed.plan : parsed;
  const suite = isRecord(sourcePlan.suite) ? sourcePlan.suite : {};
  const checks = checksFromGeneratedPlan(sourcePlan);
  if (checks.length === 0) {
    checks.push({
      id: 'generated-suite-runner',
      description: 'Run the child-generated adversarial suite runner.',
      command: `cd ${root} && bash run_tests.sh`,
      expectedOutcome: 'runner exits 0',
      source: 'subagent_plan',
    });
  }
  return {
    plan: heavyTaskAdversarialCheckPlanSubmitSchema.parse({
      checks,
      suite: {
        root: boundedString(typeof suite.root === 'string' ? suite.root : root),
        planPath: boundedString(typeof suite.planPath === 'string' ? suite.planPath : planPath),
        runnerPath: boundedString(typeof suite.runnerPath === 'string' ? suite.runnerPath : runnerPath),
        rerunCommand: boundedString(typeof suite.rerunCommand === 'string' ? suite.rerunCommand : `cd ${root} && bash run_tests.sh`),
        generatedPaths: generatedPaths.map((path) => boundedString(path)),
        publicReason: boundedString(typeof suite.publicReason === 'string'
          ? suite.publicReason
          : 'Child-generated adversarial suite files discovered under /tmp/maka-adversarial.'),
      },
      publicReason: boundedString(typeof sourcePlan.publicReason === 'string'
        ? sourcePlan.publicReason
        : 'Runtime harvested a child-generated adversarial suite derived from the public task and latest model self-check.'),
    }),
  };
}

function markerBody(text: string, startMarker: string, endMarker: string): string | undefined {
  const start = text.indexOf(startMarker);
  if (start < 0) return undefined;
  const bodyStart = start + startMarker.length;
  const end = text.indexOf(endMarker, bodyStart);
  if (end < 0) return undefined;
  return text.slice(bodyStart, end);
}

function checksFromGeneratedPlan(sourcePlan: Record<string, unknown>): z.infer<typeof heavyTaskAdversarialCheckPlanSubmitSchema>['checks'] {
  if (!Array.isArray(sourcePlan.checks)) return [];
  return sourcePlan.checks.slice(0, 20).flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const description = typeof item.description === 'string' ? item.description : undefined;
    const expectedOutcome = typeof item.expectedOutcome === 'string' ? item.expectedOutcome : undefined;
    if (!description || !expectedOutcome) return [];
    const id = typeof item.id === 'string' && item.id.trim() ? item.id : `generated-check-${index + 1}`;
    const command = typeof item.command === 'string' && item.command.trim() && item.command.length <= 1000
      ? { command: item.command.trim() }
      : {};
    return [{
      id: boundedString(id, 80),
      description: boundedString(description),
      ...command,
      expectedOutcome: boundedString(expectedOutcome),
      source: 'subagent_plan' as const,
    }];
  });
}

function boundedString(value: string, max = 1000): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function renderInitialAdversarialPrompt(input: HeavyTaskAdversarialSelfCheckCheckpointInput): string {
  return [
    'You are the runtime-controlled adversarial tester in a heavy-task self-check loop.',
    'Your role is to test the current deliverable, not to implement or repair it.',
    'Use only public task/workspace evidence. Do not inspect hidden, evaluator, official verifier, scorer-only, or private material.',
    '',
    `Task id: ${input.task.id}`,
    `Workspace cwd: ${input.cwd}`,
    '',
    'Public task instruction:',
    input.task.instruction,
    '',
    'Latest model self-check evidence:',
    summarizeSelfCheck(input.projection),
    '',
    'Create one public adversarial test suite under a persistent scratch root such as /tmp/maka-adversarial/<task-or-suite-id>.',
    'Materialize a plan file and runnable test runner, execute that runner yourself, and report pass/fail evidence.',
    'If the tools adversarial_check_plan_submit and adversarial_check_execution_submit are available, you MUST call adversarial_check_plan_submit after materializing the suite and then call adversarial_check_execution_submit after running it. Use the returned planId for execution.',
    'Include positive, negative/invariance, boundary, combination, and naive-implementation-catching checks. If the public task says preserve, exact, unchanged, no-change, or equivalent, include full-document invariance fixtures with equality or documented normalization oracles.',
    'Return at most 20 representative checks in JSON; the suite files may contain more cases.',
    '',
    `Return exactly this machine-readable block and no other JSON:\n${JSON_START}`,
    JSON.stringify({
      plan: {
        checks: [{
          id: 'check-1',
          description: 'public adversarial check description',
          command: 'public command if applicable',
          expectedOutcome: 'expected public outcome',
          source: 'subagent_plan',
        }],
        suite: {
          root: '/tmp/maka-adversarial/example',
          planPath: '/tmp/maka-adversarial/example/plan.json',
          runnerPath: '/tmp/maka-adversarial/example/run_tests.sh',
          rerunCommand: 'cd /tmp/maka-adversarial/example && bash run_tests.sh',
          generatedPaths: ['/tmp/maka-adversarial/example/plan.json', '/tmp/maka-adversarial/example/run_tests.sh'],
          publicReason: 'why this suite is derived from public task requirements',
        },
        publicReason: 'why this adversarial plan covers the public task contract',
      },
      execution: {
        status: 'pass',
        publicReason: 'summary of runner result',
        commandEvidence: [{
          command: 'cd /tmp/maka-adversarial/example && bash run_tests.sh',
          exitCode: 0,
          outputExcerpt: 'public output excerpt',
          artifactRefs: ['/tmp/maka-adversarial/example/run_tests.sh'],
        }],
        repairRecommendations: [],
      },
    }, null, 2),
    JSON_END,
  ].join('\n');
}

function renderRerunAdversarialPrompt(
  input: HeavyTaskAdversarialSelfCheckCheckpointInput,
  plan: NonNullable<TaskRunProjection['latestHeavyTaskAdversarialCheckPlan']>,
): string {
  return [
    'You are the runtime-controlled adversarial tester in a heavy-task self-check loop.',
    'A suite already exists. Do not generate a new plan, do not rewrite fixtures or runner files, and do not repair the deliverable.',
    'Use only public task/workspace evidence. Do not inspect hidden, evaluator, official verifier, scorer-only, or private material.',
    '',
    `Task id: ${input.task.id}`,
    `Workspace cwd: ${input.cwd}`,
    `Recorded suite root: ${plan.suite.root}`,
    `Recorded runner: ${plan.suite.runnerPath}`,
    `Exact rerun command: ${plan.suite.rerunCommand}`,
    '',
    'Latest model self-check evidence after repair:',
    summarizeSelfCheck(input.projection),
    '',
    'Run exactly the recorded rerun command. Return pass/fail evidence and repair recommendations if it fails or is inconclusive.',
    'If adversarial_check_execution_submit is available, you MUST call it after running the recorded suite.',
    '',
    `Return exactly this machine-readable block and no other JSON:\n${JSON_START}`,
    JSON.stringify({
      execution: {
        status: 'pass',
        publicReason: 'summary of recorded suite rerun result',
        commandEvidence: [{
          command: plan.suite.rerunCommand,
          exitCode: 0,
          outputExcerpt: 'public output excerpt',
          artifactRefs: [plan.suite.runnerPath],
        }],
        repairRecommendations: [],
      },
    }, null, 2),
    JSON_END,
  ].join('\n');
}

async function initialToolRecordedResult(
  input: HeavyTaskAdversarialSelfCheckCheckpointInput,
): Promise<HeavyTaskAdversarialSelfCheckCheckpointResult | undefined> {
  const projection = await input.getProjection?.();
  const plan = projection?.latestHeavyTaskAdversarialCheckPlan;
  const execution = projection?.latestHeavyTaskAdversarialCheckExecution;
  if (!plan || !execution || !executionMatchesPlan(execution, plan)) return undefined;
  return { ran: true, action: 'plan_and_execute', reason: 'runtime adversarial tester recorded initial suite through tools' };
}

async function rerunToolRecordedResult(
  input: HeavyTaskAdversarialSelfCheckCheckpointInput,
  plan: NonNullable<TaskRunProjection['latestHeavyTaskAdversarialCheckPlan']>,
): Promise<HeavyTaskAdversarialSelfCheckCheckpointResult | undefined> {
  const previousExecutionId = input.projection.latestHeavyTaskAdversarialCheckExecution?.executionId;
  const execution = (await input.getProjection?.())?.latestHeavyTaskAdversarialCheckExecution;
  if (!execution || execution.executionId === previousExecutionId) return undefined;
  if (!executionMatchesPlan(execution, plan)) return undefined;
  return { ran: true, action: 'rerun', reason: 'runtime adversarial tester recorded suite rerun through tools' };
}

function executionMatchesPlan(
  execution: NonNullable<TaskRunProjection['latestHeavyTaskAdversarialCheckExecution']>,
  plan: NonNullable<TaskRunProjection['latestHeavyTaskAdversarialCheckPlan']>,
): boolean {
  return execution.planId === plan.planId &&
    execution.suite.root === plan.suite.root &&
    execution.suite.runnerPath === plan.suite.runnerPath &&
    execution.suite.rerunCommand === plan.suite.rerunCommand;
}

function summarizeSelfCheck(projection: TaskRunProjection): string {
  const selfCheck = projection.latestHeavyTaskSelfCheck;
  if (!selfCheck) return 'No model self-check is recorded.';
  const commands = selfCheck.commandEvidence.slice(0, 8).map((evidence) =>
    `- ${oneLine(evidence.command, 180)} exit=${evidence.exitCode ?? 'unknown'} output=${oneLine(evidence.outputExcerpt ?? '', 220)}`);
  const artifacts = selfCheck.artifactEvidence.slice(0, 8).map((evidence) =>
    `- ${evidence.path} kind=${evidence.kind} exists=${evidence.exists ?? 'unknown'}`);
  return [
    `selfCheckId=${selfCheck.selfCheckId} status=${selfCheck.status}`,
    `reason=${oneLine(selfCheck.publicReason, 360)}`,
    ...commands,
    ...artifacts,
  ].join('\n');
}

function parseJsonResult(result: unknown): unknown {
  const text = childSummary(result);
  const markerStart = text.indexOf(JSON_START);
  if (markerStart >= 0) {
    const bodyStart = markerStart + JSON_START.length;
    const markerEnd = text.indexOf(JSON_END, bodyStart);
    const body = markerEnd >= 0 ? text.slice(bodyStart, markerEnd) : text.slice(bodyStart);
    return JSON.parse(body.trim());
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) return JSON.parse(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
  throw new Error('Adversarial tester did not return a parseable JSON result block.');
}

function normalizePayload(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const plan = isRecord(value.plan) ? { ...value.plan } : undefined;
  const execution = isRecord(value.execution) ? { ...value.execution } : undefined;
  if (plan && Array.isArray(plan.checks) && plan.checks.length > 20) {
    plan.checks = plan.checks.slice(0, 20);
  }
  if (execution && Array.isArray(execution.commandEvidence) && execution.commandEvidence.length > 20) {
    execution.commandEvidence = execution.commandEvidence.slice(0, 20);
  }
  return {
    ...value,
    ...(plan ? { plan } : {}),
    ...(execution ? { execution } : {}),
  };
}

function childSummary(result: unknown): string {
  if (typeof result === 'string') return result;
  if (isRecord(result) && typeof result.summary === 'string') return result.summary;
  return JSON.stringify(result);
}

function runtimeContext(
  input: HeavyTaskAdversarialSelfCheckCheckpointInput,
  abortSignal: AbortSignal,
): MakaToolContext {
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    turnId: input.turnId,
    cwd: input.cwd,
    toolCallId: `runtime_adversarial_check:${input.newId()}`,
    abortSignal,
    emitOutput: () => {},
  };
}

function oneLine(value: string, limit: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
