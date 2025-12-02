# Database Setup for Wheel Horse Spin Leaderboard

## Overview

PostgreSQL database on Render.com for storing race results and leaderboards.

## Database Schema

### Table: `races`

Stores individual race records with complete results.

```sql
CREATE TABLE races (
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

CREATE INDEX idx_races_room_id ON races(room_id);
CREATE INDEX idx_races_timestamp ON races(race_timestamp DESC);
CREATE INDEX idx_races_winner ON races(winner_username);
```

### Table: `race_participants`

Stores individual player (human and bot) results for each race, plus human-only metadata used for last-place and room-level stats.

```sql
CREATE TABLE race_participants (
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

CREATE INDEX idx_participants_race_id ON race_participants(race_id);
CREATE INDEX idx_participants_player_id ON race_participants(player_id);
CREATE INDEX idx_participants_username ON race_participants(username);
CREATE INDEX idx_participants_last_human ON race_participants(is_last_human);
```

### (Optional / Future) Table: `player_stats`

Aggregated statistics for faster leaderboard queries (not currently auto-populated by server).

```sql
CREATE TABLE player_stats (
    username VARCHAR(255) PRIMARY KEY,
    total_races INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    total_podiums INTEGER DEFAULT 0,
    best_time_seconds DECIMAL(10, 3),
    average_position DECIMAL(5, 2),
    last_race_timestamp TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_player_stats_wins ON player_stats(total_wins DESC);
CREATE INDEX idx_player_stats_best_time ON player_stats(best_time_seconds ASC);
```

## Render.com Database Setup

### 1. Deployment via render.yaml

Your `render.yaml` already includes the database configuration:

```yaml
databases:
  - name: wheel-horse-spin-db
    plan: free
    region: frankfurt
```

When you push to GitHub and deploy via Render:

- Render automatically provisions the PostgreSQL database
- The database is in Frankfurt (same region as your server)
- Free tier includes: 256MB RAM, 1GB storage, limited hours per month

### 2. Access Database Credentials

**Via Render Dashboard:**

1. Go to <https://dashboard.render.com>
2. Navigate to your database: `wheel-horse-spin-db`
3. Click "Info" tab to see:
   - Internal Database URL (for your web service)
   - External Database URL (for local development/psql)
   - Username, Password, Database Name, Port

**Via Environment Variable:**
Your web service automatically receives `DATABASE_URL` environment variable with the connection string:

```
postgresql://username:password@hostname:port/database
```

### 3. Initialize Database Schema

**Option A: Manual via psql (from local machine)**

```bash
# Install psql locally if not available
brew install postgresql  # macOS
# or
sudo apt-get install postgresql-client  # Linux

# Connect to Render database using External URL
psql <EXTERNAL_DATABASE_URL>

# Run schema creation commands from above
\i schema.sql

# Or paste SQL directly
CREATE TABLE races (...);
CREATE TABLE race_participants (...);
```

**Option B: Via migration script in Node.js**
Create `multiplayer-race/db/migrate.js`:

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create races table
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

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_races_room_id ON races(room_id);
      CREATE INDEX IF NOT EXISTS idx_races_timestamp ON races(race_timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_races_winner ON races(winner_username);
    `);

    // Create race_participants table
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
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_participants_race_id ON race_participants(race_id);
      CREATE INDEX IF NOT EXISTS idx_participants_player_id ON race_participants(player_id);
      CREATE INDEX IF NOT EXISTS idx_participants_username ON race_participants(username);
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
```

Run migration:

```bash
cd multiplayer-race
npm install pg
node db/migrate.js
```

**Option C: Auto-migrate on server startup**
Add to `server.js` startup:

```javascript
const { Pool } = require('pg');

// Only run if DATABASE_URL exists
if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // Run migration on startup (idempotent)
  require('./db/migrate').migrate(pool).catch(console.error);
}
```

### 4. Using Database in Application

**Install pg library:**

```bash
cd multiplayer-race
npm install pg
```

**Example: Save race results (already implemented in `server.js`)**

```javascript
const { Pool } = require('pg');

let dbPool = null;
if (process.env.DATABASE_URL) {
  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function saveRaceResults(room, results) {
  if (!dbPool) return; // Skip if no database configured

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    // Insert race record
    const raceResult = await client.query(`
      INSERT INTO races (
        race_id, room_id, race_duration_seconds, total_participants,
        human_players_count, bot_count, winner_id, winner_username,
        winner_time_seconds, last_place_time_seconds
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      room.raceId,
      room.id,
      results.results[results.results.length - 1].finishSeconds,
      results.results.length,
      results.results.filter(r => !r.isBot).length,
      results.results.filter(r => r.isBot).length,
      results.results[0].id,
      results.results[0].username,
      results.results[0].finishSeconds,
      results.results[results.results.length - 1].finishSeconds
    ]);

    const raceDbId = raceResult.rows[0].id;

    // Insert participant records
    for (let i = 0; i < results.results.length; i++) {
      const p = results.results[i];
      await client.query(`
        INSERT INTO race_participants (
          race_id, player_id, username, is_bot, lane,
          finish_time_seconds, delta_from_winner_seconds, final_position
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        raceDbId,
        p.id,
        p.username,
        p.isBot || false,
        p.lane,
        p.finishSeconds,
        p.deltaSeconds,
        i + 1
      ]);
    }

    await client.query('COMMIT');
    console.log(`[DB] Saved race results for raceId=${room.raceId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DB] Error saving race results:', err);
  } finally {
    client.release();
  }
}

