require("dotenv").config();
const { Client, GatewayIntentBits, Partials, ChannelType } = require("discord.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { formatTimeDiff, splitMessage, buildTranscript, parseTimeframe } = require("./utils");
const { init, getLastSummaryTime, saveLastSummary } = require("./db");

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_CHUNK_SIZE = 1900;
const DISCORD_FETCH_BATCH = 100;
const DISCORD_FETCH_MAX_BATCHES = 5;
const LAST_SEEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SUMMARIZE_PATTERN = /summar[iy]z?e?|summery|summerise|sumarize|summ/;
const SUMMARIZE_COOLDOWN_MS = 30 * 1000;
const SUMMARIZE_MAX_TIMEFRAME_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const GEMINI_RETRY_ATTEMPTS = 3;
const GEMINI_RETRY_BASE_DELAY_MS = 2000;

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
const gemini = genai.getGenerativeModel({ model: "gemini-3.5-flash" });

const lastSeen = new Map();
const summarizeCooldowns = new Map();
let lastPrune = 0;

function pruneLastSeen() {
  const cutoff = Date.now() - LAST_SEEN_MAX_AGE_MS;
  for (const [userId, channels] of lastSeen) {
    for (const channelId of Object.keys(channels)) {
      if (channels[channelId].getTime() < cutoff) delete channels[channelId];
    }
    if (Object.keys(channels).length === 0) lastSeen.delete(userId);
  }
  for (const [userId, ts] of summarizeCooldowns) {
    if (Date.now() - ts >= SUMMARIZE_COOLDOWN_MS) summarizeCooldowns.delete(userId);
  }
}

function maybePruneLastSeen() {
  if (Date.now() - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = Date.now();
  pruneLastSeen();
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const channelId = message.channel.id;

  if (message.mentions.has(client.user)) {
    if (SUMMARIZE_PATTERN.test(message.content.toLowerCase())) {
      const lastRequest = summarizeCooldowns.get(userId);
      if (lastRequest && Date.now() - lastRequest < SUMMARIZE_COOLDOWN_MS) {
        const remaining = Math.ceil((SUMMARIZE_COOLDOWN_MS - (Date.now() - lastRequest)) / 1000);
        await message.reply(`⏳ Please wait ${remaining}s before requesting another summary.`);
        return;
      }
      summarizeCooldowns.set(userId, Date.now());
      await handleSummarize(message, userId, channelId);
    } else {
      await message.reply("Want a catch-up summary of what you missed? Just say **@Etaai summarize**!");
    }
    return;
  }

  if (!lastSeen.has(userId)) lastSeen.set(userId, {});
  lastSeen.get(userId)[channelId] = new Date();
  maybePruneLastSeen();
});

async function fetchMissedMessages(channel, knownCutoff, userId, excludeId) {
  const startOfYesterday = new Date();
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  startOfYesterday.setHours(0, 0, 0, 0);

  const allMessages = [];
  let lastId = null;
  let reachedCutoff = false;
  let discoveredCutoff = null;

  for (let i = 0; i < DISCORD_FETCH_MAX_BATCHES && !reachedCutoff; i++) {
    const options = { limit: DISCORD_FETCH_BATCH };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    for (const [id, m] of batch) {
      if (id === excludeId) continue;

      if (knownCutoff) {
        if (m.createdAt <= knownCutoff) { reachedCutoff = true; break; }
      } else {
        if (!m.author.bot && m.author.id === userId) {
          discoveredCutoff = m.createdAt;
          reachedCutoff = true;
          break;
        }
        if (m.createdAt <= startOfYesterday) { reachedCutoff = true; break; }
      }

      if (!m.author.bot) allMessages.push(m);
    }

    lastId = batch.last().id;
  }

  return {
    messages: allMessages.sort((a, b) => a.createdAt - b.createdAt),
    cutoffTime: knownCutoff ?? discoveredCutoff ?? startOfYesterday,
  };
}

async function generateSummary(transcript, timeSince) {
  const prompt = `You are a Discord catch-up bot. The user was away for ${timeSince}. Give them an ultra-short summary of what they missed.

Rules:
- Maximum 5 bullet points. Fewer is better.
- Each bullet: one sentence. No fluff.
- Only include things worth acting on or knowing: decisions, questions aimed at people, plans, drama, important links.
- Skip small talk, reactions, and filler.
- For each bullet, append the most relevant message URL from the URL map at the bottom of the transcript.
- Format: • <one sentence> (<url>)

Missed messages:
${transcript}`;

  for (let attempt = 1; attempt <= GEMINI_RETRY_ATTEMPTS; attempt++) {
    try {
      const result = await gemini.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      const isRetryable = err.status === 429 || err.status >= 500;
      if (!isRetryable || attempt === GEMINI_RETRY_ATTEMPTS) throw err;
      const delay = GEMINI_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(`Gemini attempt ${attempt} failed (${err.status}), retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
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
  const messageId = message.id;

  const requestedMs = parseTimeframe(message.content);
  let knownCutoff;
  if (requestedMs !== null) {
    const clampedMs = Math.min(requestedMs, SUMMARIZE_MAX_TIMEFRAME_MS);
    knownCutoff = new Date(Date.now() - clampedMs);
  } else {
    knownCutoff = await getLastSummaryTime(userId, channelId) ?? (lastSeen.get(userId) || {})[channelId] ?? null;
  }

  await message.delete().catch((err) => {
    if (err.code !== 10008) console.warn("Could not delete summarize message:", err.message);
  });

  const statusMsg = await channel.send("⏳ Fetching missed messages...");
  let errorTarget = statusMsg;

  try {
    const { messages: missed, cutoffTime } = await fetchMissedMessages(channel, knownCutoff, userId, messageId);

    if (missed.length === 0) {
      await statusMsg.edit("✅ No new messages since you were last active — you're all caught up!");
      return;
    }

    const thread = await channel.threads.create({
      name: `📋 catch-up — ${message.author.username}`,
      type: ChannelType.PublicThread,
      autoArchiveDuration: 60,
    });
    await statusMsg.delete().catch(() => {});
    const thinkingMsg = await thread.send("⏳ Summarizing...");
    errorTarget = thinkingMsg;

    const timeSince = formatTimeDiff(cutoffTime, new Date());
    const transcript = buildTranscript(missed);
    const summary = await generateSummary(transcript, timeSince);

    await sendSummary(thread, thinkingMsg, summary, missed.length, timeSince);

    await saveLastSummary(userId, channelId);
    if (!lastSeen.has(userId)) lastSeen.set(userId, {});
    lastSeen.get(userId)[channelId] = new Date();
  } catch (err) {
    console.error("Error summarizing:", err);

    let userMessage;
    if (err.status === 429) {
      userMessage = "❌ Gemini rate limit hit — try again in a moment.";
    } else if (err.status >= 500) {
      userMessage = "❌ Gemini is having issues — try again later.";
    } else if (err.code?.startsWith("50")) {
      userMessage = "❌ Discord error while fetching messages — do I have the right permissions?";
    } else {
      userMessage = "❌ Something went wrong — try again later.";
    }
    await errorTarget.edit(userMessage).catch(() => {});
  }
}

client.once("ready", () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);
});

async function start() {
  try {
    await init();
  } catch (err) {
    console.error("⚠️ Database unavailable, running without persistence:", err);
  }
  await client.login(process.env.DISCORD_TOKEN);
}

if (require.main === module) {
  start();
}

module.exports = { fetchMissedMessages, generateSummary };
