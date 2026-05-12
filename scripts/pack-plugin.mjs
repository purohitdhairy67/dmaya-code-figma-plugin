import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const distDir = resolve(root, "dist");
const zipPath = resolve(distDir, "dmaya-html-to-figma-plugin.zip");
const requiredFiles = ["manifest.json", "code.js", "ui.html", "README.md"];

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) {
    throw new Error(`Missing required plugin file: ${file}`);
  }
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const zipResult = spawnSync("zip", ["-qr", zipPath, ...requiredFiles, "REGRESSION_BASELINE.md"], {
  cwd: root,
  stdio: "inherit",
});

if (zipResult.status !== 0) {
  throw new Error("Failed to create plugin zip.");
}

console.log(`Created ${basename(zipPath)} in ${distDir}`);
