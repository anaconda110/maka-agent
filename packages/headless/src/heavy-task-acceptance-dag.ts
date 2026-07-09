import type { MakaTool, MakaToolContext } from '@maka/runtime';
import { z } from 'zod';
import {
  heavyTaskArtifactEvidenceSchema,
  heavyTaskCommandEvidenceSchema,
  validateHeavyTaskPublicStrings,
  type HeavyTaskPublicSelfCheckValidation,
} from './heavy-task-self-check.js';
import type {
  HeavyTaskAcceptanceDagState,
  HeavyTaskProgressSource,
  HeavyTaskSourceGuardResult,
  TaskEvent,
} from './task-contracts.js';
import type { TaskRunProjection, TaskRunStore } from './task-run-store.js';

export const HEAVY_TASK_ACCEPTANCE_DAG_TOOL_NAMES = ['acceptance_dag_submit'] as const;

const MAX_SUMMARY_CHARS = 2_000;
const MAX_NODE_ID_CHARS = 80;
const MAX_TITLE_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 1_000;
const MAX_CRITERION_CHARS = 500;
const MAX_EVIDENCE_CHARS = 1_000;
const MAX_NODES = 40;
const MAX_DEPS = 20;
const MAX_CRITERIA = 12;
const MAX_EVIDENCE_ITEMS = 10;
const MAX_GUARD_STRING_CHARS = 2_000;

const nodeSelfCheckSchema = z.object({
  status: z.enum(['pass', 'fail', 'inconclusive']),
  publicReason: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
  commandEvidence: z.array(heavyTaskCommandEvidenceSchema).max(MAX_EVIDENCE_ITEMS).optional(),
  artifactEvidence: z.array(heavyTaskArtifactEvidenceSchema).max(MAX_EVIDENCE_ITEMS).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'pass' && (value.commandEvidence?.length ?? 0) + (value.artifactEvidence?.length ?? 0) === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['commandEvidence'],
      message: 'pass node self-checks require at least one commandEvidence or artifactEvidence item',
    });
  }
});

const dagNodeSchema = z.object({
  id: z.string().trim().min(1).max(MAX_NODE_ID_CHARS).regex(/^[A-Za-z0-9_.-]+$/),
  kind: z.enum([
    'requirement',
    'deliverable',
    'implementation',
    'public_check',
    'negative_check',
    'invariance_check',
    'final_audit',
    'other',
  ]),
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  description: z.string().trim().min(1).max(MAX_DESCRIPTION_CHARS),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'cancelled']),
  dependsOn: z.array(z.string().trim().min(1).max(MAX_NODE_ID_CHARS)).max(MAX_DEPS).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(MAX_CRITERION_CHARS)).min(1).max(MAX_CRITERIA),
  required: z.boolean().optional(),
  evidence: z.string().trim().min(1).max(MAX_EVIDENCE_CHARS).optional(),
  selfCheck: nodeSelfCheckSchema.optional(),
}).strict();

export const heavyTaskAcceptanceDagSubmitSchema = z.object({
  summary: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
  nodes: z.array(dagNodeSchema).min(2).max(MAX_NODES),
  publicReason: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const [index, node] of value.nodes.entries()) {
    if (ids.has(node.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index, 'id'], message: `duplicate DAG node id ${node.id}` });
    }
    ids.add(node.id);
  }
  for (const [index, node] of value.nodes.entries()) {
    for (const depId of node.dependsOn ?? []) {
      if (!ids.has(depId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index, 'dependsOn'], message: `unknown dependency ${depId}` });
      }
      if (depId === node.id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index, 'dependsOn'], message: `node ${node.id} cannot depend on itself` });
      }
    }
  }
});

export type HeavyTaskAcceptanceDagSubmitInput = z.infer<typeof heavyTaskAcceptanceDagSubmitSchema>;

export interface HeavyTaskAcceptanceDagRecorder {
  recordAcceptanceDag(
    input: HeavyTaskAcceptanceDagSubmitInput,
    ctx: MakaToolContext,
  ): Promise<
    | { accepted: true; dag: HeavyTaskAcceptanceDagState }
    | { accepted: false; guard: HeavyTaskSourceGuardResult & { status: 'rejected' } }
  >;
  acceptedDagForWorkBlocker(): Promise<string | undefined>;
}

