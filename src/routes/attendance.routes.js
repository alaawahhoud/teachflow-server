// src/routes/attendance.routes.js
import { Router } from "express";
import {
  listAttendance,
  upsertAttendance,
  bulkUpsertAttendance,
} from "../controllers/attendance.controller.js";

const router = Router();

// GET /api/attendance
router.get("/", listAttendance);

// POST /api/attendance
router.post("/", upsertAttendance);

// POST /api/attendance/bulk
router.post("/bulk", bulkUpsertAttendance);

export default router;
