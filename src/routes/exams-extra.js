// server/routes/exams-extra.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const pool = require('../db');

const router = express.Router();

// مجلد رفع الملفات + static
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    // اسم بسيط يحافظ على الامتداد
    const ext = path.extname(file.originalname || '');
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage });

// ========= META =========
// upsert exams_meta
router.put('/exams/:id/meta', async (req, res) => {
  try {
    const examId = Number(req.params.id);
    if (!examId) return res.status(400).json({ error: 'Bad exam id' });

    const { teacher = '', coordinator = '', file_url = '' } = req.body || {};
    const sql = `
      INSERT INTO exams_meta (exam_id, teacher, coordinator, file_url)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        teacher = VALUES(teacher),
        coordinator = VALUES(coordinator),
        file_url = VALUES(file_url)
    `;
    await pool.execute(sql, [examId, teacher, coordinator, file_url]);
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /exams/:id/meta', e);
    res.status(500).json({ error: 'Meta save failed' });
  }
});

// ========= OBJECTIVES =========
// upsert exam_objectives عبر batch insert
router.put('/exams/:id/objectives', async (req, res) => {
  try {
    const examId = Number(req.params.id);
    if (!examId) return res.status(400).json({ error: 'Bad exam id' });

    const raw = Array.isArray(req.body?.objectives) ? req.body.objectives : [];
    const objs = raw.slice(0, 10).map((t) => String(t || ''));

    if (objs.length === 0) {
      return res.json({ ok: true, changed: 0 });
    }

    // خيار 1: حذف وإعادة إدخال (أبسط)
    await pool.execute('DELETE FROM exam_objectives WHERE exam_id = ?', [examId]);

    const values = [];
    const placeholders = [];
    objs.forEach((text, idx) => {
      placeholders.push('(?,?,?)');
      values.push(examId, idx, text);
    });

    const sql = `
      INSERT INTO exam_objectives (exam_id, idx, text)
      VALUES ${placeholders.join(',')}
    `;
    await pool.query(sql, values);

    res.json({ ok: true, changed: objs.length });
  } catch (e) {
    console.error('PUT /exams/:id/objectives', e);
    res.status(500).json({ error: 'Objectives save failed' });
  }
});

// ========= FILE UPLOAD =========
// يرفع الملف ويحدّث file_url بالـ meta
router.post('/exams/:id/file', upload.single('file'), async (req, res) => {
  try {
    const examId = Number(req.params.id);
    if (!examId) return res.status(400).json({ error: 'Bad exam id' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    // URL عام (قد تحتاج تضبط BASE_URL إذا السيرفر خلف بروكسي)
    const publicUrl = `/uploads/${req.file.filename}`;

    await pool.execute(`
      INSERT INTO exams_meta (exam_id, file_url)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE file_url = VALUES(file_url)
    `, [examId, publicUrl]);

    res.json({ ok: true, file_url: publicUrl });
  } catch (e) {
    console.error('POST /exams/:id/file', e);
    res.status(500).json({ error: 'File upload failed' });
  }
});

module.exports = router;
