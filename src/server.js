// src/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

/* ---------- CORS (Allowlist + Preflight) ---------- */
// ✅ Express v5-friendly global preflight handler
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin;
    const allowed =
      !origin || rawAllow.length === 0 || rawAllow.includes(origin);

    if (!allowed) {
      return res.status(403).send("Not allowed by CORS");
    }

    // رجّع نفس الـ Origin (لا تستخدم * إذا بدك credentials)
    if (origin) res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    res.header(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] || "Content-Type, Authorization"
    );
    return res.sendStatus(204);
  }
  next();
});

const rawAllow = (process.env.CORS_ORIGINS || process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// نسمح بكل origins إذا ما في allowlist (مفيد للإصدارات التطويرية أو أول نشر)
function isOriginAllowed(origin) {
  if (!origin) return true;                 // Postman / curl
  if (rawAllow.length === 0) return true;   // open mode
  return rawAllow.includes(origin);
}

const corsOptions = {
  origin: (origin, cb) => (isOriginAllowed(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.set("trust proxy", 1);
app.use(cors(corsOptions));

// ✅ مهم: فعّلي كل الـ preflight على كل المسارات
// أو بديل مضمون أكثر (يرجع 204 بسرعة):
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.sendStatus(204);
  }
  next();
});

/* ---------- Body parsers ---------- */
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* ---------- طلبات للتشخيص ---------- */
app.use((req, _res, next) => {
  // لوج خفيف يساعدنا نعرف شو عم يوصل
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
import studentStatusWeeksRoutes from "./routes/studentStatusWeeks.routes.js"; // ⬅️ جديد
import scheduleRoutes from "./routes/schedule.routes.js";
import fingerprints from "./routes/fingerprints.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import espCompat from "./routes/esp-compat.routes.js";

// صحّح البادئات لتكون واضحة
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/students", studentsRoutes);
app.use("/api/subjects", subjectsRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/student-status-weeks", studentStatusWeeksRoutes);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/fingerprints", fingerprints); // يعطي /api/fingerprints/enroll-request + /enroll-status + /command + /scan
app.use("/api/attendance", attendanceRoutes);
app.use("/api", espCompat);                 // يعطي /api/scan + /api/command + /api/enroll/result

/* ---------- Health & Diagnostics ---------- */
app.get("/__ping", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// عرض كل الراوتات المسجلة (للتشخيص)
app.get("/api/__routes", (_req, res) => {
  try {
    const routes = [];
    const stack = (app._router && Array.isArray(app._router.stack)) ? app._router.stack : [];

    stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase());
        methods.forEach((m) => routes.push({ method: m, path: layer.route.path }));
        return;
      }

      if (layer.name === "router" && layer.handle && Array.isArray(layer.handle.stack)) {
        layer.handle.stack.forEach((h) => {
          if (h.route && h.route.path) {
            const methods = Object.keys(h.route.methods || {}).map((m) => m.toUpperCase());
            methods.forEach((m) => routes.push({ method: m, path: h.route.path }));
          }
        });
      }
    });

    res.json(routes);
  } catch (e) {
    res.status(500).json({ message: e?.message || "Failed to list routes" });
  }
});

/* ---------- 404 & Errors ---------- */
app.use((req, res) => {
  res.status(404).json({ message: "Not found", path: req.originalUrl });
});

app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err?.message || err);
  res.status(500).json({ message: err?.message || "Server error" });
});

/* ---------- Start ---------- */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`TeachFlow server on http://localhost:${PORT}`);
});
