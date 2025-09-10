// src/controllers/attendance.controller.js
import pool from "../db.js";

/* ===== Helpers ===== */
function toHMS(x) {
  if (!x) return null;
  const s = String(x);
  return s.length >= 8 ? s.slice(0, 8) : s;
}
function addMinutesToHMS(hms, minutes = 0) {
  if (!hms) return null;
  const [H, M, S] = String(hms).slice(0, 8).split(":").map(Number);
  const d = new Date(2000, 0, 1, H || 0, M || 0, S || 0);
  d.setMinutes(d.getMinutes() + Number(minutes || 0));
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
async function getSetting(key, fallback = null) {
  try {
    const [rows] = await pool.query("SELECT v FROM settings WHERE k=? LIMIT 1", [key]);
    return rows?.[0]?.v ?? fallback;
  } catch {
    return fallback;
  }
}
function dowIndex(dateStr) {
  return new Date(dateStr || Date.now()).getDay(); // 0..6
}

/** Earliest start_time from schedules (for user/day) + grace; else global cutoff */
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
  const globalCutoff = String(await getSetting("late_cutoff", "07:40:00")).slice(0, 8);
  return globalCutoff;
}
function statusFromTimes(checkIn, cutoff) {
  const t = toHMS(checkIn);
  if (!t) return "Absent";
  return t > cutoff ? "Late" : "Present";
}

/* ===== Controllers ===== */

