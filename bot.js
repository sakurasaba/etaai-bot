require("dotenv").config();
const { Client, GatewayIntentBits, Partials, ChannelType } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { formatTimeDiff, splitMessage } = require("./utils");
const { init, getLastSummaryTime, saveLastSummary } = require("./db");

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_CHUNK_SIZE = 1900;
const DISCORD_FETCH_BATCH = 100;
const DISCORD_FETCH_MAX_BATCHES = 5;
const LAST_SEEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SUMMARIZE_PATTERN = /summar[iy]z?e?|summery|summerise|sumarize|summ/;

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
const gemini = genai.getGenerativeModel({ model: "gemini-3-flash-preview" });

const lastSeen = new Map();

function pruneLastSeen() {
  const cutoff = Date.now() - LAST_SEEN_MAX_AGE_MS;
  for (const [userId, channels] of lastSeen) {
    for (const channelId of Object.keys(channels)) {
      if (channels[channelId].getTime() < cutoff) delete channels[channelId];
    }
    if (Object.keys(channels).length === 0) lastSeen.delete(userId);
  }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const channelId = message.channel.id;

  if (message.mentions.has(client.user)) {
    if (SUMMARIZE_PATTERN.test(message.content.toLowerCase())) {
      await handleSummarize(message, userId, channelId);
    } else {
      await message.reply("Want a catch-up summary of what you missed? Just say **@Etaai summarize**!");
    }
    return;
  }

  if (!lastSeen.has(userId)) lastSeen.set(userId, {});
  lastSeen.get(userId)[channelId] = new Date();
  pruneLastSeen();
});

async function findLastUserMessageTime(channel, userId, excludeId) {
  let lastId = null;
  for (let i = 0; i < DISCORD_FETCH_MAX_BATCHES; i++) {
    const options = { limit: DISCORD_FETCH_BATCH };
    if (lastId) options.before = lastId;
    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;
    for (const [id, m] of batch) {
      if (id === excludeId) continue;
      if (m.author.id === userId && !m.author.bot) return m.createdAt;
    }
    lastId = batch.last().id;
  }
  return null;
}

async function fetchMissedMessages(channel, lastActiveTime, excludeId) {
  const allMessages = [];
  let lastId = null;
  let reachedCutoff = false;

  for (let i = 0; i < DISCORD_FETCH_MAX_BATCHES && !reachedCutoff; i++) {
    const options = { limit: DISCORD_FETCH_BATCH };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    for (const [, m] of batch) {
      if (m.createdAt <= lastActiveTime) { reachedCutoff = true; break; }
      allMessages.push(m);
    }

    lastId = batch.last().id;
  }

  return allMessages
    .filter((m) => m.id !== excludeId && !m.author.bot)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function buildTranscript(messages) {
  return messages
    .map((m) => {
      const time = m.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `[${time}] ${m.author.username} (${m.url}): ${m.content}`;
    })
    .join("\n");
}

async function generateSummary(transcript, timeSince) {
  const prompt = `You are a Discord catch-up bot. The user was away for ${timeSince}. Give them a ultra-short summary of what they missed.

Rules:
- Maximum 5 bullet points. Fewer is better.
- Each bullet: one sentence. No fluff.
- Only include things worth acting on or knowing: decisions, questions aimed at people, plans, drama, important links.
- Skip small talk, reactions, and filler.
- For each bullet, append the most relevant message jump link in parentheses so the user can click to reply.
- Format: • <one sentence> (<discord message url>)

Missed messages:
${transcript}`;
  const result = await gemini.generateContent(prompt);
  return result.response.text();
}

async function sendSummary(channel, thinkingMsg, summary, missedCount, timeSince) {
  const header = `📋 **${missedCount} messages in the last ${timeSince}:**\n\n`;
  const fullMessage = header + summary;

  if (fullMessage.length <= DISCORD_MESSAGE_LIMIT) {
    await thinkingMsg.edit(fullMessage);
    return;
  }

  await thinkingMsg.edit(header);
  for (const chunk of splitMessage(summary, DISCORD_CHUNK_SIZE)) {
    await channel.send(chunk);
  }
}

async function handleSummarize(message, userId, channelId) {
  const channel = message.channel;
  let lastActiveTime = await getLastSummaryTime(userId, channelId) ?? (lastSeen.get(userId) || {})[channelId];
  const messageId = message.id;

  await message.delete().catch(() => {});

  const thread = await channel.threads.create({
    name: `📋 catch-up — ${message.author.username}`,
    type: ChannelType.PublicThread,
    autoArchiveDuration: 60,
  });

  const thinkingMsg = await thread.send("⏳ Fetching missed messages and summarizing...");

  try {
    if (!lastActiveTime) {
      const startOfYesterday = new Date();
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      startOfYesterday.setHours(0, 0, 0, 0);
      lastActiveTime = await findLastUserMessageTime(channel, userId, messageId) ?? startOfYesterday;
    }

    const missed = await fetchMissedMessages(channel, lastActiveTime, messageId);

    if (missed.length === 0) {
      await thinkingMsg.edit("✅ No new messages since you were last active — you're all caught up!");
      return;
    }

    const timeSince = formatTimeDiff(lastActiveTime, new Date());
    const transcript = buildTranscript(missed);
    const summary = await generateSummary(transcript, timeSince);

    await sendSummary(thread, thinkingMsg, summary, missed.length, timeSince);

    await saveLastSummary(userId, channelId);
    if (!lastSeen.has(userId)) lastSeen.set(userId, {});
    lastSeen.get(userId)[channelId] = new Date();
  } catch (err) {
    console.error("Error summarizing:", err);

    if (err.status === 429) {
      await thinkingMsg.edit("❌ Gemini rate limit hit — try again in a moment.");
    } else if (err.status >= 500) {
      await thinkingMsg.edit("❌ Gemini is having issues — try again later.");
    } else if (err.code?.startsWith("50")) {
      await thinkingMsg.edit("❌ Discord error while fetching messages — do I have the right permissions?");
    } else {
      await thinkingMsg.edit(`❌ Error: ${err.message}`);
    }
  }
}

client.once("ready", () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
});

init()
  .catch((err) => console.error("⚠️ Database unavailable, running without persistence:", err.message))
  .then(() => client.login(process.env.DISCORD_TOKEN));
