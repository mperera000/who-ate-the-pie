# What each tool does

Every film is made live, so each tool below runs every time someone opens a new case (unless noted otherwise). Each one shows up as a label in the film's decision log, so viewers can see which tool did what.

## Claude (Anthropic): the four characters' brains

Detective Goldilocks, Papa Bear, Mama Bear and Baby Bear are each a separate AI agent running on `claude-opus-5-5`. About 16 times per film, an agent gets its personality, its secret, its private memories and what's been said so far, then decides what to do next. It must answer in a fixed JSON shape (choice, line, reason, mood, whether it's lying, where to walk, who to whisper to), so every decision can drive the film and be logged.

- Decides: when to sneak downstairs, whether to eat, hide the pie or frame someone, what to say, whether to lie, whether to blurt out another bear's secret, Goldilocks's "too hot / too cold / just right" verdicts, who she accuses, and whether the accused confesses.
- Code: `src/engine/brain.ts` (calls), `src/engine/story.ts` (the schemas and the film)

## Runware: everything you see and hear

- **Character art:** the four characters, generated with FLUX.2 (`src/art/characters.ts`, `src/art/cli.ts`)
- **Cutouts:** background removal turns them into full-body figures that walk around the set
- **The cabin set:** the storybook cutaway cabin
- **3D models:** each character turned into a 3D model with Tripo 3D (`web/cast3d.html`)
- **A poster for every case:** when a film ends, a poster is generated for that exact ending (who got accused, who really did it) and shown on the end card
- **Voices:** every spoken line, in a distinct voice per character plus a narrator, generated as the film is being made (`src/sponsors/runware.ts`)

## BAND: private messages between the agents

Each character is a registered BAND agent. Every film opens its own BAND chat room (Goldilocks's agent creates it and invites the bears), and when a bear decides to whisper to another, the message is sent as a real agent-to-agent BAND message that @mentions only the recipient. The whisper also appears on screen and on the case board.

- Code: `src/sponsors/band.ts`

## Telem AI: live web search

- **Cabin radio:** each morning, Telem finds a real, funny news story from this week, and it plays on the radio. The agents are told about it and can use it as an alibi or a distraction.
- **Goldilocks's research:** mid-interrogation she can search the live web, and the result and its sources appear on screen.
- **Live alibi fact-checks:** bears can back their story with a real-world fact (the radio news, tonight's real weather, a real event). Goldilocks searches it on the live web, and a verdict (CONFIRMED, BUSTED or UNVERIFIED) is stamped on screen with the sources.
- Code: `src/sponsors/telem.ts`

## Bruin: analyzing every decision across all films

Every decision from every film (who did what, why, whether it was a lie, how the film ended) is published to a public feed at `/api/decisions.csv`. A Bruin pipeline loads that feed and builds three tables, with data quality checks:

- `analytics.accusations`: which bear Goldilocks accuses most, and how often she's right
- `analytics.lies`: how often each bear lies when questioned
- `analytics.endings`: how often each ending happens

**Bruin feeds the next film.** `npm run bruin:sync` runs the pipeline, queries those tables and publishes the results as the "Forest Police records". Every new film loads the latest records: Goldilocks gets her real track record and each bear's lie rate, every bear knows their own reputation ("you lie 88% of the time, and Goldilocks knows it"), and the film opens by showing the records. So the agents' behavior is shaped by Bruin's analysis of every earlier film.

Run it by hand with `cd bruin && bruin run --config-file .bruin.yml decisions`.

- Code: `bruin/` (pipeline), `src/sponsors/bruin.ts` (publishing the rows)

## Open-Meteo: live weather (free, no key)

Each film picks a random real forest (Yosemite, the Black Forest, Hokkaido and others) and pulls its weather right now, plus tonight's moon phase. The weather changes the rules of the night: storms cut the power at 2am, full moons let bears spot each other, rain leaves paw prints, freezing nights make everyone hungrier. Every agent is told the rules.

- Code: `src/world.ts`

## Vercel: hosting and storage

- **Hosting:** the public site and its API. Making a film is one request that streams the agents' decisions to the browser as they happen (`api/`, `src/api/handlers.ts`).
- **Blob storage:** finished films, case summaries and the decision feed, so the casebook, memories and endings grid build up across every viewer's films (`src/store.ts`).
- A daily cap (40 new films) keeps the public link from running up API costs.

## Finch

Not in use yet. Finch's marketplace has skills that would fit (Novel Characters for a cast bible, Noiz Sound FX and Text to Music for sound), but they aren't wired in yet, so Finch isn't credited in the film.
