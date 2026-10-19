import { logInfo } from "../log.ts";

/**
 * USD pro 1 Million Token.
 *
 * Stand 19.10.2026, Quelle: https://docs.x.ai/docs/models
 * grok-4 und grok-4-fast leitet xAI seit 15.05.2026 auf grok-4.3 um.
 * cachedInput gilt für usage.prompt_tokens_details.cached_tokens.
 * Unbekannte Modelle werden nicht geraten: Kosten 0, einmalig eine Warnung.
 */
export type ModelPrice = {
  input: number;
  cachedInput: number;
  output: number;
};

const GROK_43: ModelPrice = { input: 1.25, cachedInput: 0.2, output: 2.5 };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "grok-4.3": GROK_43,
  "grok-4.20-0309": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-4.7": { input: 2, cachedInput: 0.5, output: 6 },
  "grok-4": GROK_43,
  "grok-4-fast": GROK_43,
};

const warned = new Set<string>();

export function priceFor(model: string): ModelPrice | null {
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
