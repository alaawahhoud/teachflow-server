import { Router } from "express";
import multer from "multer";
import {
  listTeachers,
  listUsers,
  getUser,
  updateUser,
  createUser,
  updateCredentials,   // ⬅️ جديد
  debugEcho,
} from "../controllers/users.controller.js";

const router = Router();
const upload = multer();

router.get("/teachers", listTeachers);
router.get("/", listUsers);
router.get("/:id", getUser);

// يقبل JSON و FormData
router.patch("/:id", upload.none(), updateUser);

// ⬇️ جديد: تعديل username/password
router.patch("/:id/credentials", upload.none(), updateCredentials);

router.post("/", upload.none(), createUser);
router.post("/__debug/echo", upload.none(), debugEcho);

export default router;
