import type { DensityId } from "../settings/model.ts";

export type DensityVars = {
  text: number;
  pad: number;
  gap: number;
  row: number;
};

/** Compact, normal and large. The id `airy` stays so older saved settings still match. */
export function densityVars(density: DensityId): DensityVars {
  switch (density) {
    case "compact":
      return { text: 0.94, pad: 16, gap: 12, row: 36 };
    case "airy":
      return { text: 1.14, pad: 24, gap: 16, row: 52 };
    case "normal":
      return { text: 1, pad: 20, gap: 14, row: 40 };
  }
}
