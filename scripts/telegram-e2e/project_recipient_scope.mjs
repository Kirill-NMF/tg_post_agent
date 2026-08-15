import { Pool } from "pg";

const user = process.env.TG_POST_AGENT_E2E_USER_ID;
const started = process.env.TG_POST_AGENT_E2E_STARTED_AT;
if (!/^[1-9][0-9]*$/.test(user ?? "") || !/^[0-9]+(?:\.[0-9]+)?$/.test(started ?? "") || !process.env.DATABASE_URL) throw new Error("configuration");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(`select p.telegram_chat_id::text as recipient, p.active_state as state from projects p join users u on u.id=p.user_id where u.telegram_user_id=$1 and p.created_at >= to_timestamp($2) order by p.created_at desc limit 1`, [user, started]);
  const row = result.rows[0];
  console.log(JSON.stringify({ found: Boolean(row), recipient: row?.recipient ?? null, state: row?.state ?? null }));
} finally { await pool.end(); }
