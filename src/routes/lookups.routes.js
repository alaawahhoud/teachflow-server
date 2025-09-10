// src/routes/lookups.routes.js
import { Router } from "express";
import pool from "../db.js";

const router = Router();

/**
 * GET /api/lookups/teacher-profiles
 * returns: [{ user_id, display_name, class_id }]
 */
router.get("/teacher-profiles", async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        u.id AS user_id,
        COALESCE(tp.display_name, u.full_name, u.name) AS display_name,
        COALESCE(
          tp.class_id,
          tp.homeroom_class_id,
          tp.main_class_id,
          tp.assigned_class_id
        ) AS class_id
      FROM users u
      LEFT JOIN teacher_profile tp ON tp.user_id = u.id
      WHERE u.role IN ('Teacher','Coordinator','Principal','Admin','IT Support','Cycle Head')
      ORDER BY display_name ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error("[lookups/teacher-profiles]", e);
    res.status(500).json({ message: "failed to load teacher profiles" });
  }
});

export default router;
