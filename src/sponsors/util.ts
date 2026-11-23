import type { SponsorName, SponsorUse } from "../engine/types.js";

/** Thrown by an adapter whose real API call hasn't been wired up yet. */
export class NotWired extends Error {}

/**
 * Run the real sponsor call when a key is set, otherwise (or on failure) the
 * offline stand-in. The returned `use` says which one ran, for the on-screen badge.
 */
export async function withFallback<T>(
  sponsor: SponsorName,
  what: string,
  key: string,
  real: () => Promise<T>,
  offline: () => T,
): Promise<{ value: T; use: SponsorUse }> {
  const started = Date.now();
  if (key) {
    try {
      const value = await real();
      return { value, use: { sponsor, what, live: true, ms: Date.now() - started } };
    } catch (error) {
      if (!(error instanceof NotWired)) console.warn(`[${sponsor}] ${what} failed: ${(error as Error).message}`);
    }
  }
  return { value: offline(), use: { sponsor, what: `${what} (offline)`, live: false, ms: Date.now() - started } };
}
