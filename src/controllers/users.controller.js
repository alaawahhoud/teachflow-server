// src/controllers/users.controller.js
import bcrypt from "bcrypt";
import pool from "../db.js";
import { ok, created } from "../utils/http.js";

/* ===============================
   Helpers
================================= */

// (اختياري)
const getFromFlat = (flat, ...tokens) => {
  const keys = Object.keys(flat).map((k) => k.toLowerCase());
  const toks = tokens.map((t) => t.toLowerCase());
  const hit = keys.find((k) => toks.some((t) => k.includes(t)));
  return hit ? flat[hit] : null;
};

const nz = (v) => (v === "" || v === undefined ? null : v);
const normKey = (k) =>
  String(k)
    .toLowerCase()
    .normalize("NFKD")
    // دعم أحرف عربية
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "");

const normalizeRole = (role) => {
  const allowed = ["Admin", "Teacher", "Coordinator", "IT Support", "Principal", "Cycle Head"];
  if (!role) return "Teacher";
  const r = String(role).trim().toLowerCase();
  const hit = allowed.find((a) => a.toLowerCase() === r);
  return hit || "Teacher";
};

async function uniqueUsernameFrom(baseLabel) {
  const base = (baseLabel || "user").toLowerCase().replace(/[^a-z0-9_]/g, "") || "user";
  let candidate = base;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [r] = await pool.execute("SELECT id FROM users WHERE username = ? LIMIT 1", [candidate]);
    if (!r.length) return candidate;
    candidate = `${base}${i++}`;
  }
}

