import type { NextApiRequest, NextApiResponse } from "next";
import { buildCsvTemplate } from "@/lib/csv-import";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const csv = buildCsvTemplate();
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="linki-import-template.csv"`);
  res.status(200).send(csv);
}
