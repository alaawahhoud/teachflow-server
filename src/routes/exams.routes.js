// src/routes/exams.routes.js
import { Router } from "express";
import pool from "../db.js";

const router = Router();

// لو عامل جدول الامتحانات بقاعدة منفصلة (teachflow_exams) حطها هون.
// وإلا بيستعمل DB_NAME العادي.
const EXAMS_DB = process.env.DB_NAME_EXAMS || process.env.DB_NAME || "teachflow";
const T_EXAMS = `\`${EXAMS_DB}\`.exams`;

// Helpers
const OK_TYPES = new Set(["Midterm", "Final", "Quiz", "Essay"]);
const OK_STATUS = new Set([
  "Draft",
  "Done Not Corrected",
  "Not Done Yet",
  "Correction in Progress",
]);

const normTime = (t) => {
  if (!t) return "08:00:00";
  // يقبل "HH:mm" أو "HH:mm:ss"
  const p = String(t).trim();
  if (/^\d{2}:\d{2}$/.test(p)) return `${p}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(p)) return p;
  return "08:00:00";
};

const isEmpty = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/* =======================
   GET /api/exams
   يدعم: ?class_id & subject_id & type & status & date & date_from & date_to & q & limit & offset
======================= */
router.get("/", async (req, res) => {
  try {
    const {
      class_id,
      subject_id,
      type,
      status,
      date,
      date_from,
      date_to,
      q,
      limit,
      offset,
    } = req.query;

    const where = [];
    const params = [];

    if (class_id) {
      where.push("class_id = ?");
      params.push(Number(class_id));
    }
    if (subject_id) {
      where.push("subject_id = ?");
      params.push(Number(subject_id));
    }
    if (type && OK_TYPES.has(String(type))) {
      where.push("type = ?");
      params.push(String(type));
    }
    if (status && OK_STATUS.has(String(status))) {
      where.push("status = ?");
      params.push(String(status));
    }
    if (date) {
      where.push("date = ?");
      params.push(String(date));
    } else {
      if (date_from) {
        where.push("date >= ?");
        params.push(String(date_from));
      }
      if (date_to) {
        where.push("date <= ?");
        params.push(String(date_to));
      }
    }
    if (q && String(q).trim()) {
      where.push("title LIKE ?");
      params.push(`%${String(q).trim()}%`);
    }

    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const lim = Math.min(Math.max(parseInt(limit || "200", 10), 1), 500);
    const off = Math.max(parseInt(offset || "0", 10), 0);

    const sql = `
      SELECT
        id, title, class_id, subject_id, type,
        DATE_FORMAT(date, '%Y-%m-%d') AS date,
        TIME_FORMAT(time, '%H:%i:%s') AS time,
        duration, status
      FROM ${T_EXAMS}
      ${w}
      ORDER BY date DESC, time ASC, id DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await pool
      .query(sql, [...params, lim, off])
      .then(([r]) => r);

    res.json({ ok: true, data: rows, exams: rows });
  } catch (e) {
    console.error("exams.list error", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/* =======================
   POST /api/exams
   body: { title, class_id, subject_id, type?, date, time?, duration?, status? }
======================= */
router.post("/", async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const class_id = Number(req.body?.class_id);
    const subject_id = Number(req.body?.subject_id);
    const type = OK_TYPES.has(String(req.body?.type)) ? String(req.body.type) : "Midterm";
    const date = String(req.body?.date || "").slice(0, 10);
    const time = normTime(req.body?.time);
    const duration = String(req.body?.duration || "1 hour").trim();
    const status = OK_STATUS.has(String(req.body?.status))
      ? String(req.body.status)
      : "Draft";

    if (!title || !class_id || !subject_id || !date) {
      return res
        .status(400)
        .json({ ok: false, message: "title, class_id, subject_id, date are required" });
    }

    const sql = `
      INSERT INTO ${T_EXAMS}
        (title, class_id, subject_id, type, date, time, duration, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [ins] = await pool.query(sql, [
      title,
      class_id,
      subject_id,
      type,
      date,
      time,
      duration,
      status,
    ]);
    const id = ins.insertId;

    const [row] = await pool
      .query(
        `SELECT id, title, class_id, subject_id, type,
                DATE_FORMAT(date, '%Y-%m-%d') AS date,
                TIME_FORMAT(time, '%H:%i:%s') AS time,
                duration, status
         FROM ${T_EXAMS} WHERE id = ? LIMIT 1`,
        [id]
      )
      .then(([r]) => r);

    res.status(201).json({ ok: true, id, data: row });
  } catch (e) {
    console.error("exams.create error", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/* =======================
   PATCH /api/exams/:id
   body: أي من الحقول أعلاه
======================= */
router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: "id required" });

    const fields = [];
    const params = [];

    if (!isEmpty(req.body?.title)) {
      fields.push("title = ?");
      params.push(String(req.body.title).trim());
    }
    if (!isEmpty(req.body?.class_id)) {
      fields.push("class_id = ?");
      params.push(Number(req.body.class_id));
    }
    if (!isEmpty(req.body?.subject_id)) {
      fields.push("subject_id = ?");
      params.push(Number(req.body.subject_id));
    }
    if (!isEmpty(req.body?.type)) {
      const t = String(req.body.type);
      if (!OK_TYPES.has(t)) return res.status(400).json({ ok: false, message: "bad type" });
      fields.push("type = ?");
      params.push(t);
    }
    if (!isEmpty(req.body?.date)) {
      fields.push("date = ?");
      params.push(String(req.body.date).slice(0, 10));
    }
    if (!isEmpty(req.body?.time)) {
      fields.push("time = ?");
      params.push(normTime(req.body.time));
    }
    if (!isEmpty(req.body?.duration)) {
      fields.push("duration = ?");
      params.push(String(req.body.duration));
    }
    if (!isEmpty(req.body?.status)) {
      const st = String(req.body.status);
      if (!OK_STATUS.has(st)) return res.status(400).json({ ok: false, message: "bad status" });
      fields.push("status = ?");
      params.push(st);
    }

    if (!fields.length) {
      return res.status(400).json({ ok: false, message: "no fields to update" });
    }

    params.push(id);
    await pool.query(`UPDATE ${T_EXAMS} SET ${fields.join(", ")} WHERE id = ?`, params);

    const [row] = await pool
      .query(
        `SELECT id, title, class_id, subject_id, type,
                DATE_FORMAT(date, '%Y-%m-%d') AS date,
                TIME_FORMAT(time, '%H:%i:%s') AS time,
                duration, status
         FROM ${T_EXAMS} WHERE id = ? LIMIT 1`,
        [id]
      )
      .then(([r]) => r);

    res.json({ ok: true, data: row });
  } catch (e) {
    console.error("exams.update error", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/* =======================
   DELETE /api/exams/:id
======================= */
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: "id required" });

    await pool.query(`DELETE FROM ${T_EXAMS} WHERE id = ?`, [id]);
    res.json({ ok: true, id });
  } catch (e) {
    console.error("exams.delete error", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
