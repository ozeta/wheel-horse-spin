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

    // Insert 10 races with 8 humans and 2 bots each in room 'dev-8'
    const humanNames = ['Alice','Bob','Carol','Dave','Eve','Frank','Grace','Heidi'];
    const botNames = ['Bot_1','Bot_2'];
    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    for (let gameIdx = 0; gameIdx < 20; gameIdx++) {
      const raceId = `dev8-${gameIdx}-${Date.now()}`;
      // Shuffle human names for this race
      const shuffledNames = shuffle([...humanNames]);
      // Pick winner and last human randomly
      const winnerIdx = Math.floor(Math.random() * shuffledNames.length);
      let lastIdx = Math.floor(Math.random() * shuffledNames.length);
      if (lastIdx === winnerIdx) lastIdx = (lastIdx + 1) % shuffledNames.length;
      // Assign finish times
      const baseTime = 12 + Math.random() * 2;
      const humans = shuffledNames.map((name, i) => ({
        id: `h${i+1}`,
        username: name,
        isBot: false,
        lane: i,
        time: +(baseTime + i * (0.8 + Math.random()*0.7)).toFixed(2),
        delta: +(i * (0.8 + Math.random()*0.7)).toFixed(2),
        finalPos: i+1
      }));
      // Swap winner and last finish times
      const winner = humans[winnerIdx];
      const lastHuman = humans[lastIdx];
      // Winner gets lowest time, last gets highest
      const minTime = Math.min(...humans.map(h=>h.time));
      const maxTime = Math.max(...humans.map(h=>h.time));
      winner.time = minTime;
      lastHuman.time = maxTime;
      // Bots finish after humans
      const bots = botNames.map((name, i) => ({
        id: `b${i+1}`,
        username: name,
        isBot: true,
        lane: 8+i,
        time: +(baseTime + 8 + i * (0.8 + Math.random()*0.7)).toFixed(2),
        delta: +(8 + i * (0.8 + Math.random()*0.7)).toFixed(2),
        finalPos: 9+i
      }));
      const participants = [...humans, ...bots];
      // Sort humans by time for positions
      const humansSorted = humans.slice().sort((a,b)=>a.time-b.time);
      // Randomize race day: at least 2 days ago, up to 10 days ago
      const now = Date.now();
      const minDays = 2, maxDays = 10;
      const daysAgo = minDays + Math.floor(Math.random() * (maxDays - minDays + 1));
      const raceTimestamp = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
      const raceRes = await client.query(`
        INSERT INTO races (
          race_id, room_id, race_duration_seconds, total_participants,
          human_players_count, bot_count, winner_id, winner_username,
          winner_time_seconds, last_place_time_seconds, race_timestamp
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id
      `, [
        raceId,
        'dev-8',
        +(lastHuman.time + 2.5).toFixed(2),
        10,
        8,
        2,
        winner.id,
        winner.username,
        winner.time,
        lastHuman.time,
        raceTimestamp
      ]);
      const raceDbId = raceRes.rows[0].id;
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const humanIndex = p.isBot ? null : humansSorted.findIndex(h => h.id === p.id);
        const humanFinalPos = humanIndex != null && humanIndex >= 0 ? (humanIndex + 1) : null;
        const isLastHuman = !!(lastHuman && !p.isBot && lastHuman.id === p.id);
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
