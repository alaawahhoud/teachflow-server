import multer from "multer";
import path from "path";
import fs from "fs";

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let sub = "misc";
    if (file.fieldname === "profilePhoto") sub = "profile";
    if (file.fieldname === "degreeFiles") sub = "degrees";
    if (file.fieldname === "trainingFiles") sub = "trainings";
    const dest = path.join(process.cwd(), "uploads", sub);
    ensureDir(dest);
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const safe = (file.originalname || "file").replace(/\s+/g, "_").replace(/[^\w.-]/g, "");
    cb(null, `${Date.now()}_${safe}`);
  }
});

export const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }
});
