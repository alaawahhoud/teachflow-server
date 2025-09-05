// auth.controller.js
import pool from "../db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// إعدادات
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";
const ACCESS_TTL = "15m";
const REFRESH_TTL = "7d";

function signTokens(payload) {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign({ id: payload.id }, JWT_SECRET, { expiresIn: REFRESH_TTL });
  return { accessToken, refreshToken };
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  const secure = false; // true لو HTTPS
  res.cookie("access_token", accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 15 * 60 * 1000,
    path: "/",
  });
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearAuthCookies(res) {
  res.clearCookie("access_token");
  res.clearCookie("refresh_token");
}

// ميدلوير حماية
export function authRequired(req, res, next) {
  try {
    const token = req.cookies?.access_token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// POST /api/auth/register
export async function register(req, res) {
  try {
    const { full_name, email, username, password, role = "teacher" } = req.body || {};
    if (!full_name || !email || !password) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const [dup] = await pool.query("SELECT id FROM users WHERE email = ? OR username = ?", [email, username || email]);
    if (dup.length) return res.status(409).json({ error: "User already exists" });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (full_name, email, username, password, role, status) VALUES (?,?,?,?,?,?)",
      [full_name, email, username || null, hash, role, "Active"]
    );

    const [rows] = await pool.query(
      "SELECT id, full_name, email, username, role, status FROM users WHERE id = ?",
      [result.insertId]
    );
    const user = rows[0];

    const tokens = signTokens({ id: user.id, role: user.role, name: user.full_name, email: user.email });
    setAuthCookies(res, tokens);
    res.status(201).json(user);
  } catch (e) {
    console.error("register error", e);
    res.status(500).json({ error: "Registration failed" });
  }
}

// POST /api/auth/login
export async function login(req, res) {
  try {
    const { username, email, password } = req.body || {};
    const loginId = username || email;
    if (!loginId || !password) {
      return res.status(400).json({ error: "username/email and password are required" });
    }

    const [rows] = await pool.query(
      "SELECT id, full_name, email, username, password, role, status FROM users WHERE username = ? OR email = ? LIMIT 1",
      [loginId, loginId]
    );
    if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });

    const u = rows[0];
    if (String(u.status || "").toLowerCase() !== "active") {
      return res.status(403).json({ error: "Account inactive" });
    }

    // كلمة السر ممكن تكون Hash أو نص (نتعامل مع الحالتين)
    const isHash = /^\$2[aby]\$/.test(u.password || "");
    const ok = isHash ? await bcrypt.compare(password, u.password) : u.password === password;
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const user = {
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      username: u.username,
      role: u.role,
      status: u.status,
    };

    const tokens = signTokens({ id: user.id, role: user.role, name: user.full_name, email: user.email });
    setAuthCookies(res, tokens);
    res.json(user);
  } catch (e) {
    console.error("login error", e);
    res.status(500).json({ error: "Login failed" });
  }
}

// POST /api/auth/refresh
export async function refresh(req, res) {
  try {
    const rt = req.cookies?.refresh_token;
    if (!rt) return res.status(401).json({ error: "No refresh token" });
    const decoded = jwt.verify(rt, JWT_SECRET);

    const [rows] = await pool.query(
      "SELECT id, full_name, email, username, role, status FROM users WHERE id = ?",
      [decoded.id]
    );
    if (!rows.length) return res.status(401).json({ error: "User not found" });

    const user = rows[0];
    const tokens = signTokens({ id: user.id, role: user.role, name: user.full_name, email: user.email });
    setAuthCookies(res, tokens);
    res.json({ ok: true });
  } catch (e) {
    console.error("refresh error", e);
    res.status(401).json({ error: "Invalid refresh token" });
  }
}

// GET /api/auth/me
export async function me(req, res) {
  // authRequired سبق وحقّق التوكن
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });
}

// POST /api/auth/logout
export async function logout(_req, res) {
  clearAuthCookies(res);
  res.json({ ok: true });
}
