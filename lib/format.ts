import { formatCountdown } from "./quota-time";

export { isFresh } from "./quota-time";

const english = {
  title: "Subscription", unavailable: "Quota unavailable", loading: "Loading quota…",
  remaining: "left", used: "used",
  manualResets: "Available resets", resets: "Resets", noExpiry: "No expiry", unknownExpiry: "Expiry unavailable", noResets: "No resets left", stale: "outdated", resetsIn: "Resets in", waiting: "Waiting for quota update",
  fiveHour: "5 hours", daily: "Daily", weekly: "Weekly", day: "d", hour: "h", minute: "m",
};

const en = quotaFormat("en-US", english);
const ru = quotaFormat("ru-RU", {
  title: "Подписка", unavailable: "Лимиты недоступны", loading: "Получаем лимиты…",
  remaining: "осталось", used: "использовано",
  manualResets: "Доступно сбросов", resets: "Сбросы", noExpiry: "Бессрочно", unknownExpiry: "Срок неизвестен", noResets: "Сбросов нет", stale: "устарело", resetsIn: "До сброса", waiting: "Ожидаем обновления лимитов",
  fiveHour: "5 часов", daily: "Сутки", weekly: "Неделя", day: "д", hour: "ч", minute: "мин",
});

/** Local calendar days from one date to another, independent of the time of day and DST. */
function calendarDays(from: Date, to: Date) {
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return Math.round((day(to) - day(from)) / 86_400_000);
}

function quotaFormat(locale: string, text: typeof english) {
  // Russian uses a 24-hour clock with a leading zero; English keeps "2:23 AM".
  const hour = locale === "ru-RU" ? "2-digit" : "numeric";
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour, minute: "2-digit" });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", hour, minute: "2-digit" });
  const clock = new Intl.DateTimeFormat(locale, { hour, minute: "2-digit" });
  const full = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" });
  const monthDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return {
    text,
    formatExpiry(seconds: number) {
      const when = new Date(seconds * 1000);
      return { date: (when.getFullYear() === new Date().getFullYear() ? monthDay : fullDate).format(when), time: clock.format(when) };
    },
    percent: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    formatDate: (value: string) => date.format(new Date(value)),
    /** As short as stays unambiguous: today the time, the next six days the weekday, otherwise
     * (including any earlier day) the date. */
    formatReset(value: string, now: number) {
      const when = new Date(value);
      const days = calendarDays(new Date(now), when);
      if (days === 0) return clock.format(when);
      return (days > 0 && days < 7 ? weekday : date).format(when);
    },
    formatFullDate: (value: string) => full.format(new Date(value)),
    formatCountdown: (milliseconds: number) => formatCountdown(milliseconds, text),
  };
}

export function getQuotaFormat(language: unknown, providerLabel?: string) {
  const base = language === "ru" ? ru : en;
  if (!providerLabel) return base;
  const title = language === "ru" ? `${base.text.title} ${providerLabel}` : `${providerLabel} subscription`;
  return { ...base, text: { ...base.text, title } };
}
