import pool from "../db.js";

export async function listSubjects(_req, res, next) {
  try {
    // إذا جدول subjects مش موجود، رجّع مصفوفة فاضية بدل ما نكسر
    try {
      const [rows] = await pool.query(`SELECT id, name FROM subjects ORDER BY name`);
      return res.json(rows);
    } catch {
      return res.json([]); // graceful fallback
    }
  } catch (e) { next(e); }
}

export async function listClasses(_req, res, next) {
  try {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, grade, section FROM classes ORDER BY grade, section, name`
      );
      return res.json(rows);
    } catch {
      return res.json([]);
    }
  } catch (e) { next(e); }
}
