const origins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);

export default {
  origin: (origin, cb) => {
    if (!origin || origins.length === 0 || origins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true
};
