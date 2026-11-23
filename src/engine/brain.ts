import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "../config.js";
import type { SponsorUse } from "./types.js";

export interface Decision<T> {
  value: T;
  use: SponsorUse;
}

/**
 * Every character decision goes through here: one Claude call that must return
 * JSON matching `schema`. In offline mode (or if the call fails) the caller's
 * `fallback` produces a plausible decision so the film still runs.
 */
export class Brain {
  private client = config.mock ? null : new Anthropic();
  calls = 0;
  failures = 0;

  get live() {
    return this.client !== null;
  }

  async decide<S extends z.ZodType>(
    what: string,
    schema: S,
    system: string,
    prompt: string,
    fallback: () => z.infer<S>,
  ): Promise<Decision<z.infer<S>>> {
    const started = Date.now();
    if (!this.client) {
      return { value: fallback(), use: { sponsor: "Claude", what: `${what} (offline)`, live: false, ms: 0 } };
    }
    this.calls++;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await this.client.beta.messages.parse({
          model: config.model,
          max_tokens: 4000,
          // Server-side refusal fallback: if the model declines, the API retries on
          // its default fallback model inside the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system,
          messages: [{ role: "user", content: prompt }],
          output_config: { effort: config.effort, format: betaZodOutputFormat(schema) },
        });
        if (response.stop_reason === "refusal" || !response.parsed_output) {
          throw new Error(`no usable output (stop_reason: ${response.stop_reason})`);
        }
        const usage = response.usage;
        return {
          value: response.parsed_output as z.infer<S>,
          use: {
            sponsor: "Claude",
            what,
            live: true,
            ms: Date.now() - started,
            costUsd: estimateCost(usage.input_tokens, usage.output_tokens),
          },
        };
      } catch (error) {
        const label =
          error instanceof Anthropic.AuthenticationError
            ? "invalid ANTHROPIC_API_KEY"
            : error instanceof Anthropic.RateLimitError
              ? "rate limited"
              : error instanceof Anthropic.APIError
                ? `API error ${error.status}`
                : (error as Error).message;
        console.warn(`[brain] ${what} attempt ${attempt} failed: ${label}`);
        if (error instanceof Anthropic.AuthenticationError) break;
      }
    }
    this.failures++;
    return { value: fallback(), use: { sponsor: "Claude", what: `${what} (fallback)`, live: false, ms: Date.now() - started } };
  }
}

// Per-million-token prices for the models this project uses.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

function estimateCost(input: number, output: number) {
  const [i, o] = PRICES[config.model] ?? [4, 20];
  return Math.round(((input * i + output * o) / 1_000_000) * 10000) / 10000;
}
