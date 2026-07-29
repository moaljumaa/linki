import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

const INTERNAL_HEADER = "x-internal-secret";

/**
 * Shared request-auth check used by proxy.ts to gate /api/*.
 *
 * Accepts either:
 *  - a NextAuth session cookie (browser app) — verified via getToken().
 *  - the internal service secret (server-to-server loopback calls, e.g. the MCP server's
 *    tool handlers calling Linki's own /api/* routes — see ee/mcp/server.ts). This secret
 *    never leaves the host: it's not sent to a browser and never crosses the public ngrok/
 *    reverse-proxy path, only Node processes on 127.0.0.1 exchange it.
 *
 * Routes with their own independent auth (Authorization: Bearer, e.g. /api/mcp) are
 * excluded from the gate entirely in proxy.ts rather than special-cased here.
 */
export async function isAuthenticated(req: NextRequest): Promise<boolean> {
  if (await hasValidInternalSecret(req)) return true;

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  return token !== null;
}

async function hasValidInternalSecret(req: NextRequest): Promise<boolean> {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;

  const provided = req.headers.get(INTERNAL_HEADER);
  if (!provided) return false;

  return timingSafeEqual(provided, expected);
}

// Constant-time string comparison via Web Crypto (available on both the Edge and Node.js
// runtimes) so an internal-secret guess can't be timed byte-by-byte.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i];
  return diff === 0;
}