// Call in endRace function:
function endRace(room, results) {
  room.phase = 'results';
  // ... existing code ...
  saveRaceResults(room, results).catch(console.error);
}
```

### 5. Query Examples

**Get top 10 winners by total wins:**

```sql
SELECT username, total_wins, total_races, best_time_seconds
FROM player_stats
ORDER BY total_wins DESC
LIMIT 10;
```

**Get fastest lap times (all-time):**

```sql
SELECT r.winner_username, r.winner_time_seconds, r.race_timestamp, r.room_id
FROM races r
ORDER BY r.winner_time_seconds ASC
LIMIT 10;
```

**Get player history:**

```sql
SELECT r.race_timestamp, rp.final_position, rp.finish_time_seconds,
       rp.delta_from_winner_seconds, r.total_participants
FROM race_participants rp
JOIN races r ON rp.race_id = r.id
WHERE rp.username = 'PlayerName' AND rp.is_bot = false
ORDER BY r.race_timestamp DESC
LIMIT 20;
```

**Room-specific leaderboard:**

```sql
SELECT r.winner_username, COUNT(*) as wins, MIN(r.winner_time_seconds) as best_time
FROM races r
WHERE r.room_id = 'dev'
GROUP BY r.winner_username
ORDER BY wins DESC, best_time ASC
LIMIT 10;
```

## Render.com Management

### Database Dashboard Features

- **Metrics**: CPU, memory, storage usage
- **Backups**: Manual backups on free tier (automatic on paid plans)
- **Logs**: Query logs, error logs
- **Connection info**: Internal/external URLs, credentials

### Free Tier Limitations

- **Storage**: 1GB max
- **RAM**: 256MB
- **Uptime**: Database may spin down after inactivity (restarts automatically)
- **Connections**: Limited concurrent connections (~20)
- **No automatic backups** (manual backups only)

### Backup Strategy (Free Tier)

```bash
# Manual backup via pg_dump
pg_dump <EXTERNAL_DATABASE_URL> > backup_$(date +%Y%m%d).sql

# Restore from backup
psql <EXTERNAL_DATABASE_URL> < backup_20251201.sql
```

### Monitoring Database Size

```sql
-- Check database size
SELECT pg_size_pretty(pg_database_size('database_name'));

-- Check table sizes
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Next Steps

1. Deploy to Render (auto-provisions DB via `render.yaml`).
2. Confirm `DATABASE_URL` injected into service env.
3. Start server (auto-migration runs if DB present).
4. Use `/api/health` to verify `db.ok`.
5. Generate demo data: `npm run db:seed` (room `dev-8`).
6. Consume leaderboard endpoints from client sidebar.
7. Optionally implement aggregated `player_stats` materialization for performance.

## Production Considerations

- Upgrade tier for automatic backups & higher connection limits.
- Introduce migration versioning (e.g. `node-pg-migrate`) if schema evolves.
- Add periodic vacuum / analyze monitoring.
- Consider materialized views for heavy summary endpoints.
- Potentially move boost rotation & authoritative physics server-side entirely for anti-cheat.
