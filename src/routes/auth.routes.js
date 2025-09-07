import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';   // ✅ بس استورد pool من db.js

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    const identifier = (email ?? username)?.trim();

    if (!identifier || !password) {
      return res.status(400).json({ ok: false, message: 'Missing username/email or password' });
    }

    const [rows] = await pool.query(
      'SELECT id, full_name, username, email, password FROM users WHERE username = ? OR email = ? LIMIT 1',
      [identifier, identifier]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false, message: 'Invalid credentials' });
    }

    const user = rows[0];

    // إذا الباسوورد مشفّر Bcrypt (بيبدأ بـ $2..)، قارن ببكربت، غير هيك قارن نصّياً
    let passOK = false;
    if (user.password && user.password.startsWith('$2')) {
      passOK = await bcrypt.compare(password, user.password).catch(() => false);
    } else {
      passOK = password === user.password;
    }

    if (!passOK) {
      return res.status(401).json({ ok: false, message: 'Invalid credentials' });
    }

    return res.json({
      ok: true,
      user: { id: user.id, full_name: user.full_name, username: user.username, email: user.email },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

export default router;
