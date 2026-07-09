import {
  filterModelVisibleTaskLedgerTasks,
  renderSafeTaskLedgerText,
  type Task,
} from '@maka/core/task-ledger';

export const HEAVY_TASK_LEDGER_REPLAY_MAX_CHARS = 4_000;
export const HEAVY_TASK_LEDGER_TOOL_NAMES = [
  'task_create',
  'task_update',
  'task_list',
  'task_get',
] as const;

const GUIDANCE_LINES = [
  'Heavy-task ledger guidance:',
  '<task-ledger-guidance>',
  '- Use task_create/task_update/task_list/task_get to maintain a durable high-level work ledger for this autonomous task run.',
  '- Keep the ledger focused on durable work items and status/evidence; continue using inventory_submit, todo_update, and self_check_* for heavy-task execution discipline.',
  '- Mark a task in_progress when work starts, completed with concise evidence when verified, blocked with the missing dependency, or failed with the reason.',
  '</task-ledger-guidance>',
];

export function renderHeavyTaskLedgerReplay(
  tasks: readonly Task[],
  options: { maxChars?: number } = {},
): string {
  const selected = filterModelVisibleTaskLedgerTasks([...tasks]);
  const lines = [...GUIDANCE_LINES];
  if (selected.length > 0) {
    lines.push(
      'Current durable heavy-task ledger:',
      '<task-ledger>',
      renderSafeTaskLedgerText(selected),
      '</task-ledger>',
    );
  }
  return capLines(lines, options.maxChars ?? HEAVY_TASK_LEDGER_REPLAY_MAX_CHARS);
}

function capLines(lines: string[], maxChars: number): string {
  const kept: string[] = [];
  let total = 0;
  for (const line of lines) {
    const cost = line.length + (kept.length === 0 ? 0 : 1);
    if (kept.length > 0 && total + cost > maxChars) {
      kept.push(`... omitted to stay within ${maxChars} chars`);
      break;
    }
    kept.push(line);
    total += cost;
  }
  return kept.join('\n').slice(0, maxChars);
}
