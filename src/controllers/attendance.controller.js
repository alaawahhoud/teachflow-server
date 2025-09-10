// src/controllers/attendance.controller.js
import pool from "../db.js";

/* ===== Helpers ===== */
async function getSetting(key, fallback = null) {
  try {
    const [rows] = await pool.query("SELECT v FROM settings WHERE k=? LIMIT 1", [key]);
    return rows[0]?.v ?? fallback;
  } catch {
    return fallback;
  }
}
function toHMS(x) {
  if (!x) return null;
  const s = String(x);
  return s.length >= 8 ? s.slice(0,8) : s;
}
function addMinutesToHMS(hms, minutes = 0) {
  if (!hms) return null;
  const [H, M, S] = String(hms).slice(0,8).split(":").map(Number);
  const d = new Date(2000,0,1, H||0, M||0, S||0);
  d.setMinutes(d.getMinutes() + Number(minutes||0));
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  const ss = String(d.getSeconds()).padStart(2,"0");
  return `${hh}:${mm}:${ss}`;
}
function computeStatusFromTimes(checkIn, cutoff) {
  const t = toHMS(checkIn);
  if (!t) return "Absent";
  return t > cutoff ? "Late" : "Present";
}
function dowIndex(dateStr) {
  return new Date(dateStr || Date.now()).getDay(); // 0..6
}

/** أقدم بداية اليوم من schedules للمدرّس (لو موجودة) وإلا global cutoff */
async function computeUserCutoff(userId, dateStr) {
  const di = dowIndex(dateStr);
  try {
    const [r] = await pool.query(
      `SELECT MIN(start_time) AS min_start
       FROM schedules
       WHERE teacher_id = ? AND day_of_week = ?`,
      [userId, di]
    );
    const minStart = toHMS(r?.[0]?.min_start);
    const grace = Number(await getSetting("late_grace_minutes", 10)) || 10;
    if (minStart) return addMinutesToHMS(minStart, grace);
  } catch {}
  const globalCutoff = String(await getSetting("late_cutoff", "07:40:00")).slice(0,8);
  return globalCutoff;
}

/* ===== Controllers ===== */

/**
 * GET /api/attendance
 * query: date=YYYY-MM-DD, teacherId|teacherName, status=(Present,Late,Absent), class={classId}
 * بيرجع Array جاهزة للواجهة.
 */
export async function listAttendance(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().slice(0,10);
    const teacherId = Number(req.query.teacherId || req.query.teacher_id || 0) || null;
    const teacherName = req.query.teacherName || null;
    const classFilter = req.query.class || null;      // classId (Number as string)
    const statusParam = req.query.status || null;     // "Present,Late"
    const statusSet = statusParam ? new Set(String(statusParam).split(",").map(s => s.trim())) : null;

    // 1) المدرّسون
    const [teachers] = await pool.query(`
      SELECT u.id, COALESCE(u.full_name, u.username, u.email, u.name) AS full_name
      FROM users u
      WHERE u.role IN ('Teacher','Coordinator','Principal','Admin','IT Support','Cycle Head')
      ORDER BY full_name ASC
    `);
    if (!teachers?.length) return res.json([]);

    const ids = teachers.map(t => t.id);

    // 2) حضور اليوم (time_in/time_out)
    const [attRows] = await pool.query(
      `SELECT user_id, date,
              TIME_FORMAT(time_in,  '%H:%i:%s') AS time_in,
              TIME_FORMAT(time_out, '%H:%i:%s') AS time_out,
              status
       FROM attendance
       WHERE date = ?`,
      [date]
    );
    const byUser = new Map(attRows.map(r => [Number(r.user_id), r]));

    // 3) الصفوف المعيّنة لكل أستاذ (من teacher_class_subjects + subjects)
    const [tcs] = await pool.query(
      `SELECT teacher_id, class_id FROM teacher_class_subjects
       WHERE teacher_id IN (${ids.map(()=>"?").join(",")})`,
      ids
    );
    const [subj] = await pool.query(
      `SELECT teacher_id, class_id FROM subjects
       WHERE teacher_id IN (${ids.map(()=>"?").join(",")})
         AND class_id IS NOT NULL`,
      ids
    );
    const classMap = new Map();
    for (const id of ids) classMap.set(Number(id), new Set());
    for (const r of (tcs || [])) if (r.class_id) classMap.get(Number(r.teacher_id))?.add(Number(r.class_id));
    for (const r of (subj || [])) if (r.class_id) classMap.get(Number(r.teacher_id))?.add(Number(r.class_id));

    // 4) إعدادات عامة
    const globalCutoff = String(await getSetting("late_cutoff", "07:40:00")).slice(0,8);

    // 5) بناء اللائحة
    const list = [];
    for (const t of teachers) {
      if (teacherId && t.id !== teacherId) continue;
      if (teacherName && !String(t.full_name).toLowerCase().includes(String(teacherName).toLowerCase())) continue;

      const a = byUser.get(Number(t.id)) || null;

      // cutoff مخصّص من schedules أو عام
      let cutoff = globalCutoff;
      try { cutoff = await computeUserCutoff(Number(t.id), date); } catch {}

      const status = a?.status || computeStatusFromTimes(a?.time_in, cutoff);

      if (statusSet && !statusSet.has(status)) continue;

      const clsIds = Array.from(classMap.get(Number(t.id)) || []);
      const primaryClassId = clsIds.length ? clsIds[0] : null;

      // فلتر الصف (إذا مرسل)
      if (classFilter && classFilter !== "All Classes") {
        if (String(primaryClassId ?? "") !== String(classFilter)) continue;
      }

      list.push({
        id: t.id,
        name: t.full_name,
        class: "—",             // اسم الصف يُستبدل في الفرونت عبر /api/classes
        subject: "—",
        status,
        notes: "",              // ما عندنا note بالجدول الحالي
        check_in_time: a?.time_in  || "",
        check_out_time: a?.time_out || "",
        _classId: primaryClassId, // ليساعد الفرونت على المطابقة
      });
    }

    res.json(list);
  } catch (e) {
    console.error("[listAttendance]", e);
    res.status(500).json({ message: "Failed to get attendance", error: e?.sqlMessage || e?.message || String(e) });
  }
}