function genTempPassword(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const toDate = (v) => {
  if (!v) return null;
  const s = String(v).trim().replace(/\//g, "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const toInt = (v) =>
  v === null || v === undefined || v === ""
    ? null
    : Number.isFinite(parseInt(v, 10))
    ? parseInt(v, 10)
    : null;
const toDec = (v) =>
  v === null || v === undefined || v === ""
    ? null
    : Number.isFinite(parseFloat(v))
    ? parseFloat(v)
    : null;

// جرّبي تفكيك أي JSON سلاسل
function parseJsonIfPossible(x) {
  if (typeof x !== "string") return x;
  const t = x.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return x;
  try {
    return JSON.parse(t);
  } catch {
    return x;
  }
}

// فكّ أي nested object إلى خريطة مفاتيح مسطّحة
function flattenDeep(obj, prefix = [], out = {}) {
  const val = parseJsonIfPossible(obj);
  if (val !== obj) return flattenDeep(val, prefix, out);

  if (val !== null && typeof val === "object" && !Array.isArray(val)) {
    for (const [k, v] of Object.entries(val)) {
      flattenDeep(v, [...prefix, k], out);
    }
  } else if (Array.isArray(val)) {
    val.forEach((v, i) => flattenDeep(v, [...prefix, String(i)], out));
  } else {
    const flatKey = normKey(prefix.join(".")); // ex: "profile.dob" -> "profiledob"
    out[flatKey] = val;
  }
  return out;
}

/* ===============================
   Tokens (EN + AR)
================================= */

const TOK = {
  dob: ["dob", "dateofbirth", "birthdate", "تاريخالميلاد", "ميلاد"],
  place_of_birth: ["placeofbirth", "birthplace", "pob", "مكانالولادة", "محلالولادة"],
  address: ["address", "homeaddress", "addr", "العنوان", "عنوان"],
  gender: ["gender", "sex", "الجنس"],
  phone: [
    "phonenumber",
    "phone",
    "mobile",
    "whatsapp",
    "tel",
    "الهاتف",
    "موبايل",
    "واتساب",
    "رقمالهاتف",
    "رقمالجوال",
  ],
  marital_status: ["maritalstatus", "marriagestatus", "marital", "الحالةالاجتماعية", "الحالهالاجتماعيه"],
  children_info: ["childreninfo", "children", "kids", "child", "الأبناء", "الاولاد", "الأطفال"],
  degree_title: [
    "degreetitle",
    "degree",
    "major",
    "specialization",
    "speciality",
    "specialty",
    "الشهادة",
    "الاختصاص",
    "التخصص",
  ],
  degree_year: ["degreeyear", "graduationyear", "gradyear", "سنةالتخرج", "سنهالتخرج"],
  degree_university: ["degreeuniversity", "university", "college", "institute", "الجامعة", "الجامعه", "الكلية", "المعهد"],
  training_desc: ["trainingdesc", "training", "courses", "workshop", "certificate", "certification", "الدورات", "ورش", "شهادات"],
  salary: ["salary", "wage", "pay", "راتب", "الأجر", "الاجر"],
  subjects: ["subjects", "subjectlist", "المواد", "المادة"],
  grades: ["grades", "gradelist", "الصفوف", "الصف", "المرحلة"],
  experience_years: ["experienceyears", "yearsexperience", "yearsofexperience", "experience", "سنواتالخبرة", "خبرة"],
  job_title: ["jobtitle", "position", "title", "المسمىالوظيفي", "الوظيفة", "المسمى"],
  degree_major: ["degreemajor","major","specialization","التخصص","الاختصاص"],
  availability_json: ["availabilityjson","availability","avail","دوام","ساعاتالدوام"],
  weekly_minutes: ["weeklyminutes"],
  total_periods: ["totalperiods"],
  period_minutes: ["periodminutes"],
  total_hours: ["totalhours"],
  class_ids: ["classids","class_ids","gradeids"],
  class_names: ["classnames","class_names","gradenames"],
};

const getTok = (flat, tokens) => {
  const toks = tokens.map((t) => normKey(t)); // طبّقي نفس التطبيع
  const keys = Object.keys(flat); // keys مطبّعة من flattenDeep
  const hit = keys.find((k) => toks.some((t) => k.includes(t)));
  return hit ? flat[hit] : null;
};

/* ===============================
   Status helpers
================================= */
const toClientStatus = (s) =>
  String(s || "").toUpperCase() === "ACTIVE" ? "Active" : "Inactive";

const toDbStatus = (s) =>
  String(s || "").toLowerCase() === "active" ? "Active" : "Inactive";

/* ===============================
   Controllers
================================= */

// GET /api/users/teachers
export const listTeachers = async (_req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, full_name, username FROM users WHERE role='Teacher' ORDER BY id DESC"
    );
    const teachers = rows.map((u) => ({ id: u.id, name: u.full_name, username: u.username }));
    ok(res, { teachers });
  } catch (e) {
    next(e);
  }
};

// GET /api/users
export const listUsers = async (req, res, next) => {
  try {
    const { role, grade, status } = req.query;

    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.role, u.email, u.status, tp.phone, tp.grades, tp.class_names
       FROM users u
       LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
       ORDER BY u.id DESC`
    );

    let data = rows.map((r) => ({
      id: r.id,
      name: r.full_name,
      role: r.role,
      email: r.email,
      phone: r.phone || "",
      status: toClientStatus(r.status),
      grade: (r.class_names || r.grades || "").split(",")[0] || "",
    }));

    if (role && role !== "All") data = data.filter((d) => d.role === role);
    if (grade && grade !== "All") data = data.filter((d) => d.grade === grade);
    if (status && status !== "All") data = data.filter((d) => d.status === status);

    res.json({ users: data });
  } catch (e) {
    next(e);
  }
};

// GET /api/users/:id (id أو username)
export const getUser = async (req, res, next) => {
  try {
    const key = String(req.params.id || "").trim();
    const isId = /^\d+$/.test(key);
    const params = [key];
    const where = isId ? "u.id = ?" : "u.username = ?";

    const [[u]] = await pool.execute(
      `SELECT 
         u.id, u.full_name, u.username, u.email, u.role, u.status,
         tp.dob, tp.place_of_birth, tp.address, tp.gender, tp.phone, tp.marital_status, tp.children_info,
         tp.degree_title, tp.degree_year, tp.degree_university, tp.training_desc, tp.salary,
         tp.subjects, tp.grades, tp.experience_years, tp.job_title, tp.degree_major,
         tp.availability_json, tp.weekly_minutes, tp.total_periods, tp.period_minutes, tp.total_hours,
         tp.class_ids, tp.class_names, tp.civil_id_file_path,
         tp.class_subjects_map            -- ⭐ NEW
       FROM users u
       LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
       WHERE ${where}
       LIMIT 1`,
      params
    );

    if (!u) return res.status(404).json({ message: "User not found" });

    return res.json({
      id: u.id,
      name: u.full_name,
      username: u.username,
      email: u.email,
      role: u.role,
      status: toClientStatus(u.status),
      dob: u.dob,
      place_of_birth: u.place_of_birth,
      address: u.address,
      gender: u.gender,
      phone: u.phone,
      marital_status: u.marital_status,
      children_info: safeParse(u.children_info),
      degree_title: u.degree_title,
      degree_year: u.degree_year,
      degree_university: u.degree_university,
      training_desc: u.training_desc,
      salary: u.salary,
      subjects: u.subjects,
      grades: u.grades,
      experience_years: u.experience_years,
      job_title: u.job_title,
      degree_major: u.degree_major,
      availability_json: safeParse(u.availability_json),
      weekly_minutes: u.weekly_minutes,
      total_periods: u.total_periods,
      period_minutes: u.period_minutes,
      total_hours: u.total_hours,
      class_ids: u.class_ids,
      class_names: u.class_names,
      civil_id_file_path: u.civil_id_file_path,
      class_subjects_map: safeParse(u.class_subjects_map), // ⭐ NEW
    });
  } catch (e) {
    next(e);
  }
};

function safeParse(x) {
  if (!x) return null;
  try { return typeof x === "string" ? JSON.parse(x) : x; } catch { return x; }
}

// PATCH /api/users/:id
export const updateUser = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    // body → flatten، مع التقاط حقول JSON الخام قبل الفلَتنغ
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (body?.user && typeof body.user === "object") body = body.user;
    if (body?.form && typeof body.form === "object") body = body.form;

    // التقط الحقول الحساسة قبل الفلَتنغ
    const availability_raw =
      body?.availability_json !== undefined
        ? (typeof body.availability_json === "string" ? body.availability_json : JSON.stringify(body.availability_json))
        : undefined;

    const children_info_raw =
      body?.children_info !== undefined
        ? (typeof body.children_info === "string" ? body.children_info : JSON.stringify(body.children_info))
        : undefined;

    const class_subjects_map_raw =                 // ⭐ NEW
      body?.class_subjects_map !== undefined
        ? (typeof body.class_subjects_map === "string"
            ? body.class_subjects_map
            : JSON.stringify(body.class_subjects_map))
        : undefined;

    const flat = flattenDeep(body);

    // users fields
    const name0   = getTok(flat, ["full_name","fullname","name","الاسم","اسم"]);
    const email0  = getTok(flat, ["email","e_mail"]);
    const role0   = getTok(flat, ["role","userrole","position","الدور","الصلاحية","الوظيفة"]);
    const status0 = getTok(flat, ["status","الحالة","نشط","active","inactive"]);

    const name   = name0   !== null ? name0   : undefined;
    const email  = email0  !== null ? email0  : undefined;
    const role   = role0   !== null ? role0   : undefined;
    const status = status0 !== null ? status0 : undefined;

    // profile fields
    const dob               = toDate(getTok(flat, TOK.dob));
    const place_of_birth    = getTok(flat, TOK.place_of_birth);
    const address           = getTok(flat, TOK.address);
    const gender            = getTok(flat, TOK.gender);
    const phone             = getTok(flat, TOK.phone);
    const marital_status    = getTok(flat, TOK.marital_status);
    const degree_title      = getTok(flat, TOK.degree_title);
    const degree_year       = getTok(flat, TOK.degree_year);
    const degree_university = getTok(flat, TOK.degree_university);
    const training_desc     = getTok(flat, TOK.training_desc);
    const salary            = toDec(getTok(flat, TOK.salary));
    const subjects          = getTok(flat, TOK.subjects);
    const grades            = getTok(flat, TOK.grades);
    const experience_years  = toInt(getTok(flat, TOK.experience_years));
    const job_title         = getTok(flat, TOK.job_title);
    const degree_major      = getTok(flat, TOK.degree_major);

    // availability + load + classes
    const weekly_minutes = toInt(getTok(flat, TOK.weekly_minutes));
    const total_periods  = toInt(getTok(flat, TOK.total_periods));
    const period_minutes = toInt(getTok(flat, TOK.period_minutes));
    const total_hours    = toDec(getTok(flat, TOK.total_hours));
    const class_ids      = getTok(flat, TOK.class_ids);
    const class_names    = getTok(flat, TOK.class_names);

    await conn.beginTransaction();

    // users
    const setsU = []; const valsU = [];
    const addU = (col, val) => {
      if (val === undefined) return;
      if (typeof val === "string" && val.trim() === "") return; // لا تكتب فاضي
      if (val === null) { setsU.push(`${col} = NULL`); return; }
      setsU.push(`${col} = ?`); valsU.push(val);
    };
    addU("full_name", name);
    addU("email", email);
    addU("role", normalizeRole(role));
    addU("status", toDbStatus(status));
    if (setsU.length) { valsU.push(id); await conn.execute(`UPDATE users SET ${setsU.join(", ")} WHERE id = ?`, valsU); }

    // teacher_profiles: أنشئ صف إذا ناقص
    const [[p0]] = await conn.execute(`SELECT user_id FROM teacher_profiles WHERE user_id = ?`, [id]);
    if (!p0) { await conn.execute(`INSERT INTO teacher_profiles (user_id) VALUES (?)`, [id]); }

    // addP: لا تكتب سلاسل فاضية، واقبلي null لمسح القيمة
    const setsP = []; const valsP = [];
    const addP = (col, val) => {
      if (val === undefined) return;
      if (typeof val === "string" && val.trim() === "") return; // تجاهل فاضي
      if (val === null) { setsP.push(`${col} = NULL`); return; }
      setsP.push(`${col} = ?`); valsP.push(val);
    };
    addP("dob", dob);
    addP("place_of_birth", place_of_birth);
    addP("address", address);
    addP("gender", gender);
    addP("phone", phone);
    addP("marital_status", marital_status);
    addP("children_info", children_info_raw); // JSON خام
    addP("degree_title", degree_title);
    addP("degree_year", degree_year);
    addP("degree_university", degree_university);
    addP("training_desc", training_desc);
    addP("salary", salary);
    addP("subjects", subjects);
    addP("grades", grades);
    addP("experience_years", experience_years);
    addP("job_title", job_title);
    addP("degree_major", degree_major);
    addP("availability_json", availability_raw); // JSON خام
    addP("weekly_minutes", weekly_minutes);
    addP("total_periods", total_periods);
    addP("period_minutes", period_minutes);
    addP("total_hours", total_hours);
    addP("class_ids", class_ids);
    addP("class_names", class_names);
    addP("class_subjects_map", class_subjects_map_raw); // ⭐ NEW

    if (setsP.length) {
      valsP.push(id);
      await conn.execute(`UPDATE teacher_profiles SET ${setsP.join(", ")} WHERE user_id = ?`, valsP);
    }

    await conn.commit();

    // نسخة كاملة محدّثة
    const [[u2]] = await conn.execute(
      `SELECT u.id, u.full_name, u.username, u.role, u.email, u.status,
              tp.dob, tp.place_of_birth, tp.address, tp.gender, tp.phone, tp.marital_status, tp.children_info,
              tp.degree_title, tp.degree_year, tp.degree_university, tp.training_desc, tp.salary,
              tp.subjects, tp.grades, tp.experience_years, tp.job_title, tp.degree_major,
              tp.availability_json, tp.weekly_minutes, tp.total_periods, tp.period_minutes, tp.total_hours,
              tp.class_ids, tp.class_names, tp.class_subjects_map           -- ⭐ NEW
       FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
       WHERE u.id = ?`,
      [id]
    );

    res.json({
      id: u2.id,
      name: u2.full_name,
      username: u2.username,
      email: u2.email,
      role: u2.role,
      status: toClientStatus(u2.status),
      dob: u2.dob, place_of_birth: u2.place_of_birth, address: u2.address, gender: u2.gender,
      phone: u2.phone, marital_status: u2.marital_status, children_info: safeParse(u2.children_info),
      degree_title: u2.degree_title, degree_year: u2.degree_year, degree_university: u2.degree_university,
      training_desc: u2.training_desc, salary: u2.salary,
      subjects: u2.subjects, grades: u2.grades, experience_years: u2.experience_years, job_title: u2.job_title,
      degree_major: u2.degree_major,
      availability_json: safeParse(u2.availability_json),
      weekly_minutes: u2.weekly_minutes, total_periods: u2.total_periods, period_minutes: u2.period_minutes, total_hours: u2.total_hours,
      class_ids: u2.class_ids, class_names: u2.class_names,
      class_subjects_map: safeParse(u2.class_subjects_map), // ⭐ NEW
    });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    if (e?.code === "ER_BAD_FIELD_ERROR" || e?.code === "ER_TRUNCATED_WRONG_VALUE") {
      return res.status(400).json({ message: e.sqlMessage || e.message, code: e.code });
    }
    next(e);
  } finally {
    conn.release();
  }
};

// POST /api/users
export const createUser = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    // 0) body
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (body?.user && typeof body.user === "object") body = body.user;
    if (body?.form && typeof body.form === "object") body = body.form;

    // 1) التقط JSON الخام قبل الفلَتنغ
    const availability_raw =
      body?.availability_json !== undefined
        ? (typeof body.availability_json === "string" ? body.availability_json : JSON.stringify(body.availability_json))
        : null;

    const children_info_raw =
      body?.children_info !== undefined
        ? (typeof body.children_info === "string" ? body.children_info : JSON.stringify(body.children_info))
        : null;

    const class_subjects_map_raw =                  // ⭐ NEW
      body?.class_subjects_map !== undefined
        ? (typeof body.class_subjects_map === "string"
            ? body.class_subjects_map
            : JSON.stringify(body.class_subjects_map))
        : null;

    // 2) flatten
    const flat = flattenDeep(body);

    // 3) users fields
    const full_name0 = getTok(flat, ["full_name", "fullname", "name", "الاسم", "اسم"]);
    const email0 = getTok(flat, ["email", "e_mail"]);
    const username0 = getTok(flat, ["username", "user_name", "uname", "login", "اسم_المستخدم", "مستخدم"]);
    const role0 = getTok(flat, ["role", "userrole", "position", "الدور", "الصلاحية", "الوظيفة"]);

    let email = nz(email0);
    let username = username0 ? String(username0).trim() : null;
    let full_name = full_name0;
    if (!full_name) {
      if (username) full_name = username;
      else if (email) full_name = String(email).split("@")[0].replace(/[._-]+/g, " ");
      else full_name = "New User";
    }

    if (email) {
      const [eRows] = await pool.execute("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
      if (eRows.length) email = null; // ما نوقف العملية
    }
    if (username) {
      const [uRows] = await pool.execute("SELECT id FROM users WHERE username = ? LIMIT 1", [username]);
      if (uRows.length) username = null;
    }
    if (!username) username = await uniqueUsernameFrom(full_name.split(/\s+/)[0]);

    const tempRaw = genTempPassword(6);
    const finalPassword = await bcrypt.hash(tempRaw, 10);
    const role = normalizeRole(role0);

    // 4) teacher_profiles fields
    const dob = toDate(getTok(flat, TOK.dob));
    const place_of_birth = nz(getTok(flat, TOK.place_of_birth));
    const address = nz(getTok(flat, TOK.address));
    const gender = nz(getTok(flat, TOK.gender));
    const phone = nz(getTok(flat, TOK.phone));
    const marital_status = nz(getTok(flat, TOK.marital_status));
    const degree_title = nz(getTok(flat, TOK.degree_title));
    const degree_year = nz(getTok(flat, TOK.degree_year));
    const degree_university = nz(getTok(flat, TOK.degree_university));
    const training_desc = nz(getTok(flat, TOK.training_desc));
    const salary = toDec(getTok(flat, TOK.salary));
    const subjects = nz(getTok(flat, TOK.subjects));
    const grades = nz(getTok(flat, TOK.grades));
    const experience_years = toInt(getTok(flat, TOK.experience_years));
    const job_title = nz(getTok(flat, TOK.job_title));
    const degree_major = nz(getTok(flat, TOK.degree_major));

    const weekly_minutes = toInt(getTok(flat, TOK.weekly_minutes));
    const total_periods  = toInt(getTok(flat, TOK.total_periods));
    const period_minutes = toInt(getTok(flat, TOK.period_minutes));
    const total_hours    = toDec(getTok(flat, TOK.total_hours));
    const class_ids      = nz(getTok(flat, TOK.class_ids));
    const class_names    = nz(getTok(flat, TOK.class_names));

    const hasProfile = [
      dob, place_of_birth, address, gender, phone, marital_status, children_info_raw,
      degree_title, degree_year, degree_university, training_desc, salary, subjects, grades,
      experience_years, job_title, degree_major, availability_raw, weekly_minutes, total_periods,
      period_minutes, total_hours, class_ids, class_names, class_subjects_map_raw,   // ⭐ NEW
    ].some((v) => v !== null && v !== undefined && String(v).trim?.() !== "");

    // 5) Transaction
    await conn.beginTransaction();

    const [uRes] = await conn.execute(
      `INSERT INTO users (full_name, email, username, password, role)
       VALUES (?, ?, ?, ?, ?)` ,
      [full_name, email, username, finalPassword, role]
    );
    const userId = uRes.insertId;

    if (hasProfile) {
      await conn.execute(
        `INSERT INTO teacher_profiles
         (user_id, dob, place_of_birth, address, gender, phone, marital_status, children_info,
          degree_title, degree_year, degree_university, training_desc, salary,
          subjects, grades, experience_years, job_title, degree_major,
          availability_json, weekly_minutes, total_periods, period_minutes, total_hours,
          class_ids, class_names, class_subjects_map)                -- ⭐ NEW
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          userId,
          dob, place_of_birth, address, gender, phone, marital_status, children_info_raw,
          degree_title, degree_year, degree_university, training_desc, salary,
          subjects, grades, experience_years, job_title, degree_major,
          availability_raw, weekly_minutes, total_periods, period_minutes, total_hours,
          class_ids, class_names, class_subjects_map_raw,            // ⭐ NEW
        ]
      );
    }

    await conn.commit();
    created(res, {
      user: { id: userId, full_name, email, username, role },
      temp_password: tempRaw,
    });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    if (e?.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({ message: "teacher_profiles table is missing. Create it then retry." });
    }
    if (e?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Duplicate entry", code: e.code });
    }
    if (e?.code === "ER_BAD_FIELD_ERROR" || e?.code === "ER_TRUNCATED_WRONG_VALUE") {
      return res.status(400).json({ message: e.sqlMessage || e.message, code: e.code });
    }
    next(e);
  } finally {
    conn.release();
  }
};

