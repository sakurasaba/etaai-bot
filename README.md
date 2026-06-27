# Etaai — Discord Catch-Up Bot

![Node.js](https://img.shields.io/badge/Node.js-22-green) ![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2) ![Gemini](https://img.shields.io/badge/Gemini-3%20Flash-blue) ![License](https://img.shields.io/badge/license-MIT-brightgreen)

Etaai is a Discord bot that summarizes what you missed in a channel. Mention it and ask for a summary — it figures out when you were last active and uses Gemini AI to condense everything since then into a readable catch-up.

---

## Features

- **Automatic last-seen tracking** — every message you send is silently timestamped per channel
- **AI-powered summaries** — Gemini 2.0 Flash condenses missed messages into topics, decisions, and anything notable
- **Smart fallback** — if you've never been seen in a channel (e.g. after a bot restart), it scans recent history to find your last message automatically
- **Yesterday fallback** — if no prior message is found at all, it summarizes everything since midnight yesterday (up to 500 messages)
- **Typo-tolerant** — common misspellings like `summerize`, `sumarize`, `summery`, and `summ` all work
- **Long summary support** — responses that exceed Discord's 2000-character limit are automatically split across multiple messages
- **Memory pruning** — last-seen timestamps older than 7 days are automatically cleaned up

---

## Usage

| Action | Result |
|---|---|
| Send any message in a channel | Bot silently records your last-seen time |
| `@Etaai summarize` | Deletes your command, opens a private thread, and posts your catch-up summary there |
| `@Etaai` (no keyword) | Bot reminds you how to ask for a summary |
| `@Etaai summerize` / `@Etaai summ` | Also works — common misspellings are handled |

---

## How It Works

1. Every message you send is silently timestamped per channel.
2. When you run `@Etaai summarize`, it looks up when you were last active in that channel.
3. If no in-memory record exists (e.g. after a restart), it scans the last 500 messages to find your most recent one.
4. If you've never spoken in the channel, it falls back to messages since midnight yesterday.
5. Gemini AI condenses the missed messages into a concise catch-up.

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

### 4. Configure Environment

Create a `.env` file in the project root:

```env
DISCORD_TOKEN=your_discord_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### 5. Install & Run

```bash
npm install
npm start
```

---

## Project Structure

```
etaai-bot/
├── bot.js          # Main bot logic and Discord event handling
├── utils.js        # Pure utility functions (formatTimeDiff, splitMessage)
├── bot.test.js     # Jest tests for utility functions
├── .env            # Environment variables (never commit this)
├── .gitignore
└── package.json
```

---

## Running Tests

```bash
npm test
```

12 tests covering `formatTimeDiff` and `splitMessage` across edge cases including boundary values, newline-aware splitting, and empty input.

---

## Limitations

- **In-memory only** — last-seen data is not persisted to a database, so a restart triggers the history-scan fallback
- **500 message cap** — fetches a maximum of 5 batches of 100 messages per summary
- **Per-channel tracking** — each channel maintains its own independent last-seen history
