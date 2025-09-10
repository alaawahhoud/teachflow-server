import pool from "../db.js";

/* ========== Helpers ========== */
async function getSetting(key, fallback = null) {
  try {
    const [rows] = await pool.query("SELECT v FROM settings WHERE k=? LIMIT 1", [key]);
    return rows[0]?.v ?? fallback;
  } catch {
    return fallback;
  }
}

function addMinutesToHMS(hms, minutes = 0) {
  if (!hms) return null;
  const [H, M, S] = hms.split(":").map(Number);
  const d = new Date(2000, 0, 1, H || 0, M || 0, S || 0);
  d.setMinutes(d.getMinutes() + Number(minutes || 0));
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function toTimeStringOrNull(t) {
  if (!t) return null;
  if (typeof t === "string") return t.slice(0, 8);
  try { return new Date(t).toTimeString().slice(0, 8); } catch { return null; }
}

function safeJSON(v) { try { return JSON.parse(v); } catch { return null; } }

function dowIndex(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return d.getDay(); // 0..6
}

async function getLateGraceMinutes() {
  const v = await getSetting("late_grace_minutes", null);
  const n = Number(v);
  return Number.isFinite(n) ? n : 10;
}

function computeStatusFromTimes(checkIn, cutoff) {
  const t = checkIn ? String(checkIn).slice(0, 8) : null;
  if (!t) return "Absent";
  return t > cutoff ? "Late" : "Present";
}

async function computeUserCutoff(userId, dateStr) {
  const [rows] = await pool.query(
    `SELECT COALESCE(work_start_time, shift_start, start_time) AS base_start,
            COALESCE(work_end_time,   shift_end,   end_time)   AS base_end,
            availability_json, schedule_json
       FROM teacher_profile
      WHERE user_id = ?
      LIMIT 1`, [userId]
  );
  const r = rows?.[0] || {};
  let start = toTimeStringOrNull(r.base_start);
  const av = safeJSON(r.availability_json) || safeJSON(r.schedule_json);
  if (!start && av) {
    const di = dowIndex(dateStr);
    const dayKeys = ["sun","mon","tue","wed","thu","fri","sat"];
    const candidates = [av?.[di], av?.days?.[di], av?.[dayKeys[di]], av?.days?.[dayKeys[di]]].filter(Boolean);
    for (const c of candidates) {
      const s = c?.start || c?.from || c?.begin || c?.start_time;
      if (s) { start = String(s).slice(0,8); break; }
    }
  }
  const grace = await getLateGraceMinutes();
  if (start) return addMinutesToHMS(start, grace);
  const globalCutoff = await getSetting("late_cutoff", "07:40:00");
  return String(globalCutoff).slice(0,8);
}

/* ========== Controllers ========== */

// GET /api/attendance?date=YYYY-MM-DD&teacherId|teacherName&status=Present,Late&class=ID
export async function listAttendance(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().slice(0,10);
    const teacherId = Number(req.query.teacherId || req.query.teacher_id || 0) || null;
    const teacherName = req.query.teacherName || null;
    const classFilter = req.query.class || null;
    const statusParam = req.query.status || null;
    const statusSet = statusParam ? new Set(String(statusParam).split(",").map(s => s.trim())) : null;

    const [teachers] = await pool.query(
      `SELECT id, full_name
         FROM users
        WHERE role IN ('Teacher','Coordinator','Principal','Admin','IT Support','Cycle Head')
        ORDER BY full_name ASC`
    );

    const [attRows] = await pool.query(
      `SELECT user_id, date,
              TIME_FORMAT(check_in_time, '%H:%i:%s') AS check_in_time,
              TIME_FORMAT(check_out_time, '%H:%i:%s') AS check_out_time,
              status, note, device_id, page_id, score
         FROM attendance
        WHERE date = ?`, [date]
    );
    const byUser = new Map(attRows.map(r => [Number(r.user_id), r]));

    // profiles (للاحتساب فقط؛ اسم الصف سيُدمج بالفرونت)
    const ids = teachers.map(t => t.id);
    let profilesMap = new Map();
    if (ids.length) {
      const [pRows] = await pool.query(
        `SELECT user_id,
                COALESCE(work_start_time, shift_start, start_time) AS base_start,
                COALESCE(work_end_time,   shift_end,   end_time)   AS base_end,
                availability_json, schedule_json
           FROM teacher_profile
          WHERE user_id IN (${ids.map(()=>"?").join(",")})`,
        ids
      );
      profilesMap = new Map(pRows.map(r => [Number(r.user_id), r]));
    }

    const grace = await getLateGraceMinutes();
    const globalCutoff = (await getSetting("late_cutoff", "07:40:00")).slice(0,8);

    const list = [];
    for (const t of teachers) {
      if (teacherId && t.id !== teacherId) continue;
      if (teacherName && !String(t.full_name).toLowerCase().includes(String(teacherName).toLowerCase())) continue;

      const a = byUser.get(t.id) || null;

      // cutoff per teacher
      let cutoff = globalCutoff;
      const prof = profilesMap.get(t.id);
      if (prof) {
        let start = toTimeStringOrNull(prof.base_start);
        const av = safeJSON(prof.availability_json) || safeJSON(prof.schedule_json);
        if (!start && av) {
          const di = dowIndex(date);
          const dayKeys = ["sun","mon","tue","wed","thu","fri","sat"];
          const candidates = [av?.[di], av?.days?.[di], av?.[dayKeys[di]], av?.days?.[dayKeys[di]]].filter(Boolean);
          for (const c of candidates) {
            const s = c?.start || c?.from || c?.begin || c?.start_time;
            if (s) { start = String(s).slice(0,8); break; }
          }
        }
        if (start) cutoff = addMinutesToHMS(start, grace);
      }

      const status = a?.status || computeStatusFromTimes(a?.check_in_time, cutoff);
      if (statusSet && !statusSet.has(status)) continue;

      // class/subject placeholders — رح تنعكس أسماء الصفوف بالفرونت من DB
      const row = {
        id: t.id,
        name: t.full_name,
        class: "—",
        subject: "—",
        status,
        notes: a?.note || "",
        check_in_time: a?.check_in_time || "",
        check_out_time: a?.check_out_time || "",
      };

      if (classFilter && classFilter !== "All Classes" && row.class !== classFilter) continue;

      list.push(row);
    }

    res.json(list);
  } catch (e) {
    console.error("[listAttendance]", e);
    res.status(500).json({ message: "Failed to get attendance" });
  }
}

