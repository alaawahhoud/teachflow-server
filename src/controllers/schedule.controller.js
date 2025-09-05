// src/controllers/schedule.controller.js
import pool from "../db.js";

/* ============================ Utilities ============================ */

// أيام العمل: Monday..Thursday + Saturday (لا جمعة)
const UI_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Saturday"];
const PERIODS_PER_DAY = 7;
const WEEKLY_CAPACITY = UI_DAYS.length * PERIODS_PER_DAY; // 35

function normalizeDayKey(k) {
  const s = String(k || "").toLowerCase();
  if (s.startsWith("mon")) return "Monday";
  if (s.startsWith("tue")) return "Tuesday";
  if (s.startsWith("wed")) return "Wednesday";
  if (s.startsWith("thu")) return "Thursday";
  if (s.startsWith("fri")) return "Friday";
  if (s.startsWith("sat")) return "Saturday";
  if (s.startsWith("sun")) return "Sunday";
  return null;
}

function emptySchedule() {
  const out = {};
  UI_DAYS.forEach((d) => (out[d] = Array(PERIODS_PER_DAY).fill(null)));
  return out;
}

const pad = (n) => String(n).padStart(2, "0");
const hmToMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(":").map((x) => parseInt(x || "0", 10));
  return h * 60 + m;
};
const toHHMM = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

// KG/1/2/3: break بعد الثالثة، غيرهم بعد الرابعة
function breakAfterByClassName(className = "") {
  const s = String(className || "").toLowerCase();
  if (/(kg1|kg2|kg3|grade\s*1|grade\s*one|grade\s*2|grade\s*two|grade\s*3|grade\s*three)/.test(s)) {
    return 3;
  }
  return 4;
}

// 7 × 50د + 25د استراحة
function buildPeriodSpans({ startHH = 8, startMM = 0, perMin = 50, breakAfter = 4, breakMin = 25 }) {
  const spans = [];
  let cur = startHH * 60 + startMM;
  for (let i = 1; i <= PERIODS_PER_DAY; i++) {
    const s = cur;
    const e = s + perMin;
    spans.push({ start: toHHMM(s), end: toHHMM(e), s, e });
    cur = e;
    if (i === breakAfter) cur += breakMin;
  }
  return spans;
}

// availability_json -> grid يومي boolean[7] (نتجاهل أي يوم خارج UI_DAYS)
function availabilityToPeriods(availabilityJson, periodSpans) {
  const out = {};
  UI_DAYS.forEach((d) => (out[d] = Array(periodSpans.length).fill(false)));
  for (const k of Object.keys(availabilityJson || {})) {
    const norm = normalizeDayKey(k);
    if (!norm || !UI_DAYS.includes(norm)) continue;
    const day = availabilityJson[k];
    if (!day?.enabled) continue;
    for (const slot of day.slots || []) {
      const ss = hmToMinutes(slot.start);
      const ee = hmToMinutes(slot.end);
      if (ss == null || ee == null || ss >= ee) continue;
      for (let i = 0; i < periodSpans.length; i++) {
        const p = periodSpans[i];
        if (p.s >= ss && p.e <= ee) out[norm][i] = true;
      }
    }
  }
  return out;
}

const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

// RNG
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRNG(seed) {
  const rand = mulberry32(seed >>> 0);
  const shuffle = (arr) => {
    const x = [...arr];
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };
  const pickWeighted = (entries) => {
    const total = entries.reduce((s, e) => s + e.w, 0);
    if (total <= 0) return null;
    let r = rand() * total;
    for (const e of entries) {
      r -= e.w;
      if (r <= 0) return e.key;
    }
    return entries[entries.length - 1]?.key ?? null;
  };
  return { rand, shuffle, pickWeighted };
}

