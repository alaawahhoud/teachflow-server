// server/routes/attendance.routes.js
import express from "express";
import pool from "../db.js";

const r = express.Router();

// لستة حضور مع فلاتر اختيارية: from, to, user_id, device_id
r.get("/", async (req, res) => {
  try {
    const { from, to, user_id, device_id } = req.query;
    const where = [];
    const params = [];

    if (from)      { where.push("a.matched_at >= ?"); params.push(from); }
    if (to)        { where.push("a.matched_at <= ?"); params.push(to); }
    if (user_id)   { where.push("a.user_id = ?");     params.push(user_id); }
    if (device_id) { where.push("a.device_id = ?");   params.push(device_id); }

    const sql = `
      SELECT a.id, a.user_id, u.full_name AS user_name, a.device_id, a.page_id, a.score, a.matched_at
      FROM attendance a
      LEFT JOIN users u ON u.id = a.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY a.matched_at DESC
      LIMIT 500
    `;
    const [rows] = await pool.query(sql, params);
    res.json({ rows });
  } catch (e) {
    console.error("[attendance]", e);
    res.status(500).json({ message: "attendance list failed" });
  }
});

export default r;
