// controllers/classes.controller.js
import pool from "../db.js";

/* رجّع كل الصفوف: id, name, grade, section */
export async function listClasses(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, grade, section FROM classes ORDER BY id ASC`
    );
    res.json(rows);
  } catch (e) { next(e); }
}

/* رجّع مواد صف محدد (الفرونت أول شي بيجرّب هالمسار) */
export async function listClassSubjects(req, res, next) {
  try {
    const classId = Number(req.params.id);
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.description, s.hours, s.class_id,
              ts.user_id AS teacher_id, u.full_name AS teacher_name
         FROM subjects s
         LEFT JOIN teacher_subjects ts ON ts.subject_id = s.id
         LEFT JOIN users u ON u.id = ts.user_id
        WHERE s.class_id = ?
        ORDER BY id ASC`,
      [classId]
    );
    res.json(rows);
  } catch (e) { next(e); }
}

/* إنشاء مادة داخل صف (اختياري بس بيريّح الفرونت) */
export async function createClassSubject(req, res, next) {
  try {
    const classId = Number(req.params.id);
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || req.body?.desc || "").trim() || null;
    const hours = Number(req.body?.hours || 1);
    const teacherId = req.body?.teacher_id || req.body?.teacherId || null;

    if (!name) return res.status(400).json({ message: "name is required" });

    const [ins] = await pool.query(
      `INSERT INTO subjects (name, description, hours, class_id) VALUES (?, ?, ?, ?)`,
      [name, description, hours, classId]
    );

    if (teacherId) {
      await pool.query(
        `INSERT IGNORE INTO teacher_subjects (user_id, subject_id) VALUES (?, ?)`,
        [Number(teacherId), ins.insertId]
      );
    }

    res.status(201).json({
      id: ins.insertId, name, description, hours, class_id: classId,
      teacher_id: teacherId ? Number(teacherId) : null
    });
  } catch (e) { next(e); }
}
