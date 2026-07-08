import type { NextApiRequest, NextApiResponse } from "next";
import { getUpdateState } from "@/lib/update-check";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.json(getUpdateState());
}
