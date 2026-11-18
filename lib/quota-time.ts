const STALE_AFTER_MS = 90 * 60 * 1000;

export function formatCountdown(milliseconds: number, text: { day: string; hour: string; minute: string }): string {
  const days = Math.floor(milliseconds / 86_400_000);
  if (days > 0) {
    const hours = Math.floor(milliseconds / 3_600_000) % 24;
    return hours ? `${days}\u00a0${text.day} ${hours}\u00a0${text.hour}` : `${days}\u00a0${text.day}`;
  }
  const minutes = Math.ceil(Math.max(0, milliseconds) / 60_000);
  const hours = Math.floor(minutes / 60);
  return [hours ? `${hours}\u00a0${text.hour}` : "", `${minutes % 60}\u00a0${text.minute}`].filter(Boolean).join(" ");
}

export function isFresh(observedAt: number | null, now: number): boolean {
  if (observedAt === null) return false;
  const age = now - observedAt;
  return Number.isFinite(age) && age >= -60_000 && age < STALE_AFTER_MS;
}
