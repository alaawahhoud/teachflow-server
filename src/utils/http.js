// src/utils/http.js
export const ok = (res, data) => res.status(200).json(data);
export const created = (res, data) => res.status(201).json(data);
export const noContent = (res) => res.status(204).end();
export const badRequest = (res, message = "Bad Request") =>
  res.status(400).json({ message });