export async function listAttendance(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const teacherId = Number(req.query.teacherId || 0) || null;
    const classFilter = req.query.class || null; // classId string
    const statusParam = req.query.status || null; // "Present,Late"
    const statusSet = statusParam
      ? new Set(String(statusParam).split(",").map((s) => s.trim()))
      : null;

    // 1) teachers
    const [teachers] = await pool.query(`
      SELECT id,
             COALESCE(full_name, username, email, name) AS full_name
      FROM users
      WHERE role IN ('Teacher','Coordinator','Principal','Admin','IT Support','Cycle Head')
      ORDER BY full_name ASC
    `);
    if (!teachers?.length) return res.json([]);

    const ids = teachers.map((t) => t.id);

    // 2) attendance rows for the day
    const [attRows] = await pool.query(
      `SELECT user_id, date,
              TIME_FORMAT(time_in,  '%H:%i:%s') AS time_in,
              TIME_FORMAT(time_out, '%H:%i:%s') AS time_out,
              status,
              notes
       FROM attendance
       WHERE date = ?`,
      [date]
    );
    const byUser = new Map(attRows.map((r) => [Number(r.user_id), r]));

    // 3) class assignments (teacher_class_subjects + subjects)
    const [tcs] = await pool.query(
      `SELECT teacher_id, class_id
       FROM teacher_class_subjects
       WHERE teacher_id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    const [subj] = await pool.query(
      `SELECT teacher_id, class_id
       FROM subjects
       WHERE teacher_id IN (${ids.map(() => "?").join(",")})
         AND class_id IS NOT NULL`,
      ids
    );

    const classSetByTeacher = new Map();
    for (const id of ids) classSetByTeacher.set(Number(id), new Set());
    for (const r of tcs || [])
      if (r.class_id) classSetByTeacher.get(Number(r.teacher_id))?.add(Number(r.class_id));
    for (const r of subj || [])
      if (r.class_id) classSetByTeacher.get(Number(r.teacher_id))?.add(Number(r.class_id));

    // 4) classes map (for display names)
    const [clsRows] = await pool.query(
      "SELECT id, name, grade, section FROM classes"
    );
    const classesMap = new Map(
      (clsRows || []).map((c) => [
        Number(c.id),
        c.name || `${c.grade ?? ""}${c.section ? ` ${c.section}` : ""}`.trim() || `Class ${c.id}`,
      ])
    );

    // 5) build list
    const list = [];
    for (const t of teachers) {
      if (teacherId && t.id !== teacherId) continue;

      const att = byUser.get(Number(t.id)) || null;
      const cutoff = await computeUserCutoff(Number(t.id), date);
      const status = att?.status || statusFromTimes(att?.time_in, cutoff);
      if (statusSet && !statusSet.has(status)) continue;

      const clsIds = Array.from(classSetByTeacher.get(Number(t.id)) || []);
      const primaryClassId = clsIds.length ? clsIds[0] : null;

      if (classFilter && classFilter !== "All") {
        if (String(primaryClassId ?? "") !== String(classFilter)) continue;
      }

      const className = primaryClassId ? classesMap.get(Number(primaryClassId)) || `Class ${primaryClassId}` : "—";

      list.push({
        id: t.id,
        name: t.full_name,
        class_id: primaryClassId,
        class: className,
        subject: "—",
        status,
        notes: att?.notes || "",
        check_in_time: att?.time_in || "",
        check_out_time: att?.time_out || "",
      });
    }

    res.json(list);
  } catch (e) {
    console.error("[attendance:list]", e);
    res.status(500).json({ message: "Failed to get attendance", error: e?.sqlMessage || e?.message || String(e) });
  }
}

export async function upsertAttendance(req, res) {
  try {
    const { user_id, date, status, check_in_time, check_out_time, notes } = req.body || {};
    if (!user_id || !date) {
      return res.status(400).json({ message: "user_id and date are required" });
    }
    const cutoff = await computeUserCutoff(Number(user_id), date);
    const finalStatus = status || statusFromTimes(check_in_time, cutoff);

    // Try with notes (if column exists). Fallback without notes.
    try {
      await pool.query(
        `INSERT INTO attendance (user_id, date, status, time_in, time_out, notes, created_at)
         VALUES (?,?,?,?,?,?, NOW())
         ON DUPLICATE KEY UPDATE
           status  = VALUES(status),
           time_in = COALESCE(VALUES(time_in), time_in),
           time_out= COALESCE(VALUES(time_out), time_out),
           notes   = COALESCE(VALUES(notes), notes)`,
        [user_id, date, finalStatus, check_in_time || null, check_out_time || null, notes || null]
      );
    } catch {
      await pool.query(
        `INSERT INTO attendance (user_id, date, status, time_in, time_out, created_at)
         VALUES (?,?,?,?,?, NOW())
         ON DUPLICATE KEY UPDATE
           status  = VALUES(status),
           time_in = COALESCE(VALUES(time_in), time_in),
           time_out= COALESCE(VALUES(time_out), time_out)`,
        [user_id, date, finalStatus, check_in_time || null, check_out_time || null]
      );
    }

    // return class_id for this teacher (handy for UI)
    let class_id = null;
    try {
      const [r1] = await pool.query(
        `SELECT class_id FROM teacher_class_subjects WHERE teacher_id=? LIMIT 1`,
        [user_id]
      );
      if (r1?.[0]?.class_id) class_id = Number(r1[0].class_id);
      if (!class_id) {
        const [r2] = await pool.query(
          `SELECT class_id FROM subjects WHERE teacher_id=? AND class_id IS NOT NULL LIMIT 1`,
          [user_id]
        );
        if (r2?.[0]?.class_id) class_id = Number(r2[0].class_id);
      }
    } catch {}

    res.json({ ok: true, status: finalStatus, cutoff, class_id });
  } catch (e) {
    console.error("[attendance:upsert]", e);
    res.status(500).json({ message: "Failed to save attendance", error: e?.sqlMessage || e?.message || String(e) });
  }
}

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
        const finalStatus = r.status || statusFromTimes(r.check_in_time, cutoff);

        try {
          await conn.query(
            `INSERT INTO attendance (user_id, date, status, time_in, time_out, notes, created_at)
             VALUES (?,?,?,?,?,?, NOW())
             ON DUPLICATE KEY UPDATE
               status  = VALUES(status),
               time_in = COALESCE(VALUES(time_in), time_in),
               time_out= COALESCE(VALUES(time_out), time_out),
               notes   = COALESCE(VALUES(notes), notes)`,
            [
              r.user_id,
              r.date,
              finalStatus,
              r.check_in_time || null,
              r.check_out_time || null,
              r.notes || null,
            ]
          );
        } catch {
          await conn.query(
            `INSERT INTO attendance (user_id, date, status, time_in, time_out, created_at)
             VALUES (?,?,?,?,?, NOW())
             ON DUPLICATE KEY UPDATE
               status  = VALUES(status),
               time_in = COALESCE(VALUES(time_in), time_in),
               time_out= COALESCE(VALUES(time_out), time_out)`,
            [
              r.user_id,
              r.date,
              finalStatus,
              r.check_in_time || null,
              r.check_out_time || null,
            ]
          );
        }
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
    console.error("[attendance:bulkUpsert]", e);
    res.status(500).json({ message: "Failed to save bulk", error: e?.sqlMessage || e?.message || String(e) });
  }
}
