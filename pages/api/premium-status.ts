// GET /api/premium-status — open-core endpoint the UI uses to decide whether to render
// premium features or an "Upgrade to Premium" affordance. Returns { hasPremium } which is
// true in the commercial build (ee/ present) and false in the public open-source build.
import type { NextApiRequest, NextApiResponse } from "next";
import { hasPremium } from "@/lib/premium";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ hasPremium });
}
