const STALE_AFTER_MS = 90 * 60 * 1000;

const english = {
  title: "Codex subscription", unavailable: "Quota unavailable", loading: "Loading quota…",
  remaining: "left", used: "used",
  manualResets: "Available resets", resets: "Resets", noExpiry: "No expiry", unknownExpiry: "Expiry unavailable", noResets: "No resets left", stale: "outdated", resetsIn: "Resets in", waiting: "Waiting for quota update",
  fiveHour: "5 hours", daily: "Daily", weekly: "Weekly", day: "d", hour: "h", minute: "m",
};

const en = quotaFormat("en-US", english);
const ru = quotaFormat("ru-RU", {
  title: "Подписка Codex", unavailable: "Лимиты недоступны", loading: "Получаем лимиты…",
  remaining: "осталось", used: "использовано",
  manualResets: "Доступно сбросов", resets: "Сбросы", noExpiry: "Бессрочно", unknownExpiry: "Срок неизвестен", noResets: "Сбросов нет", stale: "устарело", resetsIn: "До сброса", waiting: "Ожидаем обновления квоты",
  fiveHour: "5 часов", daily: "Сутки", weekly: "Неделя", day: "д", hour: "ч", minute: "мин",
});

function quotaFormat(locale: string, text: typeof english) {
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const monthDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  return {
    text,
    formatExpiry(seconds: number) {
      const when = new Date(seconds * 1000);
      return { date: (when.getFullYear() === new Date().getFullYear() ? monthDay : fullDate).format(when), time: time.format(when) };
    },
    percent: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    formatDate: (value: string) => date.format(new Date(value)),
    formatCountdown(milliseconds: number): string {
      const days = Math.floor(milliseconds / 86_400_000);
      if (days > 0) {
        const hours = Math.floor(milliseconds / 3_600_000) % 24;
        return hours ? `${days}\u00a0${text.day} ${hours}\u00a0${text.hour}` : `${days}\u00a0${text.day}`;
      }
      const minutes = Math.ceil(Math.max(0, milliseconds) / 60_000);
      const hours = Math.floor(minutes / 60);
      return [hours ? `${hours}\u00a0${text.hour}` : "", `${minutes % 60}\u00a0${text.minute}`].filter(Boolean).join(" ");
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
