import { config } from "../config.js";
import { NotWired, withFallback } from "./util.js";

export interface DataFact {
  fact: string;
  provider: string;
  costUsd: number;
}

// Glasser: structured real-world data, with the price shown before each call.
export async function lookupFact(query: string) {
  return withFallback<DataFact>(
    "Glasser",
    `looked up "${query}"`,
    config.keys.glasser,
    async () => {
      // TODO: call Glasser with config.keys.glasser (pick a provider for prices/places).
      throw new NotWired();
    },
    () => ({
      fact: "A store-bought 9-inch pumpkin pie sells for about $6.99 at a typical US supermarket this week.",
      provider: "offline estimate",
      costUsd: 0,
    }),
  );
}
