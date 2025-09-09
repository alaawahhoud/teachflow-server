// src/controllers/attendance.controller.js
import pool from "../db.js";
import dayjs from "dayjs";

const LATE_CUTOFF = process.env.LATE_CUTOFF || "07:40:00";

/** Helper: يقرّر الحالة من وقت الدخول */
function computeStatusFromCheckIn(t) {
  // t: "HH:mm:ss"
  if (!t) return "Absent";
  return t <= LATE_CUTOFF ? "Present" : "Late";
}

/** Helper: صيغة تاريخ اليوم "YYYY-MM-DD" */
function todayStr() {
  return dayjs().format("YYYY-MM-DD");
}

/** INSERT أو UPDATE ذكي للحضور (منع التكرار خلال 5 دقائق) */
export async function recordAttendance(req, res) {
  try {
    const {
      user_id,
      date,
      status,
      check_in_time,
      check_out_time,
      note,
      recorded_by,
    } = req.body || {};
    if (!user_id) return res.status(400).json({ message: "user_id required" });

    const day = (date || todayStr()).slice(0, 10);

    // حدّد الحالة تلقائيًا إذا ما وصلت من الواجهة:
    const effectiveStatus = status || computeStatusFromCheckIn(check_in_time);

    // منع التكرار: إذا آخر سجل خلال 5 دقائق لنفس اليوم ولنفس المستخدم → تجاهل
    const [dup] = await pool.query(
      `SELECT id FROM attendance
       WHERE user_id=? AND date=? AND created_at >= (NOW() - INTERVAL 5 MINUTE)
       ORDER BY created_at DESC LIMIT 1`,
      [user_id, day]
    );
    if (dup.length) {
      return res.json({ ok: true, note: "ignored duplicate (<=5min)", id: dup[0].id });
    }

    // إذا في سجل لنفس اليوم: منحدّثه (خصوصًا check-in/out) بدل ما نكدّس
    const [ex] = await pool.query(
      `SELECT id, status FROM attendance WHERE user_id=? AND date=? ORDER BY id DESC LIMIT 1`,
      [user_id, day]
    );

    if (ex.length) {
      const row = ex[0];
      const newStatus = status ? status : row.status || effectiveStatus;
      await pool.query(
        `UPDATE attendance
         SET status=?, check_in_time=COALESCE(?, check_in_time),
             check_out_time=COALESCE(?, check_out_time),
             note=COALESCE(?, note)
         WHERE id=?`,
        [newStatus, check_in_time || null, check_out_time || null, note || null, row.id]
      );
      return res.json({ ok: true, id: row.id, updated: true });
    }

    // جديد
    const [ins] = await pool.query(
      `INSERT INTO attendance (user_id, date, status, check_in_time, check_out_time, note, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        user_id,
        day,
        effectiveStatus,
        check_in_time || null,
        check_out_time || null,
        note || null,
        recorded_by || null,
      ]
    );
    return res.json({ ok: true, id: ins.insertId });
  } catch (e) {
    console.error("[recordAttendance]", e);
    res.status(500).json({ message: "Failed to record attendance" });
  }
}

/** GET /api/attendance — فلترة من الـDB */
export async function listAttendance(req, res) {
  try {
    const {
      date,
      from,
      to,
      teacher_id,
      status,
      page = 1,
      page_size = 50,
    } = req.query || {};

    const where = [];
    const params = [];

    if (date) {
      where.push("a.date=?");
      params.push(String(date).slice(0, 10));
    } else {
      if (from) { where.push("a.date >= ?"); params.push(String(from).slice(0, 10)); }
      if (to)   { where.push("a.date <= ?"); params.push(String(to).slice(0, 10)); }
    }
    if (teacher_id) { where.push("a.user_id=?"); params.push(teacher_id); }
    if (status)     { where.push("a.status=?"); params.push(status); }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(Number(page_size) || 50, 500));
    const offset = (Math.max(1, Number(page) || 1) - 1) * limit;

    const [rows] = await pool.query(
      `SELECT a.id, a.user_id, u.full_name AS name,
              a.date, a.status, a.check_in_time, a.check_out_time, a.note, a.created_at
       FROM attendance a
       LEFT JOIN users u ON u.id=a.user_id
       ${whereSql}
       ORDER BY a.date DESC, a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM attendance a
       ${whereSql}`,
      params
    );

    res.json({
      items: rows,
      page: Number(page),
      page_size: limit,
      total: countRows[0].cnt,
    });
  } catch (e) {
    console.error("[listAttendance]", e);
    res.status(500).json({ message: "Failed to list attendance" });
  }
}

/**
 * POST /api/attendance/mark-absences
 * يعلّم كل الأساتذة Absent بتاريخ معين إذا ما عندن أي سجل بهادا اليوم.
 */
export async function markDailyAbsences(req, res) {
  try {
    const day = (req.body?.date || todayStr()).slice(0, 10);

    // كل أساتذة فعّالين
    const [teachers] = await pool.query(
      `SELECT id FROM users WHERE role IN ('Teacher','Coordinator','Cycle Head') AND (status='Active' OR status IS NULL)`
    );
    if (!teachers.length) return res.json({ ok: true, inserted: 0 });

    // يلي ما عندو ولا سجل اليوم
    const [noRec] = await pool.query(
      `SELECT u.id AS user_id
         FROM users u
    LEFT JOIN attendance a ON a.user_id=u.id AND a.date=?
        WHERE u.role IN ('Teacher','Coordinator','Cycle Head')
          AND (u.status='Active' OR u.status IS NULL)
          AND a.id IS NULL`,
      [day]
    );

    let inserted = 0;
    for (const r of noRec) {
      await pool.query(
        `INSERT INTO attendance (user_id, date, status, created_at)
         VALUES (?, ?, 'Absent', NOW())`,
        [r.user_id, day]
      );
      inserted++;
    }

    res.json({ ok: true, date: day, inserted });
  } catch (e) {
    console.error("[markDailyAbsences]", e);
    res.status(500).json({ message: "Failed to mark absences" });
  }
}
