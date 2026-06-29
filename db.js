const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS last_summary (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      summarized_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    )
  `);
}

async function getLastSummaryTime(userId, channelId) {
  try {
    const { rows } = await pool.query(
      "SELECT summarized_at FROM last_summary WHERE user_id = $1 AND channel_id = $2",
      [userId, channelId]
    );
    return rows.length ? new Date(Number(rows[0].summarized_at)) : null;
  } catch (err) {
    console.warn("getLastSummaryTime failed, falling back:", err);
    return null;
  }
}

async function saveLastSummary(userId, channelId) {
  try {
    await pool.query(
      `INSERT INTO last_summary (user_id, channel_id, summarized_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, channel_id) DO UPDATE SET summarized_at = EXCLUDED.summarized_at`,
      [userId, channelId, Date.now()]
    );
  } catch (err) {
    console.error("Failed to save last summary:", err);
  }
}

module.exports = { init, getLastSummaryTime, saveLastSummary };