/**
 * POST /api/attendance
 * body: { user_id, date, status?, check_in_time?, check_out_time? }
 * يحفظ على أعمدة time_in/time_out
 */
export async function recordAttendance(req, res) {
  try {
    const {
      user_id, date,
      status, check_in_time, check_out_time,
    } = req.body || {};

    if (!user_id || !date) {
      return res.status(400).json({ message: "user_id and date required" });
    }

    const cutoff = await computeUserCutoff(Number(user_id), date);
    const finalStatus = status || computeStatusFromTimes(check_in_time, cutoff);

    await pool.query(
      `INSERT INTO attendance (user_id, date, status, time_in, time_out, created_at)
       VALUES (?,?,?,?,?, NOW())
       ON DUPLICATE KEY UPDATE
         status  = VALUES(status),
         time_in = COALESCE(VALUES(time_in), time_in),
         time_out= COALESCE(VALUES(time_out), time_out)`,
      [user_id, date, finalStatus, check_in_time || null, check_out_time || null]
    );

    res.json({ ok: true, status: finalStatus, cutoff });
  } catch (e) {
    console.error("[recordAttendance]", e);
    res.status(500).json({ message: "Failed to save attendance", error: e?.sqlMessage || e?.message || String(e) });
  }
}

/**
 * POST /api/attendance/bulk
 * body: [{ user_id, date, status?, check_in_time?, check_out_time? }, ...]
 */
export async function bulkUpsertAttendance(req, res) {
  try {
    const rows = Array.isArray(req.body) ? req.body : [];
    if (!rows.length) return res.status(400).json({ message: "empty payload" });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const r of rows) {
        if (!r?.user_id || !r?.date) continue;
        const cutoff = await computeUserCutoff(Number(r.user_id), r.date);
        const finalStatus = r.status || computeStatusFromTimes(r.check_in_time, cutoff);

        await conn.query(
          `INSERT INTO attendance (user_id, date, status, time_in, time_out, created_at)
           VALUES (?,?,?,?,?, NOW())
           ON DUPLICATE KEY UPDATE
             status  = VALUES(status),
             time_in = COALESCE(VALUES(time_in), time_in),
             time_out= COALESCE(VALUES(time_out), time_out)`,
          [
            r.user_id, r.date, finalStatus,
            r.check_in_time || null,
            r.check_out_time || null
          ]
        );
      }

      await conn.commit();
      res.json({ ok: true, count: rows.length });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error("[bulkUpsertAttendance]", e);
    res.status(500).json({ message: "Failed to save bulk attendance", error: e?.sqlMessage || e?.message || String(e) });
  }
}

/**
 * POST /api/attendance/mark-absences
 * body: { date? }
 */
export async function markDailyAbsences(req, res) {
  try {
    const date = req.body?.date || new Date().toISOString().slice(0,10);

    const [teachers] = await pool.query(
      `SELECT id FROM users
       WHERE role IN ('Teacher','Coordinator','Principal','Admin','IT Support','Cycle Head')`
    );
    if (!teachers.length) return res.json({ ok: true, inserted: 0 });

    const [haveRows] = await pool.query(`SELECT user_id FROM attendance WHERE date=?`, [date]);
    const haveSet = new Set(haveRows.map(r => Number(r.user_id)));

    const missing = teachers.map(t => Number(t.id)).filter(id => !haveSet.has(id));
    if (!missing.length) return res.json({ ok: true, inserted: 0 });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const id of missing) {
        await conn.query(
          `INSERT INTO attendance (user_id, date, status, created_at)
           VALUES (?,?, 'Absent', NOW())
           ON DUPLICATE KEY UPDATE status=VALUES(status)`,
          [id, date]
        );
      }
      await conn.commit();
      res.json({ ok: true, inserted: missing.length });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error("[markDailyAbsences]", e);
    res.status(500).json({ message: "Failed to mark absences", error: e?.sqlMessage || e?.message || String(e) });
  }
}
