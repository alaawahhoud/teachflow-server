import fs from "fs/promises";
import bcrypt from "bcrypt";
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

const saltRounds = 10;

(async () => {
  try {
    const raw = await fs.readFile("./data/users.json", "utf8");
    const users = JSON.parse(raw);

    for (const u of users) {
      let pwd = u.password || "1234";
      if (!String(pwd).startsWith("$2")) {
        pwd = await bcrypt.hash(pwd, saltRounds);
      }

      await pool.execute(
        `INSERT INTO users (external_id, full_name, email, username, password, role, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           full_name=VALUES(full_name),
           email=VALUES(email),
           username=VALUES(username),
           password=VALUES(password),
           role=VALUES(role),
           status=VALUES(status)`,
        [
          u.id ?? null,
          u.full_name,
          u.email,
          u.username,
          pwd,
          (u.role === "Admin") ? "Admin" : (u.role || "Teacher"),
          (u.status?.toUpperCase() === "ACTIVE") ? "Active" : "Inactive",
        ]
      );
    }

    console.log("Users seeding done.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
