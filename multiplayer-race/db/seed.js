const { Pool } = require('pg');

async function run() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://whs:whs_password@localhost:5432/wheel_horse_spin';
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    console.log('[seed] begin');
    await client.query('BEGIN');
    // Ensure schema exists via migrate
    const { migrate } = require('./migrate');
    await migrate(pool);

    // Insert a demo race and participants (humans + bots)
    const raceId = `local-${Date.now()}`;
    const raceRes = await client.query(`
      INSERT INTO races (
        race_id, room_id, race_duration_seconds, total_participants,
        human_players_count, bot_count, winner_id, winner_username,
        winner_time_seconds, last_place_time_seconds
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `, [
      raceId,
      'dev',
      12.34,
      4,
      2,
      2,
      1,
      'Alice',
      12.34,
      15.67
    ]);
    const raceDbId = raceRes.rows[0].id;
    const participants = [
      { id: 1, username: 'Alice', isBot: false, lane: 0, time: 12.34, delta: 0.00, finalPos: 1 },
      { id: 2, username: 'Bob', isBot: false, lane: 1, time: 15.67, delta: 3.33, finalPos: 3 },
      { id: 'bot:2', username: 'Bot_1', isBot: true, lane: 2, time: 14.20, delta: 1.86, finalPos: 2 },
      { id: 'bot:3', username: 'Bot_2', isBot: true, lane: 3, time: 16.10, delta: 3.76, finalPos: 4 },
    ];
    const humansSorted = participants.filter(p => !p.isBot).slice().sort((a,b)=>a.time-b.time);
    const humanLast = humansSorted[humansSorted.length-1];
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const humanIndex = p.isBot ? null : humansSorted.findIndex(h => h.id === p.id);
      const humanFinalPos = humanIndex != null && humanIndex >= 0 ? (humanIndex + 1) : null;
      const isLastHuman = !!(humanLast && !p.isBot && humanLast.id === p.id);
      await client.query(`
        INSERT INTO race_participants (
          race_id, player_id, username, is_bot, lane,
          finish_time_seconds, delta_from_winner_seconds, final_position,
          is_last_human, human_final_position, human_finish_time_seconds
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        raceDbId,
        p.id,
        p.username,
        p.isBot,
        p.lane,
        p.time,
        p.delta,
        p.finalPos,
        isLastHuman,
        humanFinalPos,
        p.isBot ? null : p.time
      ]);
    }

    await client.query('COMMIT');
    console.log('[seed] done');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] error', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
