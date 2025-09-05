import { Router } from "express";
import { getSchedule, putSchedule, autoBuild } from "../controllers/schedule.controller.js";

const router = Router();

// GET /api/schedule?classId=ID
router.get("/", getSchedule);

// PUT /api/schedule?classId=ID
router.put("/", putSchedule);

// POST /api/schedule/auto?classId=ID[&seed=...]
router.post("/auto", autoBuild);

export default router;
