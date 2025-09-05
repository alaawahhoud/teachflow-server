// server/routes/fingerprints.routes.js
import express from "express";
import  pool  from "../db.js";

const router = express.Router();

// الحدّ الأعلى لعدد الخانات على القارئ
const MAX_SLOT = Number(process.env.FP_MAX_SLOT || 200);

/** يحجز أول page_id فاضي من 1..MAX_SLOT اعتماداً على users.fingerprint_page_id */
async function allocateFreeSlot(conn) {
  const [rows] = await conn.query(
    "SELECT fingerprint_page_id AS pid FROM users WHERE fingerprint_page_id IS NOT NULL ORDER BY fingerprint_page_id ASC"
  );
  const used = new Set(rows.map(r => Number(r.pid)));
  for (let i = 1; i <= MAX_SLOT; i++) if (!used.has(i)) return i;
  return null;
}

/** آخر حالة طلب تسجيل لمستخدم */
async function getLatestEnrollStatus(userId) {
  const [rows] = await pool.query(
    "SELECT device_id, page_id, status, note, created_at, updated_at " +
    "FROM fp_enroll_queue WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  return rows[0] || null;
}

/* ================== 1) طلب تسجيل من الواجهة ================== */
router.post("/enroll-request", async (req, res) => {
  const { user_id, device_id } = req.body || {};
  if (!user_id || !device_id) {
    return res.status(400).json({ message: "user_id and device_id are required" });
  }
  const userId = Number(user_id);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // تأكيد وجود المستخدم + جلب page_id الحالي إن وُجد
    const [u] = await conn.query(
      "SELECT id, fingerprint_page_id FROM users WHERE id=? LIMIT 1",
      [userId]
    );
    if (!u.length) {
      await conn.rollback();
      return res.status(404).json({ message: "User not found" });
    }

    let pageId = u[0].fingerprint_page_id ? Number(u[0].fingerprint_page_id) : null;
    if (!pageId) {
      pageId = await allocateFreeSlot(conn);
      if (!pageId) {
        await conn.rollback();
        return res.status(409).json({ message: "No free fingerprint slots" });
      }
    }

    // إدخال بند pending
    await conn.query(
      "INSERT INTO fp_enroll_queue (user_id, device_id, page_id, status) VALUES (?, ?, ?, 'pending')",
      [userId, device_id, pageId]
    );

    await conn.commit();
    return res.json({ user_id: String(userId), device_id, pageId });
  } catch (e) {
    await conn.rollback();
    console.error("[enroll-request]", e);
    return res.status(500).json({ message: "enroll-request failed" });
  } finally {
    conn.release();
  }
});

/* ================== 2) ESP32 polling للأوامر ================== */
router.get("/command", async (req, res) => {
  const deviceId = String(req.query.deviceId || "");
  if (!deviceId) return res.json({ action: "none" });

  try {
    const [rows] = await pool.query(
      "SELECT user_id, page_id FROM fp_enroll_queue WHERE device_id=? AND status='pending' ORDER BY created_at ASC LIMIT 1",
      [deviceId]
    );
    if (!rows.length) return res.json({ action: "none" });
    const r = rows[0];
    return res.json({ action: "enroll", pageId: Number(r.page_id), user_id: String(r.user_id) });
  } catch (e) {
    console.error("[command]", e);
    return res.status(500).json({ action: "none" });
  }
});

/* ===== 3) ESP32 يبلّغ بنتيجة التسجيل/المطابقة (الحضور) ===== */
router.post("/scan", async (req, res) => {
  const { deviceId, status, pageId, score } = req.body || {};
  if (!deviceId || !status) {
    return res.status(400).json({ message: "deviceId and status required" });
  }

  try {
    if (status === "enroll_ok") {
      // لقطة pending مطابقة
      const [qrows] = await pool.query(
        "SELECT id, user_id, page_id FROM fp_enroll_queue WHERE device_id=? AND page_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",
        [deviceId, Number(pageId)]
      );
      if (!qrows.length) {
        return res.json({ ok: true, action: "enroll_ok", note: "no pending item found" });
      }

      const { id, user_id } = qrows[0];
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // علّم الطلب done
        await conn.query("UPDATE fp_enroll_queue SET status='done' WHERE id=?", [id]);

        // خزّن الربط على users (بصمة المستخدم)
        await conn.query(
          "UPDATE users SET fingerprint_page_id=?, fingerprint_device_id=?, fingerprint_enrolled_at=NOW() WHERE id=?",
          [Number(pageId), deviceId, Number(user_id)]
        );

        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }

      return res.json({
        ok: true, action: "enroll_ok", user_id: String(user_id), pageId: Number(pageId), status: "done"
      });
    }

    if (status === "enroll_fail") {
      await pool.query(
        "UPDATE fp_enroll_queue SET status='failed', note='sensor failed' WHERE device_id=? AND page_id=? AND status='pending'",
        [deviceId, Number(pageId)]
      );
      return res.json({ ok: true, action: "enroll_fail" });
    }

    if (status === "match") {
      // صاحب الـ pageId من users
      const [u] = await pool.query(
        "SELECT id AS user_id FROM users WHERE fingerprint_page_id=? LIMIT 1",
        [Number(pageId)]
      );
      if (!u.length) return res.json({ ok: true, action: "match", note: "unknown pageId" });

      const uid = Number(u[0].user_id);

      // (اختياري) منع تكرار إدخال حضور خلال 5 دقائق
      const [dup] = await pool.query(
        "SELECT 1 FROM attendance WHERE user_id=? AND matched_at >= (NOW() - INTERVAL 5 MINUTE) ORDER BY matched_at DESC LIMIT 1",
        [uid]
      );
      if (!dup.length) {
        await pool.query(
          "INSERT INTO attendance (user_id, device_id, page_id, score) VALUES (?, ?, ?, ?)",
          [uid, deviceId, Number(pageId), (score != null ? Number(score) : null)]
        );
      }

      return res.json({
        ok: true, action: "match", user_id: String(uid), pageId: Number(pageId), score: score != null ? Number(score) : undefined
      });
    }

    return res.json({ ok: true, action: "noop" });
  } catch (e) {
    console.error("[scan]", e);
    return res.status(500).json({ message: "scan failed" });
  }
});

/* ========== 4) حالة التسجيل للواجهة (polling) ========== */
router.get("/enroll-status", async (req, res) => {
  const userId = String(req.query.user_id || "");
  if (!userId) return res.status(400).json({ message: "user_id required" });

  try {
    const st = await getLatestEnrollStatus(userId);
    if (!st) return res.json({ status: "pending" });
    return res.json({
      device_id: st.device_id, pageId: Number(st.page_id), status: st.status, note: st.note
    });
  } catch (e) {
    console.error("[enroll-status]", e);
    return res.status(500).json({ message: "status failed" });
  }
});

/* (اختياري) ديبغ */
router.get("/_debug/state", async (_req, res) => {
  const [queue] = await pool.query("SELECT * FROM fp_enroll_queue ORDER BY created_at DESC LIMIT 50");
  const [att  ] = await pool.query("SELECT * FROM attendance ORDER BY matched_at DESC LIMIT 50");
  const [users] = await pool.query(
    "SELECT id, full_name, fingerprint_page_id, fingerprint_device_id, fingerprint_enrolled_at " +
    "FROM users WHERE fingerprint_page_id IS NOT NULL ORDER BY id ASC"
  );
  res.json({ users, queue, attendance: att });
});

export default router;
