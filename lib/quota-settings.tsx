import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { experimental_Icon as Icon, experimental_usePluginId, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { IntervalHelp } from "./interval-help";
import { usePinQuotaPopover } from "./quota-popover";

export interface QuotaSettingsValues {
  refreshIntervalSeconds: number;
  showInChat: boolean;
  showInSidebar: boolean;
}

const maxIntervalSeconds = Math.floor(2_147_483_647 / 1000);
const copy = {
  en: {
    settings: "Settings", back: "Back", interval: "Refresh", intervalLabel: "Refresh interval, seconds", unit: "s", help: "About auto-refresh", off: "0 disables auto-refresh",
    chat: "In chat", sidebar: "In sidebar", save: "Save", retry: "Retry",
    saving: "Saving…", saved: "Saved", failed: "Could not save. Try again.", unavailable: "Settings unavailable",
    invalid: `Enter a whole number from 0 to ${maxIntervalSeconds}.`,
  },
  ru: {
    settings: "Настройки", back: "Назад", interval: "Обновление", intervalLabel: "Обновление, секунды", unit: "с", help: "Об автообновлении", off: "0 отключает автообновление",
    chat: "В чате", sidebar: "В боковой панели", save: "Сохранить", retry: "Повторить",
    saving: "Сохранение…", saved: "Сохранено", failed: "Не удалось сохранить. Попробуйте ещё раз.", unavailable: "Настройки недоступны",
    invalid: `Введите целое число от 0 до ${maxIntervalSeconds}.`,
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
const buttonClass = `inline-flex items-center justify-center gap-1 rounded px-1 text-muted-foreground hover:bg-state-hover hover:text-popover-foreground active:bg-muted active:text-popover-foreground ${focusClass}`;
const turnStyles = `
@keyframes codex-quota-turn { from { opacity: .5; transform: perspective(500px) rotateY(-12deg); } to { opacity: 1; transform: perspective(500px) rotateY(0); } }
[data-codex-quota-side] { animation: codex-quota-turn 140ms ease-out; }
[data-codex-quota-gear] { width: 24px; height: 24px; padding: 0; }
[data-codex-quota-back] { min-height: 24px; }
@media (any-pointer: coarse) { [data-codex-quota-gear] { width: 28px; height: 28px; } [data-codex-quota-back] { min-height: 28px; } }
@media (prefers-reduced-motion: reduce) { [data-codex-quota-side] { animation: none; } }
`;

export type QuotaSettingsSurface = "chat" | "sidebar";

/** Place inside QuotaPopover. Render the supplied gear in the front's header. */
export function QuotaSettingsCard({ children, surface = "chat" }: {
  children: (settingsButton: ReactNode) => ReactNode;
  surface?: QuotaSettingsSurface;
}) {
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

  const settingsButton = <button ref={gear} type="button" aria-label={text.settings} title={text.settings} data-codex-quota-gear=""
    className={`shrink-0 ${buttonClass}`} onClick={() => turn(true)}>
    <Icon name="Settings" aria-hidden="true" className="size-3" />
  </button>;
  const backButton = <button ref={back} type="button" data-codex-quota-back="" className={`-ml-1 ${buttonClass}`} onClick={() => turn(false)}>
    <Icon name="ChevronLeft" aria-hidden="true" className="size-3" />{text.back}
  </button>;

  return <>
    <style>{turnStyles}</style>
    <div key={String(settingsSide)} data-codex-quota-side={settingsSide ? "settings" : "quota"} className="grid gap-1.5"
      lang={values?.language === "ru" ? "ru" : "en"}>
      {settingsSide ? <>
        {values ? <QuotaSettingsForm initial={readSettings(values)} language={values.language} surface={surface} backButton={backButton} />
          : <>{backButton}<p role="status">{text.unavailable}</p></>}
      </> : children(settingsButton)}
    </div>
  </>;
}

function SettingSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="-mx-1 flex min-h-6 cursor-pointer items-center justify-between gap-2 rounded px-1 hover:bg-state-hover active:bg-muted">
    {label}
    <input type="checkbox" role="switch" checked={checked} className="peer sr-only" onChange={event => onChange(event.target.checked)} />
    <span aria-hidden="true" className="inline-flex h-3.5 w-6 shrink-0 items-center rounded-full bg-muted-foreground/40 p-0.5 peer-checked:bg-teal-600 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-popover dark:peer-checked:bg-teal-400">
      <span className={`size-2.5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none ${checked ? "translate-x-2.5" : "translate-x-0"}`} />
    </span>
  </label>;
}

type SaveState = "idle" | "saving" | "saved" | "failed";

function SaveButton({ status, dirty, text }: { status: SaveState; dirty: boolean; text: typeof copy.en }) {
  const label = { idle: text.save, saving: text.saving, saved: text.saved, failed: text.retry }[status];
  return <button type="submit" data-state={status} disabled={status === "saving" || !dirty}
    className={`inline-flex min-h-6 items-center justify-center gap-1 rounded border px-1.5 font-medium ${focusClass} ${dirty
      ? "border-teal-600/60 bg-teal-600/10 text-teal-700 hover:bg-teal-600/20 active:bg-teal-600/30 active:shadow-inner dark:border-teal-400/60 dark:text-teal-400"
      : "border-transparent text-muted-foreground data-[state=idle]:opacity-60"}`}>
    {status === "saved" && <Icon name="Check" aria-hidden="true" className="size-3 text-teal-600 dark:text-teal-400" />}
    <span role={status === "saved" ? "status" : undefined}>{label}</span>
  </button>;
}

function QuotaSettingsForm({ initial, language, surface, backButton }: {
  initial: QuotaSettingsValues; language: unknown; surface: QuotaSettingsSurface; backButton: ReactNode;
}) {
  const sdk = useSdk();
  const pluginId = experimental_usePluginId();
  const id = useId();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [interval, setInterval] = useState(String(initial.refreshIntervalSeconds));
  const [invalid, setInvalid] = useState(false);
  const [status, setStatus] = useState<SaveState>("idle");
  const pending = useRef(false);
  const locale = language === "ru" ? "ru" : "en";
  const text = copy[locale];
  const visibility = surface === "sidebar" ? "showInSidebar" : "showInChat";
  // Patch only edited fields so a concurrent settings-page save keeps unrelated values.
  const next = { ...draft, refreshIntervalSeconds: Number(interval) };
  const values = Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== baseline[key as keyof QuotaSettingsValues]));
  const dirty = interval !== String(baseline.refreshIntervalSeconds) || Object.keys(values).length > 0;

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
    if (!Object.keys(values).length) {
      setInterval(String(baseline.refreshIntervalSeconds));
      return;
    }
    pending.current = true;
    setStatus("saving");
    try {
      // Public SDK persists BB config and propagates it to useSettings over realtime.
      const result = await sdk.plugins.updateSettings({ pluginId, values });
      const confirmed = readSettings(result.values);
      setBaseline(confirmed);
      setDraft(confirmed);
      setInterval(String(confirmed.refreshIntervalSeconds));
      if (values[visibility] === false && !confirmed[visibility]) {
        // The host toast survives the ring/card unmount. Do not also announce inline.
        toast.success(text.saved, { id: `${pluginId}:quota-settings-saved` });
        setStatus("idle");
      } else {
        setStatus("saved");
      }
    } catch {
      // Do not expose server/provider error bodies in the card.
      setStatus("failed");
    } finally {
      pending.current = false;
    }
  }

  return <form aria-label={text.settings} className="grid gap-1 text-[11px] leading-4" noValidate onSubmit={event => { void save(event); }} lang={locale}>
    <div className="flex items-center justify-between gap-2">
      {backButton}
      <SaveButton status={status} dirty={dirty} text={text} />
    </div>
    <fieldset disabled={status === "saving"} className="grid min-w-0 gap-0.5 disabled:opacity-60">
      <div className="flex min-h-6 items-center justify-between gap-1">
        <div className="flex items-center">
          <label htmlFor={`${id}-interval`}>{text.interval}</label>
          <IntervalHelp id={`${id}-interval-help`} label={text.help} text={text.off} />
        </div>
        <label className="inline-flex h-[22px] cursor-text items-baseline gap-0.5 self-center rounded border border-border bg-background px-1.5 leading-5 focus-within:border-ring">
          <input id={`${id}-interval`} type="number" inputMode="numeric" min={0} max={maxIntervalSeconds} step={1} required
            value={interval} aria-label={text.intervalLabel} aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-interval-error` : `${id}-interval-help`}
            style={{ width: `${Math.min(7, Math.max(3, interval.length))}ch` }}
            className="m-0 min-w-0 appearance-none border-0 bg-transparent p-0 text-end font-medium tabular-nums text-popover-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none"
            onChange={event => { setInterval(event.target.value); setInvalid(false); setStatus("idle"); }} />
          <span aria-hidden="true" className="text-muted-foreground">{text.unit}</span>
        </label>
      </div>
      {invalid && <p id={`${id}-interval-error`} role="alert" className="text-destructive">{text.invalid}</p>}
      <SettingSwitch label={text.chat} checked={draft.showInChat} onChange={showInChat => edit({ showInChat })} />
      <SettingSwitch label={text.sidebar} checked={draft.showInSidebar} onChange={showInSidebar => edit({ showInSidebar })} />
    </fieldset>
    {status === "failed" && <p role="alert" className="text-destructive">{text.failed}</p>}
  </form>;
}