function pick(o, keys) {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

const normName = (s) => String(s || "").trim().toLowerCase();
const tKeyId = (id) => `id:${String(id)}`;
const tKeyName = (name) => `name:${normName(name)}`;

/* ---------- Helpers: safe rows ---------- */

function ensureScheduleRow(schedule, day) {
  if (!schedule[day] || !Array.isArray(schedule[day])) {
    schedule[day] = Array(PERIODS_PER_DAY).fill(null);
  } else if (schedule[day].length < PERIODS_PER_DAY) {
    for (let i = schedule[day].length; i < PERIODS_PER_DAY; i++) schedule[day][i] = null;
  }
  return day;
}

function ensureBusyDay(grid, day) {
  if (!grid[day] || !Array.isArray(grid[day])) {
    grid[day] = Array(PERIODS_PER_DAY).fill(false);
  } else if (grid[day].length < PERIODS_PER_DAY) {
    for (let i = grid[day].length; i < PERIODS_PER_DAY; i++) grid[day][i] = false;
  }
  return day;
}

// Map<teacherKey, { Monday:boolean[7], ... }>
function ensureBusyGrid(map, key) {
  if (!map.has(key)) {
    map.set(
      key,
      UI_DAYS.reduce((o, d) => ((o[d] = Array(PERIODS_PER_DAY).fill(false)), o), {})
    );
  }
  return map.get(key);
}

function setScheduleCell(schedule, day, pIdx, value) {
  const d = ensureScheduleRow(schedule, day);
  schedule[d][pIdx] = value;
}

/* ======================= DB helpers ======================= */

async function fetchClassInfo(classId) {
  const [[row]] = await pool.execute(
    "SELECT id, name, grade, section FROM classes WHERE id = ? LIMIT 1",
    [classId]
  );
  if (!row) return { id: classId, name: `Class ${classId}` };
  const name =
    row.name ||
    `${row.grade || ""}${row.section ? ` ${row.section}` : ""}`.trim() ||
    `Class ${row.id}`;
  return { id: row.id, name };
}

async function getSubjectsForClass(classId) {
  const [rows] = await pool.execute("SELECT * FROM subjects WHERE class_id = ?", [classId]);

  const NAME_KEYS = ["name","subject","subject_name","title","material","course","اسم","اسم_المادة","المادة","الماده"];
  const HOURS_KEYS = ["weekly_hours","hours","hours_per_week","weekly_periods","periods","num_periods","num_hours","sessions","sessions_per_week","per_week","حصص","عددالحصص","عدد_الحصص"];
  const TEACHER_ID_KEYS = ["teacher_user_id","teacher_id","user_id","t_user_id","المعلم_id"];
  const TEACHER_NAME_KEYS = ["teacher_name","teacher","teacher_full_name","t_name","full_name","اسم_المعلم","المعلم"];

  const out = [];
  for (const r of rows) {
    const subject = pick(r, NAME_KEYS);
    if (!subject) continue;
    let hours = pick(r, HOURS_KEYS);
    hours = (hours === undefined || hours === null || String(hours).trim?.() === "") ? 1 : Number(hours);
    if (!Number.isFinite(hours) || hours < 0) hours = 1;

    const teacherId = pick(r, TEACHER_ID_KEYS);
    const teacherName = pick(r, TEACHER_NAME_KEYS);

    out.push({
      subject: String(subject).trim(),
      weeklyHours: hours,
      teacherId: teacherId ?? null,
      teacherName: teacherName ?? null,
    });
  }
  return out;
}

async function fetchTeachersAvailability(periodSpans) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, COALESCE(tp.availability_json,'{}') AS availability_json
     FROM users u
     LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
     WHERE u.role = 'Teacher'`
  );
  const byId = new Map();
  const byName = new Map();

  for (const r of rows) {
    let av;
    try { av = JSON.parse(r.availability_json || "{}"); } catch { av = {}; }
    const grid = availabilityToPeriods(av, periodSpans);
    const entry = { id: r.id, name: r.full_name || `T${r.id}`, grid };
    byId.set(tKeyId(r.id), entry);
    byName.set(tKeyName(r.full_name), entry);
  }
  return { byId, byName };
}

async function fetchAllSchedulesExcept(classId, byNameMap) {
  const [rows] = await pool.execute(
    "SELECT class_id, schedule_json FROM class_schedules WHERE class_id <> ?",
    [classId]
  );
  const busy = new Map(); // key -> { Monday:[7], ... }

  const ensureGrid = (key) => {
    if (!busy.has(key)) {
      busy.set(
        key,
        UI_DAYS.reduce((o, d) => ((o[d] = Array(PERIODS_PER_DAY).fill(false)), o), {})
      );
    }
    return busy.get(key);
  };

  for (const r of rows) {
    let sch = null;
    try { sch = JSON.parse(r.schedule_json || "null"); } catch {}
    if (!sch || typeof sch !== "object") continue;

    for (const day of UI_DAYS) {
      const arr = Array.isArray(sch[day]) ? sch[day] : [];
      for (let i = 0; i < Math.min(PERIODS_PER_DAY, arr.length); i++) {
        const sess = arr[i];
        const nm = sess?.teacher || sess?.teacherName;
        if (!nm) continue;
        const kName = tKeyName(nm);
        ensureGrid(kName)[day][i] = true;

        const entry = byNameMap.get(kName);
        if (entry?.id != null) ensureGrid(tKeyId(entry.id))[day][i] = true;
      }
    }
  }
  return busy;
}

/* ======================= قواعد اليوم (≤3/يوم/مادة) ======================= */

function wouldMakeTriple(schedule, day, p, subject) {
  const at = (idx) => schedule[day]?.[idx]?.subject === subject;
  const left = p > 0 && at(p - 1);
  const right = p < PERIODS_PER_DAY - 1 && at(p + 1);
  const left2 = p > 1 && at(p - 2);
  const right2 = p < PERIODS_PER_DAY - 2 && at(p + 2);
  if (left && (left2 || right)) return true;
  if (right && (right2 || left)) return true;
  return false;
}

/* ============================ Endpoints ============================ */

// GET /api/schedule?classId=ID
export async function getSchedule(req, res, next) {
  try {
    const classId = req.query.classId;
    if (!classId) return res.status(400).json({ message: "classId is required" });
    const [[row]] = await pool.execute("SELECT schedule_json FROM class_schedules WHERE class_id = ?", [classId]);
    if (!row?.schedule_json) return res.json({});
    let sch = null;
    try { sch = JSON.parse(row.schedule_json); } catch {}
    res.json(sch || {});
  } catch (e) { next(e); }
}

// PUT /api/schedule?classId=ID
export async function putSchedule(req, res, next) {
  try {
    const classId = req.query.classId;
    if (!classId) return res.status(400).json({ message: "classId is required" });
    const body = (typeof req.body === "string") ? JSON.parse(req.body) : req.body;
    await pool.execute(
      "INSERT INTO class_schedules (class_id, schedule_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE schedule_json = VALUES(schedule_json)",
      [classId, JSON.stringify(body || {})]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
}

/* ======================= Auto-build (يحترم دوام المعلّم) ======================= */
export async function autoBuildSchedule(req, res, next) {
  const conn = await pool.getConnection();
  let classId, seed;
  try {
    classId = req.query.classId;
    if (!classId) return res.status(400).json({ message: "classId is required" });

    seed = Number(req.query.seed) || Date.now();
    const RNG = makeRNG(seed);

    const cls = await fetchClassInfo(classId);
    const breakAfter = breakAfterByClassName(cls.name);
    const periodSpans = buildPeriodSpans({ startHH: 8, startMM: 0, perMin: 50, breakAfter, breakMin: 25 });

    // توفّر المعلّمات
    const { byId, byName } = await fetchTeachersAvailability(periodSpans);
    const allTeachers = Array.from(new Map(
      Array.from(byId.values()).map(t => [t.name, t])
    ).values());
    const teacherPool = RNG.shuffle(
      allTeachers.map(t => ({ teacherName: t.name, teacherKey: tKeyId(t.id) }))
    );
    let teacherPoolIdx = 0;

    // ما رح نقيّد بتضارب صفوف أخرى الآن، بس منخلّي الدالة متاحة
    await fetchAllSchedulesExcept(classId, byName);

    const rows = await getSubjectsForClass(classId);

    // اجمع الساعات لكل مادة + اسم/مفتاح المعلّمة (مع تعبئة تلقائية)
    const subjectHours = new Map();   // subject -> hours
    const subjectTeacher = new Map(); // subject -> { teacherName, teacherKey }

    for (const r of rows) {
      const subj = (r.subject || "").trim();
      if (!subj) continue;

      const h = Math.max(0, Number(r.weeklyHours) || 0);
      subjectHours.set(subj, (subjectHours.get(subj) || 0) + h);

      let tName = (r.teacherName || "").trim();
      let tKey  = null;

      if (r.teacherId != null) {
        const entry = byId.get(tKeyId(r.teacherId));
        if (entry) {
          tName = entry.name || tName || "";
          tKey  = tKeyId(entry.id);
        } else {
          tKey = tKeyId(r.teacherId);
        }
      } else if (tName) {
        const byNm = byName.get(tKeyName(tName));
        if (byNm) tKey = tKeyId(byNm.id);
      }

      if (!subjectTeacher.has(subj)) {
        subjectTeacher.set(subj, { teacherName: tName, teacherKey: tKey });
      }
    }

    // تعبئة تلقائية للأسماء الناقصة
    for (const [subj, info] of subjectTeacher.entries()) {
      let tName = (info.teacherName || "").trim();
      let tKey  = info.teacherKey || null;
      if (!tName) {
        if (teacherPool.length) {
          const pick = teacherPool[teacherPoolIdx % teacherPool.length];
          teacherPoolIdx++;
          tName = pick.teacherName;
          tKey  = pick.teacherKey;
        } else {
          tName = "—";
          tKey  = null;
        }
      } else if (!tKey) {
        const byNm = byName.get(tKeyName(tName));
        if (byNm) tKey = tKeyId(byNm.id);
      }
      subjectTeacher.set(subj, { teacherName: tName, teacherKey: tKey });
    }

    // إذا أقل من 35 → كمل Activity
    let total = Array.from(subjectHours.values()).reduce((a, b) => a + b, 0);
    if (total < WEEKLY_CAPACITY) {
      subjectHours.set("Activity", (subjectHours.get("Activity") || 0) + (WEEKLY_CAPACITY - total));
      subjectTeacher.set("Activity", { teacherName: "", teacherKey: null });
      total = WEEKLY_CAPACITY;
    }

    // --- تحقّق القابلية بحسب دوام المعلّمة (≤3/اليوم) ---
    const teacherEntryOf = (tKey, tName) => {
      if (tKey && byId.get(tKey)) return byId.get(tKey);
      if (tName) {
        const nm = byName.get(tKeyName(tName));
        if (nm) return nm;
      }
      return null; // لا ملف → نعتبرها متاحة بالكامل
    };

    const weeklyMaxBySubject = {};
    for (const [subj, hours] of subjectHours.entries()) {
      const info = subjectTeacher.get(subj) || { teacherName: "", teacherKey: null };
      const entry = teacherEntryOf(info.teacherKey, info.teacherName);

      let weeklyMax = 0;
      if (!entry) {
        // لا توفّر محدد → متاح كل الأيام: حدّنا فقط 3/اليوم
        weeklyMax = UI_DAYS.length * 3;
      } else {
        for (const day of UI_DAYS) {
          const arr = entry.grid?.[day] || Array(PERIODS_PER_DAY).fill(false);
          const availCount = arr.reduce((s, v) => s + (v ? 1 : 0), 0);
          weeklyMax += Math.min(3, availCount);
        }
      }
      weeklyMaxBySubject[subj] = weeklyMax;

      if (hours > weeklyMax) {
        return res.status(422).json({
          message: `Subject "${subj}" needs ${hours} periods but teacher availability allows max ${weeklyMax} (≤3 per day rule).`,
          subject: subj,
          required: hours,
          max_available_with_rule: weeklyMax,
          teacher: info.teacherName || "(unknown)",
        });
      }
    }

    // سعة الأسبوع الكلّية
    if (total > WEEKLY_CAPACITY) {
      return res.status(422).json({
        message: `Total weekly hours (${total}) exceed weekly capacity (${WEEKLY_CAPACITY}).`,
        capacity: WEEKLY_CAPACITY, totalHours: total,
        bySubject: Array.from(subjectHours, ([subject, weeklyHours]) => ({ subject, weeklyHours }))
      });
    }

    /* ---------- التوزيع العشوائي مع احترام التوفّر و≤3/يوم ---------- */
    const schedule = emptySchedule();

    const remaining = new Map(subjectHours); // subject -> remaining
    const perDayCount = {}; // day -> Map<subject, countToday>
    for (const d of UI_DAYS) perDayCount[d] = new Map();

    const isTeacherAvailable = (subj, day, pIdx) => {
      const info = subjectTeacher.get(subj) || { teacherName: "", teacherKey: null };
      const entry = teacherEntryOf(info.teacherKey, info.teacherName);
      if (!entry) return true; // لا ملف → نفترض متاحة دائماً
      const arr = entry.grid?.[day];
      return Array.isArray(arr) ? !!arr[pIdx] : true;
    };

    const chooseSubjectFor = (day, pIdx) => {
      const entries = [];
      for (const [subj, rem] of remaining.entries()) {
        if (rem <= 0) continue;
        const usedToday = perDayCount[day].get(subj) || 0;
        if (usedToday >= 3) continue;                 // قاعدة ≤3/اليوم
        if (!isTeacherAvailable(subj, day, pIdx)) continue; // لازم المعلّمة تكون متاحة بهالحصّة
        entries.push({ key: subj, w: rem });
      }
      return RNG.pickWeighted(entries);
    };

    // جرّب عدّة مرات لو تعلّقنا بسبب القيود (تنويع ترتيب الأيام/الحصص)
    const tryOnce = () => {
      // إعادة الضوابط لكل محاولة
      for (const d of UI_DAYS) {
        perDayCount[d] = new Map();
        for (let i = 0; i < PERIODS_PER_DAY; i++) schedule[d][i] = null;
      }
      for (const [k, v] of subjectHours.entries()) remaining.set(k, v);

      const daysOrder = makeRNG(seed ^ 0x9e3779b1).shuffle(UI_DAYS);
      for (const day of daysOrder) {
        const periodsOrder = makeRNG(seed ^ day.length).shuffle([...Array(PERIODS_PER_DAY).keys()]);
        for (const p of periodsOrder) {
          let chosen = chooseSubjectFor(day, p);
          if (!chosen) return { ok: false, day, slot: p + 1 };

          const tInfo = subjectTeacher.get(chosen) || { teacherName: "", teacherKey: null };
          setScheduleCell(schedule, day, p, { subject: chosen, teacher: tInfo.teacherName || "", room: "" });
          remaining.set(chosen, (remaining.get(chosen) || 0) - 1);
          perDayCount[day].set(chosen, (perDayCount[day].get(chosen) || 0) + 1);

          if ((remaining.get(chosen) || 0) === 0) remaining.delete(chosen);
        }
      }
      return { ok: true };
    };

    let attemptOk = false;
    for (let attempt = 0; attempt < 6 && !attemptOk; attempt++) {
      const result = tryOnce();
      attemptOk = result.ok;
      if (!attemptOk && attempt === 5) {
        // تقرير مفصّل عن العُقَد
        const day = result.day;
        const slot = result.slot;
        const candidates = Array.from(remaining.entries()).map(([s, r]) => ({
          subject: s,
          remaining: r,
          used_today: perDayCount[day].get(s) || 0,
          teacher: (subjectTeacher.get(s)?.teacherName) || "",
          teacher_available: isTeacherAvailable(s, day, slot - 1),
        }));
        return res.status(409).json({
          message: `Couldn't place a subject at ${day} period ${slot} under teachers' availability and ≤3/day rule.`,
          day, slot, candidates
        });
      }
      // عدّل seed شوي بالمحاولة التالية
      seed = seed + 1013904223; // عدد أولي كبير لتغيير العشوائية
    }

    // تخزين
    await conn.beginTransaction();
    await conn.execute(
      "INSERT INTO class_schedules (class_id, schedule_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE schedule_json = VALUES(schedule_json)",
      [classId, JSON.stringify(schedule)]
    );
    await conn.commit();

    res.json({
      schedule,
      meta: {
        classId,
        className: cls.name,
        days: UI_DAYS.length,
        periods_per_day: PERIODS_PER_DAY,
        weekly_capacity: WEEKLY_CAPACITY,
        seed
      }
    });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    const msg = e?.sqlMessage || e?.message || "Auto-build crashed";
    console.error("[autoBuild] ERROR:", msg, "classId:", classId, "seed:", seed);
    return res.status(500).json({ message: msg });
  } finally {
    conn.release();
  }
}

export { autoBuildSchedule as autoBuild };
