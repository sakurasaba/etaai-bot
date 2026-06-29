# Etaai — Discord Catch-Up Bot

![Node.js](https://img.shields.io/badge/Node.js-22-green) ![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2) ![Gemini](https://img.shields.io/badge/Gemini-2.5%20Flash-blue) ![License](https://img.shields.io/badge/license-MIT-brightgreen)

Etaai is a Discord bot that summarizes what you missed in a channel. Mention it and ask for a summary — it figures out when you were last active and uses Gemini AI to condense everything since then into a readable catch-up.

---

## Features

- **Automatic last-seen tracking** — every message you send is silently timestamped per channel
- **AI-powered summaries** — Gemini condenses missed messages into bullet points covering only what matters: decisions, questions, plans, and anything worth acting on — filler and small talk are skipped
- **Scaled bullet count** — summary length grows with the timeframe: up to 7 bullets for ≤6h, 9 for ≤12h, 12 for ≤24h
- **Custom timeframes** — ask for a specific window with `@Etaai summarize last 6h` (supports `m`, `h`, `d`)
- **Persistent last-seen** — summary timestamps are stored in PostgreSQL so restarts don't reset your position
- **Smart fallback** — if no record exists for you in a channel, it scans recent history to find your last message automatically
- **Yesterday fallback** — if no prior message is found at all, it summarizes everything since midnight yesterday (up to 500 messages)
- **Typo-tolerant** — common misspellings like `summerize`, `sumarize`, `summery`, and `summ` all work
- **Jump links** — each summary bullet includes a clickable link to the most relevant source message so you can jump straight to reply
- **Long summary support** — responses that exceed Discord's 2000-character limit are automatically split across multiple messages
- **Memory pruning** — in-memory last-seen timestamps older than 7 days are automatically cleaned up

---

## Usage

| Action | Result |
|---|---|
| Send any message in a channel | Bot silently records your last-seen time |
| `@Etaai summarize` | Deletes your command, opens a thread, and posts your catch-up summary there |
| `@Etaai summarize last 6h` | Summarizes only the last 6 hours regardless of last-seen |
| `@Etaai summarize last 30m` | Summarizes only the last 30 minutes |
| `@Etaai` (no keyword) | Bot reminds you how to ask for a summary |
| `@Etaai summerize` / `@Etaai summ` | Also works — common misspellings are handled |

---

## How It Works

1. Every message you send is silently timestamped per channel.
2. When you run `@Etaai summarize`, it checks PostgreSQL for when you last requested a summary in that channel.
3. If no database record exists, it falls back to the in-memory last-seen timestamp from this session.
4. If neither exists, it scans the last 500 messages to find your most recent one. If you've never spoken, it falls back to messages since midnight yesterday.
5. Gemini AI condenses the missed messages into bullets scaled to the timeframe. Each bullet links to the source message so you can jump straight to reply without re-reading the whole channel.

---

## Setup

### 1. Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g. "Etaai")
3. Go to **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
   - ✅ Presence Intent
5. Click **Reset Token** and copy your bot token

### 2. Invite the Bot to Your Server

Go to **OAuth2 → URL Generator**:
- Scopes: `bot`
- Bot Permissions: `Read Messages/View Channels`, `Send Messages`, `Read Message History`, `Manage Messages`, `Create Public Threads`

Open the generated URL and invite the bot to your server.

### 3. Get a Gemini API Key

Sign up at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — it's free.

### 4. Set Up a PostgreSQL Database

The bot uses PostgreSQL to persist last-summary timestamps across restarts. Any Postgres instance works — local, Railway, Supabase, etc. The required table is created automatically on startup.

### 5. Configure Environment

Create a `.env` file in the project root:

```env
DISCORD_TOKEN=your_discord_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

If `DATABASE_URL` is unavailable or the database is unreachable, the bot starts anyway and falls back to in-memory tracking for that session.

### 6. Install & Run

```bash
npm install
npm start      # runs: node bot.js
```

`npm install` reads `package.json` and installs the following dependencies:

| Package | Purpose |
|---|---|
| `discord.js` | Discord API client |
| `@google/generative-ai` | Gemini AI client |
| `pg` | PostgreSQL client |
| `dotenv` | Loads `.env` into `process.env` |

---

## Project Structure

```
etaai/
├── bot.js          # Bot logic: event handling, message fetching, Gemini calls
├── db.js           # PostgreSQL persistence for last-summary timestamps
├── utils.js        # Pure functions: formatTimeDiff, splitMessage, buildTranscript, resolveRefs, parseTimeframe
├── bot.test.js     # Jest tests
├── .env            # Environment variables (never commit this)
├── .gitignore
└── package.json
```

---

## Running Tests

```bash
npm test
```

47 tests covering `formatTimeDiff`, `splitMessage`, `buildTranscript`, `resolveRefs`, `parseTimeframe`, `bulletCountForDuration`, `fetchMissedMessages`, and `generateSummary` — including edge cases, retry logic, and boundary values.

---

## Limitations

- **500 message cap** — fetches a maximum of 5 batches of 100 messages per summary
- **24-hour cap** — explicit timeframe requests are clamped to the last 24 hours
- **Per-channel tracking** — each channel maintains its own independent last-seen history
- **30-second cooldown** — each user can only request a summary once every 30 seconds
