# 🕵️‍♀️ Who Ate the Pie?

**Detective Goldilocks interrogates the Three Bears. AI agents decide every choice, so every film ends differently.**

**▶ Make a film: https://who-ate-the-pie.vercel.app**

Multiplayer AI Hackathon, **Track 1: Agent Animated Film**. Click **✨ Make a new film** and four AI agents improvise a ~90-second animated whodunit live in the Three Bears' log cabin. **⏺ Record & download** saves any finished case as a video file.

## The setup (the only part we wrote)

Thanksgiving Eve. Mama Bear's pumpkin pie cools in the kitchen. The bears go to bed. In the morning, part of the pie is gone, and Detective Goldilocks (yes, the reformed porridge thief, now in a deerstalker) arrives to question the bears.

Setup `ID` is shown on screen and never changes. **Everything after it is decided by the agents:**

| Scene | What the agents decide |
|---|---|
| Bedtime | Each bear decides, alone, whether and when to sneak downstairs |
| Midnight | Eat a slice? Two? Hide the pie? Smear crumbs on someone else's chair? Clean up (and risk being seen) or run? |
| Morning | The clues come only from those choices: crumbs, pumpkin in someone's fur, a bear seen tiptoeing |
| Interrogation | Goldilocks picks who to question and can research the live web; bears answer, lie (or don't), walk off, and send private messages |
| Accusation | Goldilocks names a bear; the others react; the accused decides whether to confess |
| Ending | *Case Closed*, *Caught, Still Denying*, *Framed!*, *Wrong Bear*, or *Old Habits* |

**Memory that changes decisions:** every character remembers last Thanksgiving (wrongly accused bears hold grudges), and Goldilocks keeps a casebook of every past case, who lied and who was guilty, which shapes who she questions next.

## Hackathon checklist

| Requirement | How |
|---|---|
| Characters | Four full-body characters in a glowing glass-fiber style (Runware FLUX.2), cut out with Runware background removal; also converted to 3D models (Runware Tripo 3D) |
| Visual output | An animated film with a camera that cuts between the cabin's rooms |
| Movement & action | Characters walk between rooms, waddle, bounce when talking, shake when accused, jump when they react; agents choose where to go |
| 3+ agents | Four agents with their own goals, secrets, skills and memories |
| Decision log | Every choice and its real reason, sealed until the reveal (lies flagged) |
| Different endings | Same setup, new film every run; the end card compares recent cases side by side |
| Voice ★ | Every character speaks with their own voice (xAI TTS via Runware) |
| ML / memory ★ | Cross-film memory and Goldilocks's casebook change future decisions |

## Sponsor tools

| Tool | Job in the film |
|---|---|
| **Bruin** | Every decision from every film is published to a public feed (`/api/decisions.csv`). The Bruin pipeline in [`bruin/`](bruin) ingests it and builds `analytics.accusations`, `analytics.lies` and `analytics.endings`, with quality checks |
| **BAND** | Each character is a real BAND agent. Every film opens its own BAND chat room; the bears' private whispers are real agent-to-agent messages |
| **Runware** | Character art (FLUX.2), background removal, 3D models (Tripo 3D), the cabin set, and every voice line (xAI TTS) |
| **Telem AI** | Goldilocks's live web research mid-interrogation, with sources |
| **Claude** | The four agents' brains: `claude-opus-5-5` with structured JSON decisions |
| **AdaL** | Poster and demo-video edit |

## Run it locally

```bash
npm install
cp .env.example .env   # add keys; anything blank falls back to an offline stand-in
npm run dev            # http://localhost:5173
npm run film -- 3      # make three films from the terminal
npm run art -- images  # regenerate character art (Runware)
```

Bruin pipeline:

```bash
cd bruin
bruin run decisions
bruin query --connection duckdb-default --query "SELECT * FROM analytics.accusations"
```

## How it's built

- `src/engine/story.ts`: the film. Each decision is one Claude call that must return JSON in a fixed schema (`client.beta.messages.parse` with zod).
- `src/api/handlers.ts`: `POST /api/generate` streams the film to the browser as newline-delimited JSON while the agents decide it; finished cases are saved to Vercel Blob.
- `web/`: the player. A camera that cuts between rooms, full-body sprites, voices, the decision log, and Record & download (tab capture cropped to the stage).
- Public films are capped per day (`MAX_FILMS_PER_DAY`, default 40).
