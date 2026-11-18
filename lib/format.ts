const STALE_AFTER_MS = 90 * 60 * 1000;

const english = {
  title: "Codex subscription", unavailable: "Quota unavailable", loading: "Loading quota…",
  refresh: "Refresh", refreshing: "Refreshing…", remaining: "left", used: "used",
  stale: "outdated", reset: "Resets at", waiting: "Waiting for quota update",
  fiveHour: "5 hours", daily: "Daily", weekly: "Weekly", day: "d", hour: "h", minute: "m",
};

const en = quotaFormat("en-US", english);
const ru = quotaFormat("ru-RU", {
  title: "Подписка Codex", unavailable: "Лимиты недоступны", loading: "Получаем лимиты…",
  refresh: "Обновить", refreshing: "Обновляем…", remaining: "осталось", used: "использовано",
  stale: "устарело", reset: "Сброс", waiting: "Ожидаем обновления квоты",
  fiveHour: "5 часов", daily: "Сутки", weekly: "Неделя", day: "д", hour: "ч", minute: "мин",
});

function quotaFormat(locale: string, text: typeof english) {
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return {
    text,
    percent: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    formatDate: (value: string) => date.format(new Date(value)),
    formatCountdown(milliseconds: number): string {
      const minutes = Math.ceil(Math.max(0, milliseconds) / 60_000);
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      const rest = minutes % 60;
      return [days ? `${days} ${text.day}` : "", days || hours ? `${hours} ${text.hour}` : "", `${rest} ${text.minute}`].filter(Boolean).join(" ");
    },
  };
}

export function getQuotaFormat(language: unknown) {
  return language === "ru" ? ru : en;
}

export function isFresh(observedAt: number | null, now: number): boolean {
  if (observedAt === null) return false;
  const age = now - observedAt;
  return Number.isFinite(age) && age >= -60_000 && age < STALE_AFTER_MS;
}
