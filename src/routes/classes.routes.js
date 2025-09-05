// src/routes/classes.routes.js
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/* قائمة الصفوف */
router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, grade, section FROM classes ORDER BY id ASC'
    );
    res.json({ ok: true, classes: rows, data: rows });
  } catch (e) {
    console.error('classes list error', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/* مواد صف محدّد */
router.get('/:classId/subjects', async (req, res) => {
  try {
    const classId = Number(req.params.classId);
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.hours, s.description, s.class_id, s.teacher_id,
              u.full_name AS teacher_name
       FROM subjects s
       LEFT JOIN users u ON u.id = s.teacher_id
       WHERE s.class_id = ?
       ORDER BY id ASC`,
      [classId]
    );
    res.json({ ok: true, subjects: rows, data: rows });
  } catch (e) {
    console.error('class.subjects error', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/* إنشاء مادة تحت صف معيّن */
router.post('/:classId/subjects', async (req, res) => {
  try {
    const classId = Number(req.params.classId);
    const name = (req.body?.name || '').trim();
    const hours = Number(req.body?.hours ?? 1);
    const teacherAny = req.body?.teacher_id ?? req.body?.teacherId ?? req.body?.teacher;
    const teacherId = (teacherAny === '' || teacherAny === undefined) ? null : (teacherAny === null ? null : Number(teacherAny));

    if (!name || !classId) {
      return res.status(400).json({ ok: false, message: 'name and class_id are required' });
    }
const [dup] = await pool.query(
  'SELECT id FROM subjects WHERE class_id = ? AND LOWER(name)=LOWER(?) LIMIT 1',
  [classId, name.toLowerCase()]
);
if (dup.length) {
  return res.status(409).json({ ok:false, message:'Subject already exists in this class' });
}

    const [ins] = await pool.query(
      'INSERT INTO subjects (name, hours, class_id, teacher_id) VALUES (?, ?, ?, ?)',
      [name, hours, classId, teacherId]
    );
    const id = ins.insertId;

    const [rows] = await pool.query(
      'SELECT id, name, hours, description, class_id, teacher_id FROM subjects WHERE id = ? LIMIT 1',
      [id]
    );
    const row = rows[0];
    // top-level id أيضًا
    res.status(201).json({ ok: true, id, ...row, data: row });
  } catch (e) {
    console.error('class.subjects.create error', e);
    if (e?.code === 'ER_DUP_ENTRY') {
     return res.status(409).json({ ok: false, message: 'Subject already exists in this class' }); 
   } 
  res.status(500).json({ ok: false, message: 'Server error' });
  }
});

export default router;
