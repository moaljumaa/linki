import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { listApolloLists } from "@/lib/apollo";

/** GET — Apollo's saved lists (id, name, count), for the "Import from Apollo" picker. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = getDb();
  const integration = db.prepare("SELECT api_key FROM integrations WHERE key = 'apollo'").get() as
    | { api_key: string }
    | undefined;
  const apiKey = integration?.api_key ? decryptSecret(integration.api_key) : null;
  if (!apiKey) return res.status(400).json({ error: "Apollo integration not configured" });

  try {
    const lists = await listApolloLists(apiKey);
    return res.json({ lists });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Apollo request failed" });
  }
}
