// controllers/subjects.controller.js
import pool from "../db.js";

/* ========== LIST (يدعم ?class_id=) ========== */
export async function listSubjects(req, res, next) {
  try {
    const classId = req.query.class_id || req.query.classId || req.query.class;
    if (classId) {
      const [rows] = await pool.query(
        `SELECT s.id, s.name, s.description, s.hours, s.class_id,
                ts.user_id AS teacher_id, u.full_name AS teacher_name
           FROM subjects s
           LEFT JOIN teacher_subjects ts ON ts.subject_id = s.id
           LEFT JOIN users u ON u.id = ts.user_id
          WHERE s.class_id = ?
          ORDER BY s.name`,
        [Number(classId)]
      );
      return res.json(rows);
    }

    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.description, s.hours, s.class_id
         FROM subjects s
        ORDER BY s.name`
    );
    res.json(rows);
  } catch (e) { next(e); }
}

/* ========== CREATE (يدعم desc/description, hours, class_id, teacher_id) ========== */
export async function createSubject(req, res, next) {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || req.body?.desc || "").trim() || null;
    const hours = Number(req.body?.hours || 1);
    const classId = req.body?.class_id || req.body?.classId || null;
    const teacherId = req.body?.teacher_id || req.body?.teacherId || null;

    if (!name) return res.status(400).json({ message: "name is required" });

    const [r] = await pool.query(
      `INSERT INTO subjects (name, description, hours, class_id) VALUES (?, ?, ?, ?)`,
      [name, description, hours || 1, classId || null]
    );

    // اربط الأستاذ اختياريًا إذا مبعوث
    if (teacherId) {
      await pool.query(
        `INSERT IGNORE INTO teacher_subjects (user_id, subject_id) VALUES (?, ?)`,
        [Number(teacherId), r.insertId]
      );
    }

    res.status(201).json({
      id: r.insertId,
      name,
      description,
      hours: hours || 1,
      class_id: classId ? Number(classId) : null,
      teacher_id: teacherId ? Number(teacherId) : null,
    });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ message: "Subject already exists" });
    next(e);
  }
}

/* ========== UPDATE ========== */
export async function updateSubject(req, res, next) {
  try {
    const id = Number(req.params.id);
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || req.body?.desc || "").trim() || null;
    const hours = Number(req.body?.hours || 1);
    const classId = req.body?.class_id || req.body?.classId || null;
    const teacherId = req.body?.teacher_id ?? req.body?.teacherId ?? undefined; // ممكن يكون null

    if (!name) return res.status(400).json({ message: "name is required" });

    const [r] = await pool.query(
      `UPDATE subjects SET name = ?, description = ?, hours = ?, class_id = ? WHERE id = ?`,
      [name, description, hours || 1, classId || null, id]
    );
    if (!r.affectedRows) return res.status(404).json({ message: "Subject not found" });

    // حدّث الربط مع الأستاذ (اختياري)
    if (teacherId !== undefined) {
      // امسح كل ربط قديم ثم أضف الجديد لو موجود
      await pool.query(`DELETE FROM teacher_subjects WHERE subject_id = ?`, [id]);
      if (teacherId) {
        await pool.query(
          `INSERT IGNORE INTO teacher_subjects (user_id, subject_id) VALUES (?, ?)`,
          [Number(teacherId), id]
        );
      }
    }

    res.json({
      id,
      name,
      description,
      hours: hours || 1,
      class_id: classId ? Number(classId) : null,
      teacher_id: teacherId ? Number(teacherId) : null,
    });
  } catch (e) { next(e); }
}

/* ========== DELETE ========== */
export async function deleteSubject(req, res, next) {
  try {
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM teacher_subjects WHERE subject_id = ?`, [id]);
    const [r] = await pool.query(`DELETE FROM subjects WHERE id = ?`, [id]);
    if (!r.affectedRows) return res.status(404).json({ message: "Subject not found" });
    res.status(204).end();
  } catch (e) { next(e); }
}

/* ========== SUBJECT -> TEACHERS ========== */
export async function listSubjectTeachers(req, res, next) {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      `SELECT u.id, u.full_name AS name, u.username, u.email, u.role, u.status
         FROM teacher_subjects ts
         JOIN users u ON u.id = ts.user_id
        WHERE ts.subject_id = ?
        ORDER BY u.full_name`, [id]
    );
    res.json(rows);
  } catch (e) { next(e); }
}

export async function addSubjectTeacher(req, res, next) {
  try {
    const subjectId = Number(req.params.id);
    const userId = Number(req.params.userId);
    await pool.query(
      `INSERT IGNORE INTO teacher_subjects (user_id, subject_id) VALUES (?, ?)`,
      [userId, subjectId]
    );
    res.status(201).json({ subject_id: subjectId, user_id: userId });
  } catch (e) { next(e); }
}

export async function removeSubjectTeacher(req, res, next) {
  try {
    const subjectId = Number(req.params.id);
    const userId = Number(req.params.userId);
    await pool.query(
      `DELETE FROM teacher_subjects WHERE user_id = ? AND subject_id = ?`,
      [userId, subjectId]
    );
    res.status(204).end();
  } catch (e) { next(e); }
}
