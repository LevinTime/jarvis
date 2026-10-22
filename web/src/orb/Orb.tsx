import { useEffect, useState } from "react";
import type { OrbState } from "@jarvis/orb-state.ts";
import { useI18n } from "../i18n/index.ts";

/**
 * Soft voice orb. Motion is original CSS (transform and opacity only).
 * The look follows VoiceOrbs "Minimal" / "Halo" (MIT, https://github.com/amunozdev/voiceorbs).
 * No code was copied from that project.
 */
export function Orb({ state, level = null }: { state: OrbState; level?: number | null }) {
  const t = useI18n();
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const listeningScale =
    state === "listening" && level !== null ? 1 + Math.max(-0.08, Math.min(0.08, level)) : null;
  const label =
    state === "thinking"
      ? t("orb.thinking")
      : state === "speaking"
        ? t("orb.speaking")
        : state === "listening"
          ? t("orb.listening")
          : state === "error"
            ? t("orb.error")
            : t("orb.idle");

  return (
    <div className={`orb-wrap is-${state}`}>
      <div
        className={`orb is-${state}${hidden ? " is-paused" : ""}`}
        data-state={state}
        data-motion={listeningScale === null ? "css" : "level"}
        style={listeningScale === null ? undefined : { transform: `scale(${listeningScale})` }}
        role="img"
        aria-label={label}
      >
        <span className="sr-only" aria-live={state === "error" ? "assertive" : "polite"}>
          {label}
        </span>
        <span className="orb-blob a" />
        <span className="orb-blob b" />
        <span className="orb-blob c" />
        <span className="orb-ring" />
      </div>
      <p className="orb-caption" aria-hidden="true">{label}</p>
    </div>
  );
}
