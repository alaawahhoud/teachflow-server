import fs from "fs/promises";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const pool = await mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "teachflow",
  waitForConnections: true,
  connectionLimit: 10,
});

async function externalIdToUserId(externalId) {
  const [rows] = await pool.execute(
    "SELECT id FROM users WHERE external_id = ? LIMIT 1",
    [externalId]
  );
  return rows.length ? rows[0].id : null;
}

(async () => {
  try {
    const raw = await fs.readFile("./data/attendance.json", "utf8");
    const items = JSON.parse(raw);

    for (const a of items) {
      const userId = await externalIdToUserId(a.teacher_id);
      if (!userId) {
        console.warn("Skip attendance: unknown teacher", a.teacher_id);
        continue;
      }

      await pool.execute(
        `INSERT INTO attendance (user_id, date, status, time_in, time_out)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, a.date, a.status, a.time_in || null, a.time_out || null]
      );
    }

    console.log("Attendance seeding done.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
