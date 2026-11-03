#!/usr/bin/env node
/*
 * scripts/strip-mirrored-pages.js <targetDir>
 *
 * Removes the premium pages that scripts/mirror-ee.js copied into pages/**, using the
 * manifest it wrote. Also removes the generated pages/.gitignore and prunes any now-empty
 * directories left behind (e.g. pages/api/oauth/ after all its routes are stripped).
 *
 * Used by .publish/publish.sh and .publish/dry-run.sh so the public tree contains only
 * genuinely open-core routes. Idempotent; no-op if there's no manifest. See docs/OPEN_CORE.md.
 */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || process.cwd();
const pagesDir = path.join(root, "pages");
const manifestPath = path.join(pagesDir, ".ee-mirror-manifest.json");

if (!fs.existsSync(manifestPath)) {
  console.log("  (no mirror manifest — nothing to strip)");
  process.exit(0);
}

const { files } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// Remove mirrored files, collecting their parent dirs for empty-pruning.
const touchedDirs = new Set();
for (const rel of files) {
  const p = path.join(pagesDir, rel);
  if (fs.existsSync(p)) fs.rmSync(p);
  touchedDirs.add(path.dirname(p));
}

fs.rmSync(manifestPath);
const gi = path.join(pagesDir, ".gitignore");
if (fs.existsSync(gi)) fs.rmSync(gi);

// Prune empty dirs bottom-up (deepest first), but never remove pages/ itself.
const dirsDeepestFirst = [...touchedDirs].sort((a, b) => b.length - a.length);
for (const dir of dirsDeepestFirst) {
  let d = dir;
  while (d.startsWith(pagesDir) && d !== pagesDir) {
    if (fs.existsSync(d) && fs.readdirSync(d).length === 0) {
      fs.rmdirSync(d);
      d = path.dirname(d);
    } else {
      break;
    }
  }
}

console.log(`  stripped ${files.length} mirrored premium page(s)`);
