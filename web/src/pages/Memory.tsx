import { useEffect, useState } from "react";
import { MEMORY_CATEGORIES, type MemoryCategory, type MemoryFact, type MemoryImportance } from "../../../src/memory/model.ts";
import { api } from "../api.ts";
import { useI18n } from "../i18n/index.ts";
import { Empty, Skeleton } from "../ui.tsx";

type Correction = {
  id: string;
  frage: string;
  falscheAntwort: string;
  korrektur: string;
  datum: string;
};

type MemoryResponse = {
  facts: MemoryFact[];
  corrections: Correction[];
  correctionsThisMonth: number;
};

export function MemoryPage({ onClose }: { onClose: () => void }) {
  const t = useI18n();
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MemoryCategory | "">("");
  const [text, setText] = useState("");
  const [weight, setWeight] = useState<MemoryImportance>(2);
  const [editing, setEditing] = useState<MemoryFact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(nextQuery = query, nextCategory = category) {
    const params = new URLSearchParams();
    if (nextQuery.trim()) {
      params.set("q", nextQuery.trim());
    }
    if (nextCategory) {
      params.set("kategorie", nextCategory);
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const body = await api<MemoryResponse>(`/api/memory${suffix}`);
    setFacts(body.facts);
    setCorrections(body.corrections);
  }

  useEffect(() => {
    let gone = false;
    load()
      .catch((reason: unknown) => {
        if (!gone) {
          setError(reason instanceof Error ? reason.message : t("memory.fail"));
        }
      })
      .finally(() => {
        if (!gone) {
          setLoading(false);
        }
      });
    return () => {
      gone = true;
    };
  }, []);

  async function addFact() {
    const value = text.trim();
    if (!value) {
      return;
    }
    setError(null);
    try {
      await api("/api/memory", {
        method: "POST",
        body: JSON.stringify({
          text: value,
          kategorie: category || "regel",
          wichtigkeit: weight,
        }),
      });
      setText("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("memory.fail"));
    }
  }

  async function saveEdit() {
    if (!editing) {
      return;
    }
    setError(null);
    try {
      await api(`/api/memory/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          text: editing.text,
          kategorie: editing.kategorie,
          wichtigkeit: editing.wichtigkeit,
        }),
      });
      setEditing(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("memory.fail"));
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/api/memory/${id}`, { method: "DELETE" });
      setEditing(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("memory.fail"));
    }
  }

  const shownCorrections = category === "korrektur" ? corrections : [];

  return (
    <div className="memory-screen" role="dialog" aria-modal="true" aria-label={t("memory.title")} data-no-swipe>
      <header className="top">
        <div>
          <p className="eyebrow">Jarvis</p>
          <h1>{t("memory.title")}</h1>
        </div>
        <button type="button" className="text-btn" onClick={onClose}>{t("common.done")}</button>
      </header>
      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      <section className="settings-card">
        <label className="field">
          <span>{t("memory.search")}</span>
          <input
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              void load(next, category).catch(() => undefined);
            }}
          />
        </label>
        <div className="choice" role="group" aria-label={t("memory.filter")}>
          <button type="button" className="text-btn ghost" aria-pressed={category === ""} onClick={() => { setCategory(""); void load(query, ""); }}>
            {t("memory.all")}
          </button>
          {MEMORY_CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              className="text-btn ghost"
              aria-pressed={category === item}
              onClick={() => {
                setCategory(item);
                void load(query, item);
              }}
            >
              {categoryLabel(item, t)}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-card">
        <label className="field">
          <span>{t("memory.add")}</span>
          <textarea value={text} maxLength={500} placeholder={t("memory.placeholder")} onChange={(event) => setText(event.target.value)} />
        </label>
        <label className="field">
          <span>{t("memory.weight")} {weight}</span>
          <input className="range" type="range" min={1} max={3} value={weight} onChange={(event) => setWeight(Number(event.target.value) as MemoryImportance)} />
        </label>
        <button type="button" className="text-btn" onClick={() => void addFact()}>{t("memory.add")}</button>
      </section>
      {loading ? <Skeleton lines={4} /> : null}
      {!loading && facts.length === 0 && shownCorrections.length === 0 ? (
        <Empty title={t("memory.emptyTitle")} text={t("memory.emptyBody")} />
      ) : null}
      {facts.map((fact) => (
        <article key={fact.id} className="settings-card fact">
          {editing?.id === fact.id ? (
            <>
              <textarea value={editing.text} maxLength={500} onChange={(event) => setEditing({ ...editing, text: event.target.value })} />
              <div className="choice">
                <button type="button" className="text-btn" onClick={() => void saveEdit()}>{t("common.save")}</button>
                <button type="button" className="text-btn ghost" onClick={() => void remove(fact.id)}>{t("common.delete")}</button>
              </div>
            </>
          ) : (
            <>
              <p className="kicker">{categoryLabel(fact.kategorie, t)} · {fact.wichtigkeit}</p>
              <p>{fact.text}</p>
              <button type="button" className="text-btn ghost" onClick={() => setEditing(fact)}>{t("memory.edit")}</button>
            </>
          )}
        </article>
      ))}
      {shownCorrections.map((row) => (
        <article key={row.id} className="settings-card fact">
          <p className="kicker">{t("memory.cat.korrektur")}</p>
          <p>{row.falscheAntwort}</p>
          <p className="muted">{row.korrektur}</p>
        </article>
      ))}
    </div>
  );
}

function categoryLabel(category: MemoryCategory, tr: (key: string) => string): string {
  switch (category) {
    case "person": return tr("memory.cat.person");
    case "vorliebe": return tr("memory.cat.vorliebe");
    case "ort": return tr("memory.cat.ort");
    case "projekt": return tr("memory.cat.projekt");
    case "termin-kontext": return tr("memory.cat.termin");
    case "regel": return tr("memory.cat.regel");
    case "korrektur": return tr("memory.cat.korrektur");
  }
}
