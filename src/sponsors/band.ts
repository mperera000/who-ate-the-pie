import { config } from "../config.js";
import type { CharacterId } from "../engine/types.js";
import { withFallback } from "./util.js";

// BAND: each character is a real BAND agent. Every film gets its own BAND chat room
// (opened by Goldilocks's agent), and the bears' private whispers are real
// agent-to-agent messages that @mention the recipient.
const BASE = "https://api.band.ai/api/v1/agent";
void config; // loads .env

interface Identity {
  id: string;
  handle: string;
  name: string;
}

const agentKeys = (): Partial<Record<CharacterId, string>> => {
  try {
    return JSON.parse(process.env.BAND_AGENT_KEYS || "{}");
  } catch {
    return {};
  }
};

export const bandReady = () => {
  const k = agentKeys();
  return Boolean(k.goldilocks && k.papa && k.mama && k.baby);
};

async function call<T>(who: CharacterId, method: string, path: string, body?: unknown): Promise<T> {
  const key = agentKeys()[who];
  if (!key) throw new Error(`no BAND key for ${who}`);
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string } };
  if (!res.ok) throw new Error(`BAND ${res.status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`.trim());
  return json.data as T;
}

const identities = new Map<CharacterId, Identity>();
async function identity(who: CharacterId) {
  if (!identities.has(who)) identities.set(who, await call<Identity>(who, "GET", "me"));
  return identities.get(who)!;
}

/** Goldilocks's agent opens a chat room for this case and invites the three bears. */
export async function openCaseRoom(caseNumber: number) {
  return withFallback<string | null>(
    "BAND",
    `case room #${caseNumber}`,
    bandReady() ? "agents" : "",
    async () => {
      const room = await call<{ id: string }>("goldilocks", "POST", "chats", { chat: { title: `Who Ate the Pie? · Case #${caseNumber}` } });
      await Promise.all(
        (["papa", "mama", "baby"] as const).map(async (bear) =>
          call("goldilocks", "POST", `chats/${room.id}/participants`, { participant: { participant_id: (await identity(bear)).id, role: "member" } }),
        ),
      );
      return room.id;
    },
    () => null,
  );
}

/** A private agent-to-agent message, delivered only to the @mentioned bear. */
export async function whisper(roomId: string | null, from: CharacterId, to: CharacterId, text: string) {
  return withFallback(
    "BAND",
    `${from} → ${to}`,
    roomId ? "room" : "",
    async () => {
      const target = await identity(to);
      return call(from, "POST", `chats/${roomId}/messages`, {
        message: { content: `@${target.handle} ${text}`, mentions: [{ id: target.id, handle: target.handle, name: target.name }] },
      });
    },
    () => ({ delivered: true }),
  );
}
