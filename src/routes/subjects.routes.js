// src/routes/subjects.routes.js
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/* GET /api/subjects  (يدعم ?class_id=) */
router.get('/', async (req, res) => {
  try {
    const classId = req.query.class_id ? Number(req.query.class_id) : null;
    let sql = `
      SELECT s.id, s.name, s.hours, s.description, s.class_id, s.teacher_id,
             u.full_name AS teacher_name
      FROM subjects s
      LEFT JOIN users u ON u.id = s.teacher_id
    `;
    const params = [];
    if (classId) { sql += ' WHERE s.class_id = ?'; params.push(classId); }
    sql += ' ORDER BY s.name ASC';

    const [rows] = await pool.query(sql, params);
    res.json({ ok: true, subjects: rows, data: rows });
  } catch (e) {
    console.error('subjects.list error', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/* POST /api/subjects  { name, hours?, class_id?, teacher_id? } */
router.post('/', async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    const hours = Number(req.body?.hours ?? 1);
    const class_id = Number(req.body?.class_id ?? req.body?.classId ?? req.body?.class);
    const teacherRaw = req.body?.teacher_id ?? req.body?.teacherId ?? req.body?.teacher;
    const teacher_id = (teacherRaw === '' || teacherRaw === undefined) ? null : (teacherRaw === null ? null : Number(teacherRaw));

    if (!name || !class_id) {
      return res.status(400).json({ ok: false, message: 'name and class_id are required' });
    }
const [dup] = await pool.query(
  'SELECT id FROM subjects WHERE class_id = ? AND LOWER(name)=LOWER(?) LIMIT 1',
  [class_id, name.toLowerCase()]
);
if (dup.length) {
  return res.status(409).json({ ok:false, message:'Subject already exists in this class' });
}

    const [ins] = await pool.query(
      'INSERT INTO subjects (name, hours, class_id, teacher_id) VALUES (?, ?, ?, ?)',
      [name, hours, class_id, teacher_id]
    );
    const id = ins.insertId;

    const [rows] = await pool.query(
      'SELECT id, name, hours, description, class_id, teacher_id FROM subjects WHERE id = ? LIMIT 1',
      [id]
    );
    const row = rows[0];
    // نرجّع id top-level حتى يمشي الكود بالواجهة
    res.status(201).json({ ok: true, id, ...row, data: row });
  } catch (e) {
    console.error('subjects.create error', e);
     if (e?.code === 'ER_DUP_ENTRY') {
return res.status(409).json({ ok: false, message: 'Subject already exists in this class' }); 
  } 
   res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/* PATCH /api/subjects/:id  (أي حقول: name, hours, class_id/class, teacher_id/teacher) */
router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: 'id required' });

    const fields = [];
    const params = [];

    if (req.body?.name !== undefined) { fields.push('name = ?'); params.push(String(req.body.name).trim()); }
    if (req.body?.hours !== undefined) { fields.push('hours = ?'); params.push(Number(req.body.hours)); }

    const classAny = req.body?.class_id ?? req.body?.classId ?? req.body?.class;
    if (classAny !== undefined) {
      if (classAny === null || classAny === '') fields.push('class_id = NULL');
      else { fields.push('class_id = ?'); params.push(Number(classAny)); }
    }

    const teacherAny = req.body?.teacher_id ?? req.body?.teacherId ?? req.body?.teacher;
    if (teacherAny !== undefined) {
      if (teacherAny === null || teacherAny === '') fields.push('teacher_id = NULL');
      else { fields.push('teacher_id = ?'); params.push(Number(teacherAny)); }
    }

    if (!fields.length) return res.status(400).json({ ok: false, message: 'no fields to update' });

    params.push(id);
    await pool.query(`UPDATE subjects SET ${fields.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.query(
      'SELECT id, name, hours, description, class_id, teacher_id FROM subjects WHERE id = ? LIMIT 1',
      [id]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    console.error('subjects.update error', e);
    if (e?.code === 'ER_DUP_ENTRY') {
     return res.status(409).json({ ok: false, message: 'Subject already exists in this class' }); 
   } 
   res.status(500).json({ ok: false, message: 'Server error' }); 
  
  }
});

/* DELETE /api/subjects/:id */
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: 'id required' });
    await pool.query('DELETE FROM subjects WHERE id = ?', [id]);
    res.json({ ok: true, id });
  } catch (e) {
    console.error('subjects.delete error', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/* GET /api/subjects/:id/teachers  (لو بدكها للواجهة) */
router.get('/:id/teachers', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query(
      `SELECT u.id, u.full_name AS name, u.role
       FROM subjects s
       LEFT JOIN users u ON u.id = s.teacher_id
       WHERE s.id = ? AND u.id IS NOT NULL`,
      [id]
    );
    res.json({ ok: true, teachers: rows, data: rows });
  } catch (e) {
    console.error('subjects.teachers error', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/* POST /api/subjects/:id/teachers/:teacherId  ← تعيين أستاذ */
router.post('/:id/teachers/:teacherId', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const teacherId = Number(req.params.teacherId);
    await pool.query('UPDATE subjects SET teacher_id = ? WHERE id = ?', [teacherId, id]);
    res.json({ ok: true, data: { id, teacher_id: teacherId } });
  } catch (e) {
    console.error('subjects.assignTeacher error', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/* PUT /api/subjects/:id/teacher  {teacher_id|teacherId|teacher} */
router.put('/:id/teacher', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const teacherAny = req.body?.teacher_id ?? req.body?.teacherId ?? req.body?.teacher;
    const teacherId = (teacherAny === null || teacherAny === '' || teacherAny === undefined) ? null : Number(teacherAny);
    await pool.query('UPDATE subjects SET teacher_id = ? WHERE id = ?', [teacherId, id]);
    res.json({ ok: true, data: { id, teacher_id: teacherId } });
  } catch (e) {
    console.error('subjects.putTeacher error', e);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

export default router;
