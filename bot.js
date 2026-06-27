require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const gemini = genai.getGenerativeModel({ model: "gemini-2.0-flash" });

// Track last-seen timestamps per user per channel: { userId: { channelId: Date } }
const lastSeen = new Map();

// Update last-seen whenever a user sends a message
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const channelId = message.channel.id;

  if (message.mentions.has(client.user)) {
    const content = message.content.toLowerCase();
    const wantsSummary = /summar[iy]z?e?|summery|summerise|sumarize|summ/.test(content);
    if (wantsSummary) {
      await handleSummarize(message, userId, channelId);
    } else {
      await message.reply("Want a catch-up summary of what you missed? Just say **@Etaai summarize**!");
    }
    return;
  }

  // Record last active time for this user in this channel
  if (!lastSeen.has(userId)) lastSeen.set(userId, {});
  lastSeen.get(userId)[channelId] = new Date();
});

async function handleSummarize(message, userId, channelId) {
  const channel = message.channel;

  // Find when the user was last active in this channel
  const userChannels = lastSeen.get(userId) || {};
  const lastActiveTime = userChannels[channelId];

  if (!lastActiveTime) {
    return message.reply(
      "I haven't seen you active in this channel before, so I don't know what you've missed. Send a message first, then come back later and @mention me!"
    );
  }

  const thinkingMsg = await message.reply("⏳ Fetching missed messages and summarizing...");

  try {
    // Fetch up to 500 messages in batches of 100 (Discord API limit)
    const allMessages = new Map();
    let lastId = null;
    let reachedCutoff = false;

    for (let i = 0; i < 5 && !reachedCutoff; i++) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      const batch = await channel.messages.fetch(options);
      if (batch.size === 0) break;

      for (const [id, m] of batch) {
        if (m.createdAt <= lastActiveTime) { reachedCutoff = true; break; }
        allMessages.set(id, m);
      }

      lastId = batch.last().id;
    }

    const missed = allMessages
      .filter((m) => m.id !== message.id && !m.author.bot)
      .sort((a, b) => a.createdAt - b.createdAt);

    if (missed.size === 0) {
      await thinkingMsg.edit("✅ No new messages since you were last active — you're all caught up!");
      return;
    }

    // Format messages for Claude
    const transcript = missed
      .map((m) => {
        const time = m.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return `[${time}] ${m.author.username}: ${m.content}`;
      })
      .join("\n");

    const timeSince = formatTimeDiff(lastActiveTime, new Date());

    // Ask Gemini to summarize
    const prompt = `You are a helpful Discord assistant. Summarize the following missed messages from a Discord channel for a user who has been away for ${timeSince}. Be concise and conversational. Highlight key topics, decisions, questions directed at others, and anything the user should know. Group related messages into themes if helpful.\n\nMissed messages:\n${transcript}`;
    const result = await gemini.generateContent(prompt);
    const summary = result.response.text();

    // Send summary (split if too long for Discord's 2000 char limit)
    const header = `📋 **Catch-up summary** — ${missed.size} messages since you were last active (${timeSince} ago):\n\n`;
    const fullMessage = header + summary;

    if (fullMessage.length <= 2000) {
      await thinkingMsg.edit(fullMessage);
    } else {
      await thinkingMsg.edit(header);
      // Split into chunks
      const chunks = splitMessage(summary, 1900);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    }

    // Update their last-seen to now
    lastSeen.get(userId)[channelId] = new Date();
  } catch (err) {
    console.error("Error summarizing:", err);
    await thinkingMsg.edit(`❌ Error: ${err.message || JSON.stringify(err)}`);
  }
}

function formatTimeDiff(from, to) {
  const diffMs = to - from;
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

function splitMessage(text, maxLen) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLen;
    if (end < text.length) {
      // Try to break at a newline
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start) end = lastNewline;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

client.once("ready", () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
