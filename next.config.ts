import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3", "playwright", "playwright-extra", "puppeteer-extra-plugin-stealth"],
};

export default nextConfig;
