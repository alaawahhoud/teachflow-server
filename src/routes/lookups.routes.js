// src/routes/lookups.routes.js
import { Router } from "express";
import pool from "../db.js";

const router = Router();

/**
 * GET /api/lookups/teacher-profiles
 * بيرجع: [{ user_id, display_name, class_id, class_ids }]
 * - display_name: من teacher_profiles.full_name أو users.full_name...
 * - class_ids: مجمعة من teacher_class_subjects و subjects و teacher_profiles.class_ids (إن وجدت)
 * - class_id: أول قيمة من class_ids (لتوافق الواجهة الحالية)
 */
router.get("/teacher-profiles", async (_req, res) => {
  try {
    // 1) كل المدرّسين
    const [teachers] = await pool.query(`
      SELECT u.id AS user_id,
             COALESCE(u.full_name, u.username, u.email, u.name) AS user_display,
             u.role
      FROM users u
      WHERE u.role IN ('Teacher','Coordinator','Principal','Admin','IT Support','Cycle Head')
      ORDER BY user_display ASC
    `);
    if (!teachers?.length) return res.json([]);

    const ids = teachers.map(t => t.user_id);

    // 2) teacher_profiles (جمع)
    const [tps] = await pool.query(
      `SELECT tp.*
       FROM teacher_profiles tp
       WHERE tp.user_id IN (${ids.map(()=>"?").join(",")})`,
      ids
    );
    const tpMap = new Map((tps || []).map(r => [Number(r.user_id), r]));

    // 3) تجميع الصفوف من teacher_class_subjects
    const [tcs] = await pool.query(
      `SELECT teacher_id, class_id
       FROM teacher_class_subjects
       WHERE teacher_id IN (${ids.map(()=>"?").join(",")})`,
      ids
    );

    // 4) ومن subjects (teacher_id/class_id)
    const [subj] = await pool.query(
      `SELECT teacher_id, class_id
       FROM subjects
       WHERE teacher_id IN (${ids.map(()=>"?").join(",")})
         AND class_id IS NOT NULL`,
      ids
    );

    // Build: teacherId -> Set<classId>
    const classMap = new Map();
    for (const id of ids) classMap.set(Number(id), new Set());
    for (const r of (tcs || [])) if (r.class_id) classMap.get(Number(r.teacher_id))?.add(Number(r.class_id));
    for (const r of (subj || [])) if (r.class_id) classMap.get(Number(r.teacher_id))?.add(Number(r.class_id));

    // 5) حاول نقرأ class_ids من teacher_profiles (json أو CSV)
    for (const [uid, tp] of tpMap.entries()) {
      const raw = tp.class_ids || tp.class_ids_csv || null;
      if (!raw) continue;
      try {
        const arr = Array.isArray(raw) ? raw : JSON.parse(raw);
        (arr || []).forEach(c => {
          const n = Number(c);
          if (Number.isFinite(n)) classMap.get(uid)?.add(n);
        });
      } catch {
        // CSV
        String(raw)
          .split(",")
          .map(s => Number(s.trim()))
          .filter(n => Number.isFinite(n))
          .forEach(n => classMap.get(uid)?.add(n));
      }
    }

    // 6) جهّز الإخراج
    const out = teachers.map(t => {
      const tp = tpMap.get(Number(t.user_id)) || {};
      const display =
        tp.full_name ||
        tp.display_name ||
        t.user_display ||
        String(t.user_id);

      const cls = Array.from(classMap.get(Number(t.user_id)) || []);
      return {
        user_id: Number(t.user_id),
        display_name: display,
        class_ids: cls,
        class_id: cls.length ? cls[0] : null, // لتوافق الفرونت الحالي
      };
    });

    res.json(out);
  } catch (e) {
    console.error("[lookups/teacher-profiles]", e);
    res.status(500).json({ message: "failed to load teacher profiles", error: e?.sqlMessage || e?.message || String(e) });
  }
});

export default router;
