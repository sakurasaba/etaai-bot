# Etaai — Discord Catch-Up Bot

Etaai tracks when you were last active in a channel and, when asked, fetches everything you missed and summarizes it using Gemini AI.

---

## How It Works

1. Every message you send is silently timestamped per channel.
2. When you type `@Etaai summarize`, it fetches up to 500 messages posted since your last activity.
3. Gemini AI condenses them into a concise catch-up — topics, decisions, questions directed at people, and anything notable.
4. Timestamps older than 7 days are automatically pruned from memory.

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
- Bot Permissions: `Read Messages/View Channels`, `Send Messages`, `Read Message History`

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

## Usage

| Action | Result |
|---|---|
| Send any message in a channel | Bot silently records your last-seen time |
| `@Etaai summarize` | Bot summarizes everything you missed |
| `@Etaai` (no keyword) | Bot reminds you how to ask for a summary |
| `@Etaai summerize` / `@Etaai summ` | Also works — common misspellings are handled |

**Note:** You must send at least one message in a channel before the bot can summarize it for you. This is how it knows when you were last active.

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

- **Last-seen resets on restart** — activity data is stored in memory, not a database. A bot restart means the bot needs to see you send a new message before it can summarize again.
- **500 message cap** — fetches a maximum of 5 batches of 100 messages (Discord API limit per request).
- **One channel at a time** — last-seen is tracked per channel, so each channel has its own independent history.
