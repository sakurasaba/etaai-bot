const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "etaai.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS last_summary (
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    summarized_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, channel_id)
  )
`);

const stmtGet = db.prepare(
  "SELECT summarized_at FROM last_summary WHERE user_id = ? AND channel_id = ?"
);

const stmtUpsert = db.prepare(`
  INSERT INTO last_summary (user_id, channel_id, summarized_at)
  VALUES (?, ?, ?)
  ON CONFLICT (user_id, channel_id) DO UPDATE SET summarized_at = excluded.summarized_at
`);

function getLastSummaryTime(userId, channelId) {
  const row = stmtGet.get(userId, channelId);
  return row ? new Date(row.summarized_at) : null;
}

function saveLastSummary(userId, channelId) {
  stmtUpsert.run(userId, channelId, Date.now());
}

module.exports = { getLastSummaryTime, saveLastSummary };
