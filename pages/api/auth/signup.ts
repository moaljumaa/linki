import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, password, inviteCode } = req.body as {
    email?: string;
    password?: string;
    inviteCode?: string;
  };

  if (!email || !password || !inviteCode) {
    return res.status(400).json({ error: "Email, password, and invite code are required." });
  }

  const authPassword = process.env.AUTH_PASSWORD;
  if (!authPassword) {
    return res.status(500).json({ error: "AUTH_PASSWORD is not configured on this server." });
  }

  if (inviteCode !== authPassword) {
    return res.status(403).json({ error: "Invalid invite code." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const hash = await bcrypt.hash(password, 10);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(randomUUID(), email, hash);

  return res.status(201).json({ ok: true });
}
