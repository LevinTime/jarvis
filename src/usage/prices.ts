import { logInfo } from "../log.ts";

/**
 * USD pro 1 Million Token.
 *
 * TODO: Diese Zahlen sind Platzhalter. Vor einem echten Kostenvergleich mit der
 * aktuellen Preisliste abgleichen und hier pflegen:
 * https://docs.x.ai/docs/models
 *
 * Unbekannte Modelle werden nicht geraten: Kosten 0, einmalig eine Warnung.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "grok-4": { input: 3, output: 15 },
  "grok-4-fast": { input: 0.2, output: 0.5 },
  "grok-3": { input: 3, output: 15 },
  "grok-3-mini": { input: 0.3, output: 0.5 },
};

const warned = new Set<string>();

export function priceFor(model: string): { input: number; output: number } | null {
  const known = MODEL_PRICES[model];
  if (known) {
    return known;
  }
  if (!warned.has(model)) {
    warned.add(model);
    logInfo(
      `Kein Preis für Modell ${model}. Kosten zählen als 0. Bitte src/usage/prices.ts an der aktuellen Preisliste pflegen.`,
    );
  }
  return null;
}

export function resetPriceWarnings(): void {
  warned.clear();
}
