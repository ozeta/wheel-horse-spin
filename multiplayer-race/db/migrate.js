const { Pool } = require('pg');

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // races table
    await client.query(`
      CREATE TABLE IF NOT EXISTS races (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        race_id VARCHAR(255) NOT NULL,
        room_id VARCHAR(255) NOT NULL,
        race_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        race_duration_seconds DECIMAL(10, 3) NOT NULL,
        total_participants INTEGER NOT NULL,
        human_players_count INTEGER NOT NULL,
        bot_count INTEGER NOT NULL,
        winner_id VARCHAR(255),
        winner_username VARCHAR(255),
        winner_time_seconds DECIMAL(10, 3) NOT NULL,
        last_place_time_seconds DECIMAL(10, 3) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_races_room_id ON races(room_id);
      CREATE INDEX IF NOT EXISTS idx_races_timestamp ON races(race_timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_races_winner ON races(winner_username);
    `);

    // race_participants table
    await client.query(`
      CREATE TABLE IF NOT EXISTS race_participants (
        id SERIAL PRIMARY KEY,
        race_id UUID REFERENCES races(id) ON DELETE CASCADE,
        player_id VARCHAR(255) NOT NULL,
        username VARCHAR(255) NOT NULL,
        is_bot BOOLEAN DEFAULT FALSE,
        lane INTEGER NOT NULL,
        finish_time_seconds DECIMAL(10, 3) NOT NULL,
        delta_from_winner_seconds DECIMAL(10, 3) NOT NULL,
        final_position INTEGER NOT NULL,
        is_last_human BOOLEAN DEFAULT FALSE,
        human_final_position INTEGER,
        human_finish_time_seconds DECIMAL(10, 3),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_participants_race_id ON race_participants(race_id);
      CREATE INDEX IF NOT EXISTS idx_participants_player_id ON race_participants(player_id);
      CREATE INDEX IF NOT EXISTS idx_participants_username ON race_participants(username);
      CREATE INDEX IF NOT EXISTS idx_participants_last_human ON race_participants(is_last_human);
    `);

    // Ensure columns exist in case of prior deployments
    await client.query(`
      ALTER TABLE race_participants ADD COLUMN IF NOT EXISTS is_last_human BOOLEAN DEFAULT FALSE;
      ALTER TABLE race_participants ADD COLUMN IF NOT EXISTS human_final_position INTEGER;
      ALTER TABLE race_participants ADD COLUMN IF NOT EXISTS human_finish_time_seconds DECIMAL(10,3);
    `);

    await client.query('COMMIT');
    console.log('[migrate] Schema ensured');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { migrate };
