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
    settings: "Settings", back: "Back", interval: "Refresh", show: "Show ring", intervalLabel: "Refresh interval, seconds", unit: "s", help: "About auto-refresh", off: "0 disables auto-refresh",
    chat: "Chat", sidebar: "Sidebar", chatName: "Ring in chat", sidebarName: "Ring in sidebar", save: "Save", retry: "Retry",
    saving: "Saving…", saved: "Saved", failed: "Could not save. Try again.", unavailable: "Settings unavailable",
    invalid: "Enter a whole number, 0 or higher.", tooLong: `Maximum interval: ${maxIntervalSeconds.toLocaleString("en-US")} s.`,
  },
  ru: {
    settings: "Настройки", back: "Назад", interval: "Обновление", show: "Показывать кольцо", intervalLabel: "Обновление, секунды", unit: "с", help: "Об автообновлении", off: "0 отключает автообновление",
    chat: "В чате", sidebar: "В меню", chatName: "Кольцо в чате", sidebarName: "Кольцо в меню", save: "Сохранить", retry: "Повторить",
    saving: "Сохранение…", saved: "Сохранено", failed: "Не удалось сохранить. Попробуйте ещё раз.", unavailable: "Настройки недоступны",
    invalid: "Введите целое число не меньше нуля.", tooLong: `Максимум — ${maxIntervalSeconds.toLocaleString("ru-RU")} с.`,
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
  const backButton = <button ref={back} type="button" data-codex-quota-back="" className={buttonClass} onClick={() => turn(false)}>
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

/** One of two independent placement chips. The mark, not colour alone, shows on or off. */
function PlacementToggle({ label, name, checked, onChange }: {
  label: string; name: string; checked: boolean; onChange: (checked: boolean) => void;
}) {
  return <label title={name} className={`flex min-h-7 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded border px-1.5 hover:bg-state-hover active:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring [@media(any-pointer:coarse)]:min-h-9 ${checked
    ? "border-border text-popover-foreground" : "border-dashed border-border text-muted-foreground"}`}>
    <input type="checkbox" role="switch" aria-label={name} checked={checked} className="sr-only" onChange={event => onChange(event.target.checked)} />
    <span aria-hidden="true" className={`inline-flex size-3.5 shrink-0 items-center justify-center rounded-full ${checked
      ? "bg-teal-600 text-white dark:bg-teal-400 dark:text-popover" : "border border-muted-foreground/60"}`}>
      {checked && <Icon name="Check" className="size-2.5" />}
    </span>
    {label}
  </label>;
}

type SaveState = "idle" | "saving" | "saved" | "failed";

function SaveButton({ status, dirty, text }: { status: SaveState; dirty: boolean; text: typeof copy.en }) {
  const label = { idle: text.save, saving: text.saving, saved: text.saved, failed: text.retry }[status];
  return <button type="submit" data-state={status} disabled={status === "saving" || !dirty}
    className={`inline-flex min-h-6 items-center justify-center gap-1 ml-auto rounded border px-2 font-medium ${focusClass} ${!dirty && status === "idle" ? "invisible" : ""} ${dirty
      ? "border-teal-600/60 bg-teal-600/10 text-teal-700 hover:bg-teal-600/20 active:bg-teal-600/30 active:shadow-inner dark:border-teal-400/60 dark:text-teal-400"
      : "border-transparent text-muted-foreground"}`}>
    {status === "saved" && <Icon name="Check" aria-hidden="true" className="size-3 text-teal-600 dark:text-teal-400" />}
    <span role={status === "saved" ? "status" : undefined} className={status === "saved" ? "sr-only @[11rem]:not-sr-only" : undefined}>{label}</span>
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

  return <form aria-label={text.settings} className="@container grid gap-1.5 text-xs leading-4" noValidate onSubmit={event => { void save(event); }} lang={locale}>
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      {backButton}
      <SaveButton status={status} dirty={dirty} text={text} />
    </div>
    <fieldset disabled={status === "saving"} className="grid min-w-0 gap-1.5 disabled:opacity-60">
      <div className="grid gap-1">
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1">
          <div className="flex min-w-0 items-center">
            <label htmlFor={`${id}-interval`}>{text.interval}</label>
            <IntervalHelp id={`${id}-interval-help`} label={text.help} text={text.off} />
          </div>
          <label className="ml-auto inline-flex h-6 cursor-text items-baseline gap-0.5 self-center rounded border border-border bg-background px-1.5 leading-5 focus-within:border-ring has-[[aria-invalid=true]]:border-destructive!">
            <input id={`${id}-interval`} type="number" inputMode="numeric" min={0} max={maxIntervalSeconds} step={1} required
              value={interval} aria-label={text.intervalLabel} aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${id}-interval-error` : `${id}-interval-help`}
              style={{ width: `${Math.min(7, Math.max(3, interval.length))}ch` }}
              className="m-0 min-w-0 appearance-none border-0 bg-transparent p-0 text-end font-medium tabular-nums text-popover-foreground outline-none [&::-webkit-inner-spin-button]:appearance-none"
              onChange={event => { setInterval(event.target.value); setInvalid(false); setStatus("idle"); }} />
            <span aria-hidden="true" className="text-muted-foreground">{text.unit}</span>
          </label>
        </div>
        {invalid && <p id={`${id}-interval-error`} role="alert" className="px-1 text-destructive">{next.refreshIntervalSeconds > maxIntervalSeconds ? text.tooLong : text.invalid}</p>}
      </div>
      <div role="group" aria-label={text.show} className="flex gap-1">
        <PlacementToggle label={text.chat} name={text.chatName} checked={draft.showInChat} onChange={showInChat => edit({ showInChat })} />
        <PlacementToggle label={text.sidebar} name={text.sidebarName} checked={draft.showInSidebar} onChange={showInSidebar => edit({ showInSidebar })} />
      </div>
    </fieldset>
    {status === "failed" && <p role="alert" className="px-1 text-destructive">{text.failed}</p>}
  </form>;
}
