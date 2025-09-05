import { Router } from "express";
import pool from "../db.js";

const router = Router();

/* 
 GET /api/student-status-weeks?subject_id=..&week_number=..&class_id=?
 يرجّع صفوف الجدول للـ subject/week المطلوبين.
 إذا انبعث class_id بيفلتر الطلاب عبر join مع students.class_id
*/
router.get("/", async (req, res) => {
  try {
    const subjectId = Number(req.query.subject_id);
    const weekNum   = Number(req.query.week_number);
    const classId   = req.query.class_id ? Number(req.query.class_id) : null;

    if (!subjectId || !weekNum) {
      return res.status(400).json({ ok: false, message: "subject_id and week_number are required" });
    }

    let sql = `
      SELECT ssw.student_id, ssw.subject_id, ssw.week_number, ssw.status, ssw.note, ssw.updated_at
      FROM student_status_weeks ssw
    `;
    const params = [];

    if (classId) {
      sql += ` INNER JOIN students st ON st.id = ssw.student_id `;
    }

    sql += ` WHERE ssw.subject_id = ? AND ssw.week_number = ? `;
    params.push(subjectId, weekNum);

    if (classId) {
      sql += ` AND st.class_id = ? `;
      params.push(classId);
    }

    sql += ` ORDER BY ssw.student_id ASC`;

    const [rows] = await pool.query(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error("student-status-weeks.list error", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/*
 PUT /api/student-status-weeks
 body: { student_id, subject_id, week_number, status, note }
 Upsert حسب (student_id, subject_id, week_number)
*/
router.put("/", async (req, res) => {
  try {
    const student_id = Number(req.body?.student_id);
    const subject_id = Number(req.body?.subject_id);
    const week_number = Number(req.body?.week_number);
    const status = (req.body?.status ?? "") + "";
    const note   = (req.body?.note ?? "") + "";

    if (!student_id || !subject_id || !week_number) {
      return res.status(400).json({ ok: false, message: "student_id, subject_id, and week_number are required" });
    }

    const sql = `
      INSERT INTO student_status_weeks (student_id, subject_id, week_number, status, note, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        note   = VALUES(note),
        updated_at = NOW()
    `;
    await pool.query(sql, [student_id, subject_id, week_number, status, note]);

    res.json({ ok: true, data: { student_id, subject_id, week_number, status, note } });
  } catch (e) {
    console.error("student-status-weeks.upsert error", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/*
 POST /api/student-status-weeks/bulk
 body: { rows: [{ student_id, subject_id, week_number, status, note }, ...] }
 Bulk upsert
*/
router.post("/bulk", async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ ok: false, message: "rows array is required" });
    }

    // نظّف البيانات وخلّي الصحيح فقط
    const clean = rows
      .map((r) => ({
        student_id: Number(r.student_id),
        subject_id: Number(r.subject_id),
        week_number: Number(r.week_number),
        status: (r.status ?? "") + "",
        note: (r.note ?? "") + "",
      }))
      .filter((r) => r.student_id && r.subject_id && r.week_number);

    if (!clean.length) {
      return res.status(400).json({ ok: false, message: "no valid rows" });
    }

    // بناء bulk query
    const placeholders = clean.map(() => "(?, ?, ?, ?, ?, NOW())").join(", ");
    const params = [];
    for (const r of clean) {
      params.push(r.student_id, r.subject_id, r.week_number, r.status, r.note);
    }

    const sql = `
      INSERT INTO student_status_weeks (student_id, subject_id, week_number, status, note, updated_at)
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        note   = VALUES(note),
        updated_at = NOW()
    `;

    await pool.query(sql, params);
    res.json({ ok: true, count: clean.length });
  } catch (e) {
    console.error("student-status-weeks.bulk error", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
