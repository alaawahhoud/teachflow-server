// src/routes/users.routes.js
import { Router } from "express";
import multer from "multer";
import {
  listTeachers,
  listUsers,
  getUser,
  updateUser,
  createUser,
  updateCredentials, // تعديل username/password (أو email + password)
  debugEcho,
} from "../controllers/users.controller.js";

const router = Router();
const upload = multer();


/* قراءة */
router.get("/teachers", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name
         FROM users
        WHERE role IN ('Teacher','Coordinator','Cycle Head')
        ORDER BY full_name ASC`
    );
    res.json(rows);
  } catch (e) {
    console.error("[GET /users/teachers]", e);
    res.status(500).json({ message: "Failed" });
  }
});
router.get("/", listUsers);
router.get("/:id", getUser);

/* تعديل بيانات عامة (يقبل JSON و FormData) */
router.patch("/:id", upload.none(), updateUser);

/* تعديل بيانات الاعتماد (username/email/password) – المسار الأساسي */
router.patch("/:id/credentials", upload.none(), updateCredentials);

/* Alias اختياري لتغيير كلمة السر فقط: PUT /api/users/:id/password
   بيعيد استخدام updateCredentials بدون الحاجة لتغيير الكنترولر */
router.put("/:id/password", upload.none(), (req, res, next) => {
  // نخلي الـ body يحوي فقط password إذا وصل payload مختلط
  const pwd = req.body?.password;
  req.body = { password: pwd };
  return updateCredentials(req, res, next);
});

/* إنشاء */
router.post("/", upload.none(), createUser);

/* Debug */
router.post("/__debug/echo", upload.none(), debugEcho);

export default router;
