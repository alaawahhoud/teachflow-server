import { Router } from "express";
import pool from "../db.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const [grades]   = await pool.query("SELECT id, name FROM classes ORDER BY id ASC");
    const [subjects] = await pool.query("SELECT id, name FROM subjects ORDER BY id ASC");
    res.json({
      grades:   [{ id: "All", name: "All" }, ...grades.map(g => ({ id: String(g.id), name: g.name }))],
      subjects: [{ id: "All", name: "All" }, ...subjects.map(s => ({ id: String(s.id), name: s.name }))],
    });
  } catch (e) {
    console.error("GET /api/filters", e);
    res.status(500).json({ error: "Failed to fetch filters" });
  }
});

export default router;