// POST /api/attendance
export async function recordAttendance(req, res) {
  try {
    const {
      user_id, date,
      status, check_in_time, check_out_time,
      note, recorded_by, device_id, page_id, score
    } = req.body || {};

    if (!user_id || !date) {
      return res.status(400).json({ message: "user_id and date required" });
    }

    const cutoff = await computeUserCutoff(Number(user_id), date);
    const finalStatus = status || computeStatusFromTimes(check_in_time, cutoff);

    await pool.query(
      `INSERT INTO attendance
         (user_id, date, check_in_time, check_out_time, status, note, recorded_by, device_id, page_id, score)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         check_in_time = VALUES(check_in_time),
         check_out_time= VALUES(check_out_time),
         status       = VALUES(status),
         note         = VALUES(note),
         device_id    = VALUES(device_id),
         page_id      = VALUES(page_id),
         score        = VALUES(score)`,
      [
        user_id, date,
        check_in_time || null,
        check_out_time || null,
        finalStatus,
        note || null,
        recorded_by || null,
        device_id || null,
        page_id || null,
        score || null,
      ]
    );

    res.json({ ok: true, status: finalStatus, cutoff });
  } catch (e) {
    console.error("[recordAttendance]", e);
    res.status(500).json({ message: "Failed to save attendance" });
  }
}

// POST /api/attendance/bulk
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
          `INSERT INTO attendance
             (user_id, date, check_in_time, check_out_time, status, note, recorded_by)
           VALUES (?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE
             check_in_time = VALUES(check_in_time),
             check_out_time= VALUES(check_out_time),
             status       = VALUES(status),
             note         = VALUES(note)`,
          [
            r.user_id, r.date,
            r.check_in_time || null,
            r.check_out_time || null,
            finalStatus,
            r.note || null,
            r.recorded_by || null,
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
    res.status(500).json({ message: "Failed to save bulk attendance" });
  }
}

// POST /api/attendance/mark-absences
export async function markDailyAbsences(req, res) {
  try {
    const date = req.body?.date || new Date().toISOString().slice(0,10);

    const [teachers] = await pool.query(
      `SELECT id FROM users
        WHERE role IN ('Teacher','Coordinator','Principal','Admin','IT Support','Cycle Head')`
    );
    if (!teachers.length) return res.json({ ok: true, inserted: 0 });

    const [haveRows] = await pool.query(
      `SELECT user_id FROM attendance WHERE date = ?`,
      [date]
    );
    const haveSet = new Set(haveRows.map(r => Number(r.user_id)));

    const missing = teachers.map(t => Number(t.id)).filter(id => !haveSet.has(id));
    if (!missing.length) return res.json({ ok: true, inserted: 0 });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const id of missing) {
        await conn.query(
          `INSERT INTO attendance (user_id, date, status)
           VALUES (?,?, 'Absent')
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
    res.status(500).json({ message: "Failed to mark absences" });
  }
}
