// src/routes/students.routes.js
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/* GET /api/students?grade=CLASS_ID|All&subject=SUBJECT_ID|All&week=1..45&q=&status= */
router.get('/', async (req, res) => {
  try {
    const classId = (req.query.grade && req.query.grade !== 'All') ? Number(req.query.grade) : null;
    const subjectId = (req.query.subject && req.query.subject !== 'All') ? Number(req.query.subject) : null;
    const week = Number(req.query.week || 1);
    const q = (req.query.q || '').trim();
    const statusFilter = (req.query.status && req.query.status !== 'All') ? String(req.query.status) : null;

    // الأساس: طلاب مع صفوفهم
    let sql = `
      SELECT s.id, s.name,
             c.id   AS class_id,
             c.name AS grade,
             ${subjectId ? '(SELECT name FROM subjects WHERE id = ?) AS subject' : `'' AS subject`},
             ss.status,
             ss.note
      FROM students s
      JOIN classes c ON c.id = s.class_id
      LEFT JOIN student_status_weeks ss
        ON ss.student_id = s.id
       ${subjectId ? 'AND ss.subject_id = ?' : ''}
       AND ss.week_number = ?
      WHERE 1=1
    `;
    const params = [];
    if (subjectId) params.push(subjectId); // للـ SELECT subject
    if (subjectId) params.push(subjectId); // LEFT JOIN
    params.push(week);

    if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
    if (q)       { sql += ' AND s.name LIKE ?';  params.push(`%${q}%`); }
    if (statusFilter) { sql += ' AND ss.status = ?'; params.push(statusFilter); }

    sql += ' ORDER BY s.name ASC';

    const [rows] = await pool.query(sql, params);
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      status: r.status || '',
      note: r.note || '',
      grade: r.grade,
      subject: r.subject || '',
    })));
  } catch (e) {
    console.error('students.weekly.list error', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/* PUT /api/students/:id  body: { status, note, subject_id, week }  → UPSERT */
router.put('/:id', async (req, res) => {
  try {
    const studentId = Number(req.params.id);
    const subjectId = Number(req.body.subject_id || req.body.subject || 0);
    const week = Number(req.body.week || 0);
    const status = String(req.body.status || '').trim();
    const note = (req.body.note ?? '') + '';

    if (!studentId || !subjectId || !week) {
      return res.status(400).json({ ok: false, message: 'student_id, subject_id and week are required' });
    }

    await pool.query(
      `INSERT INTO student_status_weeks (student_id, subject_id, week_number, status, note)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), updated_at = CURRENT_TIMESTAMP`,
      [studentId, subjectId, week, status, note]
    );

    // رجّع السطر المحدّث بشكل متوافق مع الواجهة
    const [[row]] = await pool.query(
      `SELECT s.id, s.name, c.name AS grade, sub.name AS subject, ss.status, ss.note
         FROM students s
         JOIN classes c ON c.id = s.class_id
         JOIN subjects sub ON sub.id = ?
         LEFT JOIN student_status_weeks ss
           ON ss.student_id = s.id AND ss.subject_id = sub.id AND ss.week_number = ?
        WHERE s.id = ?
        LIMIT 1`,
      [subjectId, week, studentId]
    );

    res.json({
      id: row?.id || studentId,
      name: row?.name || '',
      grade: row?.grade || '',
      subject: row?.subject || '',
      status: row?.status || status,
      note: row?.note ?? note
    });
  } catch (e) {
    console.error('students.weekly.upsert error', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

export default router;
