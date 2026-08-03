export function newSessionTitle(now: number = Date.now()): string {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `会话 ${y}-${m}-${d} ${hh}:${mm}`;
}