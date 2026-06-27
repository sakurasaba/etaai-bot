const MS_PER_MINUTE = 60000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

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
      if (lastNewline > start) end = lastNewline;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

module.exports = { formatTimeDiff, splitMessage };