// PATCH /api/users/:id/credentials
export const updateCredentials = async (req, res, next) => {
  try {
    const { id } = req.params;

    // يدعم JSON و FormData
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (body?.user && typeof body.user === "object") body = body.user;
    if (body?.form && typeof body.form === "object") body = body.form;

    const username =
      body.username ?? body.user_name ?? body.uname ?? body.login ?? undefined;
    const password =
      body.password ?? body.pass ?? body.pwd ?? undefined;

    const sets = [];
    const vals = [];

    if (username !== undefined) {
      const uname = String(username).trim();
      if (!uname) return res.status(400).json({ message: "Username cannot be empty" });

      const [dups] = await pool.execute(
        "SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1",
        [uname, id]
      );
      if (dups.length) return res.status(409).json({ message: "Username already taken" });

      sets.push("username = ?");
      vals.push(uname);
    }

    if (password !== undefined) {
      const pw = String(password).trim();
      if (!pw) return res.status(400).json({ message: "Password cannot be empty" });
      if (pw.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      const hash = await bcrypt.hash(pw, 10);
      sets.push("password = ?");
      vals.push(hash);
    }

    if (!sets.length) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    vals.push(id);
    await pool.execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, vals);

    const [[u]] = await pool.execute(
      "SELECT id, full_name, username, email, role, status FROM users WHERE id = ?",
      [id]
    );
    return res.json({
      id: u.id,
      name: u.full_name,
      username: u.username,
      email: u.email,
      role: u.role,
      status: toClientStatus(u.status),
    });
  } catch (e) { next(e); }
};

// مسار تشخيصي
export const debugEcho = (req, res) => {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch {}
  }
  if (body?.user && typeof body.user === "object") body = body.user;
  if (body?.form && typeof body.form === "object") body = body.form;

  const flat = flattenDeep(body);
  res.json({
    contentType: req.headers["content-type"],
    bodyKeys: Object.keys(req.body || {}),
    flatKeys: Object.keys(flat),
    flatSample: Object.fromEntries(Object.entries(flat).slice(0, 30)),
  });
};
