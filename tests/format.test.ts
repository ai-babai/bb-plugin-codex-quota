import { expect, it } from "vitest";
import { getQuotaFormat, isFresh } from "../lib/format";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

function samples(limit: number) {
  let state = 0x51a9f7;
  return Array.from({ length: 128 }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % limit;
  });
}

it("accepts only observations from the last 90 minutes with up to a minute of clock skew", () => {
  const now = 1_795_000_000_000;
  const maxAge = 90 * minute;
  const ages = [-minute - 1, -minute, -minute + 1, 0, maxAge - 1, maxAge, maxAge + 1,
    ...samples(120 * minute).map(age => age - 2 * minute)];
  for (const age of ages) {
    const observedAt = now - age;
    const expected = observedAt > now - maxAge && observedAt <= now + minute;
    expect(isFresh(observedAt, now), `age ${age}`).toBe(expected);
    expect(isFresh(observedAt + hour, now + hour), `shifted age ${age}`).toBe(expected);
  }
  for (const invalid of [null, NaN, Infinity, -Infinity]) expect(isFresh(invalid, now)).toBe(false);
  expect(isFresh(now, NaN)).toBe(false);
  expect(isFresh(null, 0)).toBe(false);
  expect(isFresh(0, 0)).toBe(true);
});

it.each([
  { language: "en", dayUnit: "d", hourUnit: "h", minuteUnit: "m", decimal: /^\d+(?:\.\d)?$/ },
  { language: "ru", dayUnit: "д", hourUnit: "ч", minuteUnit: "мин", decimal: /^\d+(?:,\d)?$/ },
])("rounds countdowns and quota percentages in $language", ({ language, dayUnit, hourUnit, minuteUnit, decimal }) => {
  const { formatCountdown, percent } = getQuotaFormat(language);
  const pattern = new RegExp(`^(?:(\\d+) ${dayUnit}(?: (\\d+) ${hourUnit})?|(?:(\\d+) ${hourUnit} )?(\\d+) ${minuteUnit})$`);
  const durations = [0, minute, hour, day, 2 * day + hour]
    .flatMap(boundary => [boundary - 1, boundary, boundary + 1])
    .concat(samples(day), samples(14 * day))
    .sort((a, b) => a - b);
  let previous = 0;
  for (const duration of durations) {
    const rendered = formatCountdown(duration).replace(/\s+/g, " ");
    const match = pattern.exec(rendered);
    if (!match) throw new Error(`Unexpected ${language} countdown at ${duration} ms: ${rendered}`);
    const [, days = "0", hoursAlongsideDays = "0", hours = "0", minutes = "0"] = match;
    const shown = 1_440 * Number(days) + 60 * (Number(hoursAlongsideDays) + Number(hours)) + Number(minutes);
    const expected = duration >= day
      ? Number(BigInt(duration) / BigInt(hour)) * 60
      : Number((BigInt(Math.max(0, duration)) + BigInt(minute - 1)) / BigInt(minute));
    expect(shown, `duration ${duration}`).toBe(expected);
    expect(shown).toBeGreaterThanOrEqual(previous);
    previous = shown;
  }

  for (const thousandths of [0, 49, 50, 51, 99_949, 99_950, 100_000, ...samples(100_001)]) {
    const rendered = percent.format(thousandths / 1_000);
    expect(rendered).toMatch(decimal);
    expect(Number(rendered.replace(",", "."))).toBe(Math.trunc((thousandths + 50) / 100) / 10);
  }
});

it.each(["en", "ru"])("names a reset by time today, weekday this week and date otherwise in %s", language => {
  const locale = language === "ru" ? "ru-RU" : "en-US";
  const hour = language === "ru" ? "2-digit" : "numeric";
  const shapes = {
    time: new Intl.DateTimeFormat(locale, { hour, minute: "2-digit" }),
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", hour, minute: "2-digit" }),
    date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour, minute: "2-digit" }),
  };
  const { formatReset, formatFullDate } = getQuotaFormat(language);
  const now = new Date(2026, 10, 20, 12, 30).getTime();
  const at = (days: number, hours: number, minutes = 0) => new Date(2026, 10, 20 + days, hours, minutes);
  const cases: [Date, keyof typeof shapes][] = [
    [at(-7, 12, 30), "date"], [at(-7, 13), "date"], [at(-1, 23, 59), "date"], [at(-30, 9), "date"],
    [at(0, 0), "time"], [at(0, 12, 29), "time"], [at(0, 23, 59), "time"],
    [at(1, 0), "weekday"], [at(6, 23, 59), "weekday"], [at(7, 0), "date"], [at(40, 9), "date"],
  ];
  for (const [when, shape] of cases) {
    expect(formatReset(when.toISOString(), now), `${when.toString()}`).toBe(shapes[shape].format(when));
  }
  expect(formatFullDate(at(-7, 13).toISOString())).toContain("2026");
});
