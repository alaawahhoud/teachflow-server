// teachflow-server/src/health.js
import express from "express";

const app = express();
const PORT = 4000; // force 4000 for this test

app.get("/", (_req, res) => res.send("TeachFlow API HEALTH OK"));
app.get("/api/users", (_req, res) => res.json([]));

app.listen(PORT, () => {
  console.log(`HEALTH server on http://localhost:${PORT}`);
});
