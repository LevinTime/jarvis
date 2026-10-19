import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useI18n } from "../i18n/index.ts";
import { Lamp } from "../ui.tsx";

export function T3Page({ url }: { url: string }) {
  const t = useI18n();
  const [up, setUp] = useState<boolean | null>(null);

  useEffect(() => {
    let gone = false;
    api<{ reachable: boolean }>("/api/t3")
      .then((body) => {
        if (!gone) {
          setUp(body.reachable);
        }
      })
      .catch(() => {
        if (!gone) {
          setUp(false);
        }
      });
    return () => {
      gone = true;
    };
  }, [url]);

  return (
    <div className="stack">
      <header className="top">
        <div>
          <p className="eyebrow">{t("t3.kicker")}</p>
          <h1>{t("t3.title")}</h1>
        </div>
        <Lamp className="lg" />
      </header>
      <section className="card">
        <span className="kicker">{t("t3.url")}</span>
        <strong>{up === null ? "…" : up ? t("t3.up") : t("t3.down")}</strong>
        <p>{url || t("t3.missing")}</p>
        <p>{t("t3.noThread")}</p>
        <a className="text-btn" href={url || "http://127.0.0.1:3773"} target="_blank" rel="noreferrer">
          {t("t3.open")}
        </a>
      </section>
      <section className="card">
        <span className="kicker">{t("t3.guideTitle")}</span>
        <p>{t("t3.guide")}</p>
      </section>
    </div>
  );
}
