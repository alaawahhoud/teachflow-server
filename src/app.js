// src/app.js
import express, { Router } from "express";
import cors from "cors";

import usersRouter from "./routes/users.routes.js";
import authRouter from "./routes/auth.routes.js";
import notFound from "./middlewares/notFound.js";
import errorHandler from "./middlewares/errorHandler.js";
import scheduleRoutes from "./routes/schedule.routes.js";
import lookupsRouter from "./routes/lookups.routes.js";
import subjectsRouter from "./routes/subjects.routes.js";
import classesRouter from "./routes/classes.routes.js";
import examsRouter from "./routes/exams.routes.js";
import fingerprintsRouter from "./routes/fingerprints.routes.js"; // ⬅️ جديد

import { listClasses } from "../controllers/classes.controller.js";

const app = express();
const router = Router();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb" }));

// Health
app.get("/", (req, res) => res.json({ ok: true, service: "TeachFlow API" }));

// Routers
app.use("/api/auth", authRouter);   // ⬅️ لازم يجي قبل notFound
app.use("/api/users", usersRouter);
app.use("/api/subjects", subjectsRouter);
app.use("/api/classes", classesRouter);
app.use("/api", scheduleRoutes);
app.use("/api/lookups", lookupsRouter);
app.use("/api/exams", examsRouter);
app.use("/api/fingerprints", fingerprintsRouter); // ⬅️ جديد
router.get("/classes", listClasses);

app.use(notFound);
app.use(errorHandler);

export default app;
