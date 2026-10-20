import { useI18n } from "../i18n/index.ts";
import type { AppSettings, CostCheckId, DensityId, LocaleId, ThemeId } from "../../../src/settings/model.ts";

const COST: CostCheckId[] = ["an", "aus", "kaeufe"];

const THEMES: ThemeId[] = ["midnight", "ocean", "aurora", "graphite", "light"];
const DENSITIES: DensityId[] = ["compact", "normal", "airy"];

export function Settings({
  settings,
  t3Field,
  onChange,
  onT3,
  onClose,
  onReset,
  onMemory,
  onUsage,
}: {
  settings: AppSettings;
  t3Field: string;
  onChange: (patch: Partial<AppSettings>) => void;
  onT3: (value: string) => void;
  onClose: () => void;
  onReset: () => void;
  onMemory: () => void;
  onUsage: () => void;
}) {
  const t = useI18n();
  return (
    <div className="settings-screen" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
      <header className="top">
        <div>
          <p className="eyebrow">Jarvis</p>
          <h1>{t("settings.title")}</h1>
        </div>
        <button type="button" className="text-btn" onClick={onClose}>
          {t("common.done")}
        </button>
      </header>
      <section className="settings-card">
        <span className="kicker">{t("settings.language")}</span>
        <div className="choice" role="group" aria-label={t("settings.language")}>
          {(["de", "en"] as LocaleId[]).map((locale) => (
            <button key={locale} type="button" className="text-btn ghost" aria-pressed={settings.locale === locale} onClick={() => onChange({ locale })}>
              {locale === "de" ? t("settings.langDe") : t("settings.langEn")}
            </button>
          ))}
        </div>
        <label className="toggle">
          <span>
            {t("settings.assistant")}
            <p className="hint">{t("settings.assistantHint")}</p>
          </span>
          <input
            type="checkbox"
            checked={settings.assistantLanguage === "en"}
            onChange={(event) => onChange({ assistantLanguage: event.target.checked ? "en" : "de" })}
          />
        </label>
      </section>
      <section className="settings-card">
        <span className="kicker">{t("settings.theme")}</span>
        <div className="choice">
          {THEMES.map((theme) => (
            <button key={theme} type="button" className="text-btn ghost" aria-pressed={settings.theme === theme} onClick={() => onChange({ theme })}>
              {themeName(theme, t)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t("settings.accent")}</span>
          <input
            type="color"
            value={settings.accent ?? "#4f7cff"}
            onChange={(event) => onChange({ accent: event.target.value })}
          />
        </label>
        <button type="button" className="text-btn ghost" onClick={() => onChange({ accent: null })}>
          {t("settings.accentClear")}
        </button>
      </section>
      <section className="settings-card">
        <label className="field">
          <span>{t("settings.scale")} {Math.round(settings.textScale * 100)}%</span>
          <input className="range" type="range" min={85} max={130} value={Math.round(settings.textScale * 100)} onChange={(event) => onChange({ textScale: Number(event.target.value) / 100 })} />
        </label>
        <span className="kicker">{t("settings.density")}</span>
        <div className="choice">
          {DENSITIES.map((density) => (
            <button key={density} type="button" className="text-btn ghost" aria-pressed={settings.density === density} onClick={() => onChange({ density })}>
              {density === "compact" ? t("settings.compact") : density === "airy" ? t("settings.airy") : t("settings.normal")}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t("settings.radius")}</span>
          <input className="range" type="range" min={70} max={140} value={Math.round(settings.radius * 100)} onChange={(event) => onChange({ radius: Number(event.target.value) / 100 })} />
        </label>
        <label className="toggle">
          <span>{t("settings.motion")}</span>
          <input type="checkbox" checked={settings.reduceMotion} onChange={(event) => onChange({ reduceMotion: event.target.checked })} />
        </label>
        <label className="toggle">
          <span>{t("settings.haptics")}</span>
          <input type="checkbox" checked={settings.haptics} onChange={(event) => onChange({ haptics: event.target.checked })} />
        </label>
      </section>
      <section className="settings-card">
        <span className="kicker">{t("settings.cost")}</span>
        <button type="button" className="text-btn ghost" onClick={onUsage}>
          {t("settings.usage")}
        </button>
        <div className="choice" role="group" aria-label={t("settings.cost")}>
          {COST.map((id) => (
            <button key={id} type="button" className="text-btn ghost" aria-pressed={settings.costCheck === id} onClick={() => onChange({ costCheck: id })}>
              {costLabel(id, t)}
            </button>
          ))}
        </div>
        <label className="toggle">
          <span>
            {t("settings.selfCheck")}
            <p className="hint">{t("settings.selfCheckHint")}</p>
          </span>
          <input type="checkbox" checked={settings.selfCheck} onChange={(event) => onChange({ selfCheck: event.target.checked })} />
        </label>
        <button type="button" className="text-btn" onClick={onMemory}>
          {t("settings.memory")}
        </button>
      </section>
      <section className="settings-card">
        <label className="field">
          <span>{t("settings.t3")}</span>
          <input type="url" inputMode="url" value={t3Field} onChange={(event) => onT3(event.target.value)} placeholder="http://127.0.0.1:3773" />
          <p className="hint">{t("settings.t3Hint")}</p>
        </label>
        <button type="button" className="text-btn ghost" onClick={onReset}>
          {t("settings.reset")}
        </button>
        <p className="hint">{t("settings.resetHint")}</p>
      </section>
    </div>
  );
}

function costLabel(id: CostCheckId, tr: (key: string) => string): string {
  switch (id) {
    case "an": return tr("settings.costAn");
    case "aus": return tr("settings.costAus");
    case "kaeufe": return tr("settings.costBuy");
  }
}

function themeName(theme: ThemeId, tr: (key: string) => string): string {
  switch (theme) {
    case "midnight": return tr("theme.midnight");
    case "ocean": return tr("theme.ocean");
    case "aurora": return tr("theme.aurora");
    case "graphite": return tr("theme.graphite");
    case "light": return tr("theme.light");
  }
}
