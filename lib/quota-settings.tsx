import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { experimental_Icon as Icon, experimental_usePluginId, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { usePinQuotaPopover } from "./quota-popover";

export interface QuotaSettingsValues {
  refreshIntervalSeconds: number;
  showInChat: boolean;
  showInSidebar: boolean;
}

const maxIntervalSeconds = Math.floor(2_147_483_647 / 1000);
const copy = {
  en: {
    settings: "Settings", back: "Back", interval: "Refresh interval, seconds", off: "0 disables auto-refresh",
    chat: "Show in chat", sidebar: "Show in left sidebar", save: "Save",
    saving: "Saving…", saved: "Saved", failed: "Could not save. Try again.", unavailable: "Settings unavailable",
    invalid: `Enter a whole number from 0 to ${maxIntervalSeconds}.`,
    restore: "Restore either ring in BB Settings → Installed plugins → Codex Quota.",
  },
  ru: {
    settings: "Настройки", back: "Назад", interval: "Интервал обновления, сек.", off: "0 отключает автообновление",
    chat: "Показывать в чате", sidebar: "В левой панели", save: "Сохранить",
    saving: "Сохранение…", saved: "Сохранено", failed: "Не удалось сохранить. Попробуйте ещё раз.", unavailable: "Настройки недоступны",
    invalid: `Введите целое число от 0 до ${maxIntervalSeconds}.`,
    restore: "Вернуть индикатор: настройки BB → Установленные плагины → Codex Quota.",
  },
};

function readSettings(values: Record<string, unknown>): QuotaSettingsValues {
  return {
    refreshIntervalSeconds: typeof values.refreshIntervalSeconds === "number" ? values.refreshIntervalSeconds : 120,
    showInChat: values.showInChat !== false,
    showInSidebar: values.showInSidebar !== false,
  };
}

const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const buttonClass = `inline-flex min-h-9 items-center justify-center gap-1 rounded px-2 hover:bg-state-hover ${focusClass}`;
const turnStyles = `
@keyframes codex-quota-turn { from { opacity: .5; transform: perspective(500px) rotateY(-12deg); } to { opacity: 1; transform: perspective(500px) rotateY(0); } }
[data-codex-quota-side] { animation: codex-quota-turn 140ms ease-out; }
@media (prefers-reduced-motion: reduce) { [data-codex-quota-side] { animation: none; } }
`;

/** Place inside QuotaPopover. Render the supplied gear in the front's header. */
export function QuotaSettingsCard({ children }: { children: (settingsButton: ReactNode) => ReactNode }) {
  const { values } = useSettings();
  const pin = usePinQuotaPopover();
  const [settingsSide, setSettingsSide] = useState(false);
  const switched = useRef(false);
  const gear = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const text = copy[values?.language === "ru" ? "ru" : "en"];

  useLayoutEffect(() => {
    if (switched.current) (settingsSide ? back : gear).current?.focus();
  }, [settingsSide]);

  function turn(settings: boolean) {
    if (settings) pin();
    switched.current = true;
    setSettingsSide(settings);
  }

  const settingsButton = <button ref={gear} type="button" aria-label={text.settings} title={text.settings}
    className={`-my-2 min-w-9 shrink-0 ${buttonClass}`} onClick={() => turn(true)}>
    <Icon name="Settings" aria-hidden="true" className="size-3.5" />
  </button>;

  return <>
    <style>{turnStyles}</style>
    <div key={String(settingsSide)} data-codex-quota-side={settingsSide ? "settings" : "quota"} className="grid gap-2"
      lang={values?.language === "ru" ? "ru" : "en"}>
      {settingsSide ? <>
        <div className="flex items-center gap-2">
          <button ref={back} type="button" className={`-my-2 -ml-1 ${buttonClass}`} onClick={() => turn(false)}>
            <Icon name="ChevronLeft" aria-hidden="true" className="size-3.5" />{text.back}
          </button>
          <h3 className="ml-auto font-medium">{text.settings}</h3>
        </div>
        {values ? <QuotaSettingsForm initial={readSettings(values)} language={values.language} /> : <p role="status">{text.unavailable}</p>}
      </> : children(settingsButton)}
    </div>
  </>;
}

function QuotaSettingsForm({ initial, language }: { initial: QuotaSettingsValues; language: unknown }) {
  const sdk = useSdk();
  const pluginId = experimental_usePluginId();
  const id = useId();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [interval, setInterval] = useState(String(initial.refreshIntervalSeconds));
  const [invalid, setInvalid] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const pending = useRef(false);
  const locale = language === "ru" ? "ru" : "en";
  const text = copy[locale];

  function edit(patch: Partial<QuotaSettingsValues>) {
    setDraft(current => ({ ...current, ...patch }));
    setStatus("idle");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const seconds = Number(interval);
    if (!/^\d+$/.test(interval.trim()) || !Number.isSafeInteger(seconds) || seconds > maxIntervalSeconds) {
      setInvalid(true);
      event.currentTarget.querySelector("input")?.focus();
      return;
    }
    const next = { ...draft, refreshIntervalSeconds: seconds };
    // Patch only edited fields so a concurrent settings-page save keeps unrelated values.
    const values = Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== baseline[key as keyof QuotaSettingsValues]));
    if (!Object.keys(values).length) return;
    pending.current = true;
    setStatus("saving");
    try {
      // Public SDK persists BB config and propagates it to useSettings over realtime.
      const result = await sdk.plugins.updateSettings({ pluginId, values });
      const confirmed = readSettings(result.values);
      setBaseline(confirmed);
      setDraft(confirmed);
      setInterval(String(confirmed.refreshIntervalSeconds));
      setStatus("saved");
    } catch {
      // Do not expose server/provider error bodies in the card.
      setStatus("failed");
    } finally {
      pending.current = false;
    }
  }

  return <form aria-label={text.settings} className="grid gap-2" noValidate onSubmit={event => { void save(event); }} lang={locale}>
    <fieldset disabled={status === "saving"} className="grid min-w-0 gap-2 disabled:opacity-60">
      <div className="grid gap-1">
        <label htmlFor={`${id}-interval`}>{text.interval}</label>
        <input id={`${id}-interval`} type="number" inputMode="numeric" min={0} max={maxIntervalSeconds} step={1} required
          value={interval} aria-invalid={invalid || undefined} aria-describedby={`${id}-interval-help`}
          className={`min-h-9 w-full rounded border border-input bg-background px-2 tabular-nums ${focusClass}`}
          onChange={event => { setInterval(event.target.value); setInvalid(false); setStatus("idle"); }} />
        <p id={`${id}-interval-help`} className={invalid ? "text-destructive" : "text-muted-foreground"}>
          {invalid ? text.invalid : text.off}
        </p>
      </div>
      <label className="flex min-h-9 cursor-pointer items-center justify-between gap-2">
        {text.chat}<input type="checkbox" checked={draft.showInChat} className={`size-4 accent-teal-600 ${focusClass}`}
          onChange={event => edit({ showInChat: event.target.checked })} />
      </label>
      <label className="flex min-h-9 cursor-pointer items-center justify-between gap-2">
        {text.sidebar}<input type="checkbox" checked={draft.showInSidebar} className={`size-4 accent-teal-600 ${focusClass}`}
          onChange={event => edit({ showInSidebar: event.target.checked })} />
      </label>
      {!draft.showInChat && !draft.showInSidebar && <p className="text-muted-foreground">{text.restore}</p>}
      <button type="submit" className={`min-h-9 rounded bg-primary px-2 font-medium text-primary-foreground ${focusClass}`}>
        {status === "saving" ? text.saving : text.save}
      </button>
    </fieldset>
    <p role={status === "failed" ? "alert" : "status"} className={`min-h-4 ${status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
      {{ idle: "", saving: "", saved: text.saved, failed: text.failed }[status]}
    </p>
  </form>;
}
