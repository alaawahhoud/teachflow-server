// src/routes/attendance.routes.js
import express from "express";
import {
  recordAttendance,
  listAttendance,
  markDailyAbsences,
  bulkUpsertAttendance,
} from "../controllers/attendance.controller.js";

const router = express.Router();

/**
 * POST /api/attendance
 * body: { user_id, date?, status?, check_in_time?, check_out_time?, note?, recorded_by?, device_id?, page_id?, score? }
 */
router.post("/", recordAttendance);

/**
 * GET /api/attendance
 * query: { date?, teacherId?, teacherName?, status?, class? }
 */
router.get("/", listAttendance);

/**
 * POST /api/attendance/bulk
 * body: [{ user_id, date, status?, check_in_time?, check_out_time?, note?, recorded_by? }, ...]
 */
router.post("/bulk", bulkUpsertAttendance);

/**
 * POST /api/attendance/mark-absences
 * body: { date? }  // افتراضي اليوم
 */
router.post("/mark-absences", markDailyAbsences);

export default router;
