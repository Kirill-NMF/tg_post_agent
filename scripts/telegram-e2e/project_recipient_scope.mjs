import { Pool } from "pg";

const preflight = process.env.TG_POST_AGENT_SCOPE_PREFLIGHT === "true";
const user = process.env.TG_POST_AGENT_E2E_USER_ID;
const started = process.env.TG_POST_AGENT_E2E_STARTED_AT;
const expectedJobType = process.env.TG_POST_AGENT_E2E_EXPECT_JOB_TYPE;
const supportedExpectedJobTypes = new Set(["GENERATE_DRAFT", "FORMAT_POST"]);
if ((!preflight && (!/^[1-9][0-9]*$/.test(user ?? "") || !/^[0-9]+(?:\.[0-9]+)?$/.test(started ?? "") || (expectedJobType && !supportedExpectedJobTypes.has(expectedJobType)))) || !process.env.DATABASE_URL) throw new Error("configuration");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  if (preflight) {
    await pool.query("select 1");
    console.log(JSON.stringify({ scopeDbReadable: true }));
  } else {
    const result = await pool.query(`
      select p.telegram_chat_id::text as recipient, p.active_state as state,
        case when $3::text is null then null else exists(
          select 1 from jobs j where j.project_id = p.id and j.type::text = $3::text
        ) end as expected_job_enqueued
      from projects p join users u on u.id=p.user_id
      where u.telegram_user_id=$1 and p.created_at >= to_timestamp($2)
      order by p.created_at desc limit 1
    `, [user, started, expectedJobType ?? null]);
    const row = result.rows[0];
    console.log(JSON.stringify({ found: Boolean(row), recipient: row?.recipient ?? null, state: row?.state ?? null, expectedJobEnqueued: row?.expected_job_enqueued ?? false }));
  }
} finally { await pool.end(); }
