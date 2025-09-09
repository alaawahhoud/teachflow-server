// src/routes/esp-compat.routes.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

/* ===================== /api/scan (compat) ===================== */
router.post("/scan", async (req, res) => {
  const { deviceId, status, pageId, score } = req.body || {};
  if (!status) return res.status(400).json({ message: "status required" });

  try {
    if (status === "match") {
      if (!deviceId || !pageId) return res.status(400).json({ message: "deviceId and pageId required" });

      const [u] = await pool.query(
        "SELECT id AS user_id FROM users WHERE fingerprint_page_id=? LIMIT 1",
        [Number(pageId)]
      );
      if (!u.length) return res.json({ ok: true, action: "match", note: "unknown pageId" });

      const uid = Number(u[0].user_id);

      const [dup] = await pool.query(
        "SELECT 1 FROM attendance WHERE user_id=? AND created_at >= (NOW() - INTERVAL 5 MINUTE) " +
        "ORDER BY created_at DESC LIMIT 1",
        [uid]
      );
      if (!dup.length) {
        await pool.query(
          "INSERT INTO attendance (user_id, device_id, page_id, score, created_at) VALUES (?, ?, ?, ?, NOW())",
          [uid, String(deviceId), Number(pageId), (score != null ? Number(score) : null)]
        );
      }

      return res.json({ ok: true, action: "match", user_id: String(uid), pageId: Number(pageId), score: score != null ? Number(score) : undefined });
    }

    if (status === "unknown") {
      return res.json({ ok: true, action: "unknown" });
    }

    if (status === "enroll_ok") {
      if (!deviceId || !pageId) return res.status(400).json({ message: "deviceId and pageId required" });

      const [qrows] = await pool.query(
        "SELECT id, user_id FROM fp_enroll_queue WHERE page_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",
        [Number(pageId)]
      );
      if (!qrows.length) return res.json({ ok: true, action: "enroll_ok", note: "no pending item found" });

      const { id, user_id } = qrows[0];
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query("UPDATE fp_enroll_queue SET status='done' WHERE id=?", [id]);
        await conn.query(
          "UPDATE users SET fingerprint_page_id=?, fingerprint_device_id=?, fingerprint_enrolled_at=NOW() WHERE id=?",
          [Number(pageId), String(deviceId), Number(user_id)]
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
      return res.json({ ok: true, action: "enroll_ok", user_id: String(user_id), pageId: Number(pageId), status: "done" });
    }

    return res.json({ ok: true, action: "noop" });
  } catch (e) {
    console.error("[/api/scan]", e);
    return res.status(500).json({ message: "scan failed" });
  }
});

/* ===================== /api/command (compat) ===================== */
router.get("/command", async (req, res) => {
  const deviceId = String(req.query.deviceId || "");
  if (!deviceId) return res.json({ action: "none" });

  try {
    const [rows] = await pool.query(
      "SELECT q.user_id, q.page_id, u.full_name AS name " +
      "FROM fp_enroll_queue q LEFT JOIN users u ON u.id=q.user_id " +
      "WHERE q.device_id=? AND q.status='pending' ORDER BY q.created_at ASC LIMIT 1",
      [deviceId]
    );
    if (!rows.length) return res.json({ action: "none" });

    const r = rows[0];
    return res.json({
      action: "enroll",
      pageId: Number(r.page_id),
      user_id: String(r.user_id),
      name: r.name || undefined
    });
  } catch (e) {
    console.error("[/api/command]", e);
    return res.status(500).json({ action: "none" });
  }
});

/* ===================== /api/enroll/result (compat) ===================== */
router.post("/enroll/result", async (req, res) => {
  let { pageId, ok } = req.body || {};
  if (!pageId) return res.status(400).json({ message: "pageId required" });
  const isOk = (ok === true || ok === "true" || ok === 1 || ok === "1");

  try {
    const [qrows] = await pool.query(
      "SELECT id, user_id FROM fp_enroll_queue WHERE page_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1",
      [Number(pageId)]
    );
    if (!qrows.length) return res.json({ ok: true, note: "no pending item found for this pageId" });

    const { id, user_id } = qrows[0];

    if (isOk) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query("UPDATE fp_enroll_queue SET status='done' WHERE id=?", [id]);
        await conn.query(
          "UPDATE users SET fingerprint_page_id=?, fingerprint_device_id=?, fingerprint_enrolled_at=NOW() WHERE id=?",
          [Number(pageId), "scanner-001", Number(user_id)]
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
      return res.json({ ok: true, status: "done", user_id: String(user_id), pageId: Number(pageId) });
    } else {
      await pool.query("UPDATE fp_enroll_queue SET status='failed', note='enroll failed' WHERE id=?", [id]);
      return res.json({ ok: true, status: "failed", pageId: Number(pageId) });
    }
  } catch (e) {
    console.error("[/api/enroll/result]", e);
    return res.status(500).json({ message: "enroll result failed" });
  }
});

export default router;
