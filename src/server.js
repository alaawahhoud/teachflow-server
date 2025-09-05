// src/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors({ origin: (origin, cb) => cb(null, true), credentials: true }));
app.use(express.json());

// Routes
import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import classesRoutes from "./routes/classes.routes.js";
import studentsRoutes from "./routes/students.routes.js";
import subjectsRoutes from "./routes/subjects.routes.js";
import examsRoutes from "./routes/exams.routes.js";
import studentStatusWeeksRoutes from "./routes/studentStatusWeeks.routes.js"; // ⬅️ جديد
import scheduleRoutes from "./routes/schedule.routes.js";
import fingerprintsRoutes from "./routes/fingerprints.routes.js"; // ⬅️ جديد
import attendanceRoutes   from "./routes/attendance.routes.js"; // (رح أعطيك الملف تحت)
import espCompatRoutes from "./routes/esp-compat.routes.js";

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/students", studentsRoutes);
app.use("/api/subjects", subjectsRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/student-status-weeks", studentStatusWeeksRoutes); // ⬅️ جديد
app.use("/api/schedule", scheduleRoutes);
app.use("/api/fingerprints", fingerprintsRoutes); // ⬅️ جديد
app.use("/api/attendance",   attendanceRoutes); // لعرض/سحب الحضور
app.use("/api", espCompatRoutes); // هكذا تصبح المسارات: /api/scan, /api/command, /api/enroll/result

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

// 404 موحّد
app.use((req, res) => {
  res.status(404).json({ message: "Not found", path: req.originalUrl });
});

// هاندلر أخطاء
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err?.message || err);
  res.status(500).json({ message: err?.message || "Server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`TeachFlow server on http://localhost:${PORT}`);
});
