import express from "express";
import {
  recordAttendance,
  listAttendance,
  markDailyAbsences,
  bulkUpsertAttendance,
} from "../controllers/attendance.controller.js";

const router = express.Router();

// POST /api/attendance
router.post("/", recordAttendance);

// GET /api/attendance
router.get("/", listAttendance);

// POST /api/attendance/bulk
router.post("/bulk", bulkUpsertAttendance);

// POST /api/attendance/mark-absences
router.post("/mark-absences", markDailyAbsences);

export default router;
