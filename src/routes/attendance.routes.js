// src/routes/attendance.routes.js
import express from "express";
import {
  recordAttendance,
  listAttendance,
  markDailyAbsences,
} from "../controllers/attendance.controller.js";

const router = express.Router();

/**
 * POST /api/attendance
 * body: { user_id, date?, status?, check_in_time?, check_out_time?, note?, recorded_by? }
 * إذا ما بُعِثت status، بيتحدد تلقائيًا من check_in_time أو من الآن.
 */
router.post("/", recordAttendance);

/**
 * GET /api/attendance
 * query: { date?, from?, to?, teacher_id?, status?, page?, page_size? }
 * بفلتر من الـDB.
 */
router.get("/", listAttendance);

/**
 * POST /api/attendance/mark-absences
 * يعلّم غياب للي ما عندن أي حضور اليوم (أو بتاريخ مُعطى)
 * body: { date? }  // افتراضي اليوم
 */
router.post("/mark-absences", markDailyAbsences);

export default router;
