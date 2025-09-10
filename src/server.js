// src/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();

/* ---------- CORS ---------- */
// إذا بدك Allowlist، حط الدومينات مفصولة بفواصل بمتغير CORS_ORIGINS
const allowlist = (process.env.CORS_ORIGINS || process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);      // Postman/curl
    if (allowlist.length === 0) return cb(null, true); // Open mode
    return allowlist.includes(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
};
app.use(cors(corsOptions));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1);

/* ---------- Diagnostics log ---------- */
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

/* ---------- Routes ---------- */
import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import classesRoutes from "./routes/classes.routes.js";
import studentsRoutes from "./routes/students.routes.js";
import subjectsRoutes from "./routes/subjects.routes.js";
import examsRoutes from "./routes/exams.routes.js";
import studentStatusWeeksRoutes from "./routes/studentStatusWeeks.routes.js";
import scheduleRoutes from "./routes/schedule.routes.js";
import fingerprintsRoutes from "./routes/fingerprints.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import lookupsRoutes from "./routes/lookups.routes.js"; // ⬅️ مهم جداً
import espCompatRoutes from "./routes/esp-compat.routes.js";

app.get("/__ping", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Mount
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/students", studentsRoutes);
app.use("/api/subjects", subjectsRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/student-status-weeks", studentStatusWeeksRoutes);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/fingerprints", fingerprintsRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/lookups", lookupsRoutes);      // ⬅️ صار موجود
app.use("/api", espCompatRoutes);

/* ---------- DB check ---------- */
import pool from "./db.js";
app.get("/api/db-check", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows?.[0]?.ok === 1 });
  } catch (e) {
    console.error("[db-check]", e?.message || e);
    res.status(500).json({ ok: false, error: "DB connection failed" });
  }
});

/* ---------- 404 & Errors ---------- */
app.use((req, res) => res.status(404).json({ message: "Not found", path: req.originalUrl }));
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err?.message || err);
  res.status(500).json({ message: err?.message || "Server error" });
});

/* ---------- Start ---------- */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`TeachFlow server on http://localhost:${PORT}`));
