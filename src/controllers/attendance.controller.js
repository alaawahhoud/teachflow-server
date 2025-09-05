import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ok, created, notFound, badRequest } from '../utils/http.js';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, '../../data/attendance.json');

const read = () => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const write = (data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

export const list = (req, res, next) => {
  try {
    const { date, teacherId } = req.query;
    let data = read();
    if (date) data = data.filter(r => r.date === date);
    if (teacherId) data = data.filter(r => r.teacher_id === teacherId);
    ok(res, { records: data });
  } catch (e) { next(e); }
};

export const create = (req, res, next) => {
  try {
    const { teacher_id, date, status, time_in = null, time_out = null } = req.body || {};
    if (!teacher_id || !date || !status) throw badRequest('teacher_id, date, status are required');
    const data = read();
    const rec = { id: uuid(), teacher_id, date, status, time_in, time_out };
    data.push(rec);
    write(data);
    created(res, { record: rec });
  } catch (e) { next(e); }
};

export const update = (req, res, next) => {
  try {
    const data = read();
    const idx = data.findIndex(r => r.id === req.params.id);
    if (idx === -1) throw notFound('Attendance record not found');
    data[idx] = { ...data[idx], ...req.body };
    write(data);
    ok(res, { record: data[idx] });
  } catch (e) { next(e); }
};
