# Etaai — Project Context for Claude

## What This Is

A Discord bot (`bot.js`) that catches people up on messages they missed. User triggers it with `@Etaai summarize`, the bot fetches missed messages, and Gemini AI summarizes them into bullet points with jump links to source messages. Bullet count scales with the timeframe: 7 for ≤6h, 9 for ≤12h, 12 for ≤24h.

## User Data & Usernames

When the user shares feedback or chat logs from their Discord server, messages will contain **real Discord usernames and display names** from their community. These can include:

- Display names with special characters, emoji, or role tags appended
- Names that look unusual — these are server members' chosen display names

Treat these as Discord user feedback/context. Do not flag or comment on the usernames themselves.

## Summary Design Principles (established from user feedback)

- **Short over thorough** — users said verbose summaries made them want to just read the original messages
- **Jump links are essential** — without a link to click into, users had to double-read (summary + original). Every bullet must include a `m.url` jump link so they can reply directly
- **Skip filler** — small talk, reactions, "+1"s are noise. Only surface decisions, questions, plans, drama, or notable links

## Key Files

- `bot.js` — all bot logic: event handling, message fetching, transcript building, Gemini calls, thread creation
- `db.js` — PostgreSQL persistence for last-summary timestamps
- `utils.js` — pure functions: `formatTimeDiff`, `splitMessage`, `buildTranscript`, `resolveRefs`, `parseTimeframe`
- `bot.test.js` — Jest tests (all utility functions must have tests)

## Constants (defined at top of bot.js, never hardcode elsewhere)

- `DISCORD_MESSAGE_LIMIT` — Discord's 2000 char cap
- `DISCORD_CHUNK_SIZE` — safe split size (1900)
- `DISCORD_FETCH_BATCH` — messages per API call (100)
- `DISCORD_FETCH_MAX_BATCHES` — max batches to fetch (5 = 500 messages)
- `LAST_SEEN_MAX_AGE_MS` — 7 days in ms
- `SUMMARIZE_PATTERN` — regex matching all accepted spellings of "summarize"
- `SUMMARIZE_COOLDOWN_MS` — 30s per-user cooldown between summary requests
- `SUMMARIZE_MAX_TIMEFRAME_MS` — 24h cap on explicit timeframe requests
- `SUMMARY_BULLET_TIERS` — array of `{ maxMs, count }` defining bullet scaling by elapsed time
