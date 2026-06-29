const MS_PER_MINUTE = 60000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const TIMEFRAME_PATTERN = /last\s+(\d+)\s*(m(?:in(?:utes?)?)?|h(?:ours?)?|d(?:ays?)?)\b/i;

function formatTimeDiff(from, to) {
  const diffMs = to - from;
  const mins = Math.floor(diffMs / MS_PER_MINUTE);
  const hours = Math.floor(mins / MINUTES_PER_HOUR);
  const days = Math.floor(hours / HOURS_PER_DAY);

  if (days > 0) return `${days}d ${hours % HOURS_PER_DAY}h`;
  if (hours > 0) return `${hours}h ${mins % MINUTES_PER_HOUR}m`;
  return `${mins}m`;
}

function splitMessage(text, maxLen) {
  if (text.length === 0) return [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLen;
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start) {
        chunks.push(text.slice(start, lastNewline));
        start = lastNewline + 1;
        continue;
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function buildTranscript(messages) {
  const lines = messages.map((m, i) => {
    const time = m.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `[ref${i + 1}][${time}] ${m.author.username}: ${m.content}`;
  });
  const urlMap = messages.map((m, i) => `ref${i + 1}: ${m.url}`).join("\n");
  return lines.join("\n") + "\n\nMessage URLs (use in bullets):\n" + urlMap;
}

function resolveRefs(summary, messages) {
  return summary.replace(/\bref(\d+)\b/gi, (match, n) => {
    const msg = messages[parseInt(n, 10) - 1];
    return msg ? msg.url : match;
  });
}

function parseTimeframe(text) {
  const match = TIMEFRAME_PATTERN.exec(text);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = match[2][0].toLowerCase();
  if (unit === "m") return amount * MS_PER_MINUTE;
  if (unit === "h") return amount * MS_PER_MINUTE * MINUTES_PER_HOUR;
  if (unit === "d") return amount * MS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY;
  return null;
}

module.exports = { formatTimeDiff, splitMessage, buildTranscript, resolveRefs, parseTimeframe };