export function createHeavyTaskAcceptanceDagRecorder(input: {
  taskRunId: string;
  attemptId?: string;
  store: TaskRunStore;
  now: () => number;
  newId: () => string;
}): HeavyTaskAcceptanceDagRecorder {
  return {
    async recordAcceptanceDag(args, ctx) {
      const ts = input.now();
      const validation = validateHeavyTaskPublicAcceptanceDag(args, ts);
      if (!validation.ok) {
        return { accepted: false, guard: validation.guard };
      }
      const dag: HeavyTaskAcceptanceDagState = {
        schemaVersion: 1,
        dagId: input.newId(),
        taskRunId: input.taskRunId,
        ...(input.attemptId ? { attemptId: input.attemptId } : {}),
        ts,
        summary: args.summary,
        nodes: args.nodes.map((node) => {
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
        publicReason: args.publicReason,
        guard: validation.guard,
        source: sourceFromContext(ctx),
      };
      await input.store.appendEvent(input.taskRunId, {
        type: 'heavy_task_acceptance_dag_recorded',
        id: input.newId(),
        taskRunId: input.taskRunId,
        ts,
        dag,
      });
      return { accepted: true, dag };
    },
    async acceptedDagForWorkBlocker() {
      const projection = await input.store.project(input.taskRunId);
      return heavyTaskAcceptanceDagWorkStartBlocker(projection.latestHeavyTaskAcceptanceDag);
    },
  };
}

export function buildHeavyTaskAcceptanceDagTools(recorder: HeavyTaskAcceptanceDagRecorder): MakaTool[] {
  return [{
    name: 'acceptance_dag_submit',
    description: 'Submit or update the heavy-task acceptance DAG before implementation and after node-level public self-checks. Each required node should be completed with pass selfCheck evidence before finalization.',
    parameters: heavyTaskAcceptanceDagSubmitSchema,
    permissionRequired: false,
    impl: async (args, ctx) => recorder.recordAcceptanceDag(heavyTaskAcceptanceDagSubmitSchema.parse(args), ctx),
  }];
}

export function validateHeavyTaskPublicAcceptanceDag(
  input: HeavyTaskAcceptanceDagSubmitInput,
  now: number,
): HeavyTaskPublicSelfCheckValidation {
  return validateHeavyTaskPublicStrings(
    stringsFromDag(input),
    now,
    'Accepted as public, task-derived heavy-task acceptance DAG.',
  );
}

export function isAcceptedHeavyTaskAcceptanceDag(
  dag: HeavyTaskAcceptanceDagState,
  now = dag.guard.checkedAt,
): boolean {
  if (dag.guard.status !== 'accepted') return false;
  return validateHeavyTaskPublicAcceptanceDag(dag, now).ok;
}

export function heavyTaskAcceptanceDagBlocker(dag: HeavyTaskAcceptanceDagState | undefined): string | undefined {
  if (!dag) return 'missing accepted heavy-task acceptance DAG';
  if (!isAcceptedHeavyTaskAcceptanceDag(dag)) return 'latest heavy-task acceptance DAG was not accepted as public';
  if (dag.nodes.length < 2) return 'latest heavy-task acceptance DAG is too small';
  const kinds = new Set(dag.nodes.filter((node) => node.required !== false).map((node) => node.kind));
  for (const kind of ['requirement', 'deliverable', 'implementation', 'public_check', 'final_audit'] as const) {
    if (!kinds.has(kind)) return `latest heavy-task acceptance DAG is missing required ${kind} node`;
  }
  const requiredNodes = dag.nodes.filter((node) => node.required !== false);
  const unresolved = requiredNodes.filter((node) => node.status !== 'completed' && node.status !== 'cancelled');
  if (unresolved.length > 0) return `latest heavy-task acceptance DAG has unresolved required nodes: ${unresolved.map((node) => node.id).join(', ')}`;
  const blocked = requiredNodes.filter((node) => node.status === 'blocked');
  if (blocked.length > 0) return `latest heavy-task acceptance DAG has blocked required nodes: ${blocked.map((node) => node.id).join(', ')}`;
  const missingSelfChecks = requiredNodes.filter((node) => node.status === 'completed' && !node.selfCheck);
  if (missingSelfChecks.length > 0) return `latest heavy-task acceptance DAG nodes are missing node self-checks: ${missingSelfChecks.map((node) => node.id).join(', ')}`;
  const nonPassSelfChecks = requiredNodes.filter((node) => node.status === 'completed' && node.selfCheck?.status !== 'pass');
  if (nonPassSelfChecks.length > 0) return `latest heavy-task acceptance DAG nodes have non-pass self-checks: ${nonPassSelfChecks.map((node) => node.id).join(', ')}`;
  const missingEvidence = requiredNodes.filter((node) =>
    node.status === 'completed'
    && node.selfCheck
    && node.selfCheck.commandEvidence.length + node.selfCheck.artifactEvidence.length === 0,
  );
  if (missingEvidence.length > 0) return `latest heavy-task acceptance DAG node self-checks lack concrete evidence: ${missingEvidence.map((node) => node.id).join(', ')}`;
  return undefined;
}

export function heavyTaskAcceptanceDagWorkStartBlocker(dag: HeavyTaskAcceptanceDagState | undefined): string | undefined {
  if (!dag) return 'missing accepted heavy-task acceptance DAG';
  if (!isAcceptedHeavyTaskAcceptanceDag(dag)) return 'latest heavy-task acceptance DAG was not accepted as public';
  if (dag.nodes.length < 2) return 'latest heavy-task acceptance DAG is too small';
  return undefined;
}

export function renderHeavyTaskAcceptanceDagForPrompt(projection: {
  latestHeavyTaskAcceptanceDag?: HeavyTaskAcceptanceDagState;
}): string | undefined {
  const dag = projection.latestHeavyTaskAcceptanceDag;
  if (!dag) return undefined;
  const lines = [
    'Heavy-task acceptance DAG state from prior task-run events:',
    `- Summary: ${oneLine(dag.summary, 240)}`,
    `- Latest DAG status: ${heavyTaskAcceptanceDagBlocker(dag) ? 'incomplete' : 'complete'}`,
  ];
  for (const node of dag.nodes.slice(0, 12)) {
    const checkStatus = node.selfCheck ? node.selfCheck.status : 'missing';
    lines.push(`  - ${node.id} ${node.kind} ${node.status} self_check=${checkStatus}: ${oneLine(node.title, 140)}`);
  }
  lines.push('Use acceptance_dag_submit to refresh this DAG before continuing or finalizing.');
  return lines.join('\n');
}

function stringsFromDag(input: HeavyTaskAcceptanceDagSubmitInput): string[] {
  const strings = [input.summary, input.publicReason];
  for (const node of input.nodes) {
    strings.push(node.id, node.kind, node.title, node.description, node.status, ...(node.dependsOn ?? []), ...node.acceptanceCriteria);
    if (node.evidence) strings.push(node.evidence);
    if (node.selfCheck) {
      strings.push(node.selfCheck.publicReason);
      for (const command of node.selfCheck.commandEvidence ?? []) {
        strings.push(command.command);
        if (command.outputExcerpt) strings.push(command.outputExcerpt);
        strings.push(...(command.artifactRefs ?? []));
      }
      for (const artifact of node.selfCheck.artifactEvidence ?? []) {
        strings.push(artifact.path);
        collectMetadataStrings(artifact.metadata, strings);
      }
    }
  }
  return strings.filter((value) => value.length > 0).map((value) => value.slice(0, MAX_GUARD_STRING_CHARS));
}

function collectMetadataStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 3) return;
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMetadataStrings(item, output, depth + 1);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      output.push(key);
      collectMetadataStrings(item, output, depth + 1);
    }
  }
}

function sourceFromContext(ctx: MakaToolContext): HeavyTaskProgressSource {
  return {
    kind: 'model_tool',
    toolCallId: ctx.toolCallId,
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
  };
}

function oneLine(value: string, maxChars: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars - 3)}...`;
}

export type HeavyTaskAcceptanceDagEvent = Extract<TaskEvent, { type: 'heavy_task_acceptance_dag_recorded' }>;
export type { HeavyTaskAcceptanceDagState };
