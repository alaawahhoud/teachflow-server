import { Router } from "express";
import { listSubjects, listClasses } from "../controllers/lookups.controller.js";
const r = Router();

r.get("/subjects", listSubjects); // GET /api/lookups/subjects
r.get("/classes", listClasses);   // GET /api/lookups/classes

export default r;
