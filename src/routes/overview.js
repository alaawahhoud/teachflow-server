import { Router } from "express";
import pool from "../db.js";

const router = Router();

/* GET filters (grades + subjects فقط) */
router.get("/filters", async (_req, res) => {
  try {
    const [grades]   = await pool.query("SELECT DISTINCT grade  FROM student_academic_overview ORDER BY id ASC");
    const [subjects] = await pool.query("SELECT DISTINCT subject FROM student_academic_overview ORDER BY subject");
    res.json({
      grades:   ["All", ...grades.map(r => r.grade)],
      subjects: ["All", ...subjects.map(r => r.subject)],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch filters" });
  }
});

/* GET list with filters (بدون coordinator) */
router.get("/", async (req, res) => {
  try {
    const { grade = "All", subject = "All", q = "", status = "" } = req.query;

    const where = [];
    const params = [];

    if (grade !== "All")   { where.push("grade = ?");     params.push(grade); }
    if (subject !== "All") { where.push("subject = ?");   params.push(subject); }
    if (q)                 { where.push("LOWER(name) LIKE ?");   params.push(`%${q.toLowerCase()}%`); }
    if (status)            { where.push("LOWER(status) LIKE ?"); params.push(`%${status.toLowerCase()}%`); }

    const sql = `
      SELECT id, name, status, note, grade, subject, created_at
      FROM student_academic_overview
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY id ASC
    `;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

/* PUT update status & note (كما هي) */
router.put("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status, note } = req.body || {};
    if (!status) return res.status(400).json({ error: "status is required" });

    await pool.query("UPDATE student_academic_overview SET status = ?, note = ? WHERE id = ?", [status, note ?? null, id]);

    const [rows] = await pool.query(
      "SELECT id, name, status, note, grade, subject, created_at FROM student_academic_overview WHERE id = ?",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update student" });
  }
});

export default router;
