// src/routes/auth.routes.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";

const router = Router();

function safeUser(u) {
  return {
    id: u.id,
    full_name: u.full_name || u.name || "",
    username: u.username,
    email: u.email,
    role: u.role || "Teacher",
    status: u.status || "Active",
  };
}

function signToken(user) {
  const secret = process.env.JWT_SECRET || "dev_secret_change_me";
  // sub = user id
  return jwt.sign(
    { sub: user.id, name: user.full_name || user.username, email: user.email, role: user.role || "Teacher" },
    secret,
    { expiresIn: "7d" }
  );
}

/** POST /api/auth/login  { username | email, password } */
router.post("/login", async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    const identifier = (email ?? username)?.trim();
    if (!identifier || !password) {
      return res.status(400).json({ ok: false, message: "Missing username/email or password" });
    }

    const [rows] = await pool.query(
      "SELECT id, full_name, username, email, role, status, password FROM users WHERE username = ? OR email = ? LIMIT 1",
      [identifier, identifier]
    );
    if (!rows.length) return res.status(401).json({ ok: false, message: "Invalid credentials" });

    const u = rows[0];

    // باسوورد: إذا بلّش بـ $2.. اعتبريه bcrypt، غير هيك نصّي مباشر
    let passOK = false;
    if (u.password && u.password.startsWith("$2")) {
      passOK = await bcrypt.compare(password, u.password).catch(() => false);
    } else {
      passOK = password === u.password;
    }
    if (!passOK) return res.status(401).json({ ok: false, message: "Invalid credentials" });

    const user = safeUser(u);
    const token = signToken(user);
    // توافُق مع الفرونت: خزّني المفاتيح الجديدة والقديمة
    return res.json({ ok: true, user, token });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/** GET /api/auth/me  (Bearer token) */
router.get("/me", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ ok: false, message: "Missing token" });

    const secret = process.env.JWT_SECRET || "dev_secret_change_me";
    let payload;
    try { payload = jwt.verify(token, secret); }
    catch { return res.status(401).json({ ok: false, message: "Invalid token" }); }

    const userId = payload.sub;
    const [[u]] = await pool.query(
      "SELECT id, full_name, username, email, role, status FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!u) return res.status(404).json({ ok: false, message: "User not found" });

    return res.json({ ok: true, user: safeUser(u) });
  } catch (e) {
    console.error("Me error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
