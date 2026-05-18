import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const read = (path) => readFileSync(resolve(root, path), "utf8");
const failures = [];

const fail = (message) => failures.push(message);
const expect = (condition, message) => {
  if (!condition) fail(message);
};
const matchConst = (source, name) => {
  const match = source.match(new RegExp("const\\s+" + name + "\\s*=\\s*\"([^\"]+)\""));
  return match ? match[1] : "";
};

const pkg = JSON.parse(read("package.json"));
const manifest = JSON.parse(read("manifest.json"));
const code = read("code.js");
const ui = read("ui.html");
const readme = read("README.md");
const baseline = read("REGRESSION_BASELINE.md");
const changelog = read("CHANGELOG.md");
const storeListing = read("STORE_LISTING.md");

const syntax = spawnSync("node", ["--check", "code.js"], { cwd: root, encoding: "utf8" });
if (syntax.status !== 0) fail(syntax.stderr || syntax.stdout || "code.js syntax check failed.");

expect(!code.match(/\?\.|\?\?/), "code.js must not use optional chaining or nullish coalescing.");

const pluginVersion = matchConst(code, "PLUGIN_VERSION");
const pluginBuild = matchConst(code, "PLUGIN_BUILD");
const payloadVersion = matchConst(code, "SUPPORTED_PAYLOAD_VERSION");
const importPlanVersion = matchConst(code, "SUPPORTED_BACKEND_IMPORT_PLAN_VERSION");

expect(pluginVersion === pkg.version, `package.json version (${pkg.version}) must match PLUGIN_VERSION (${pluginVersion}).`);
expect(Boolean(pluginBuild), "PLUGIN_BUILD is missing.");
expect(payloadVersion === "html-to-figma-plugin-payload-v1", "Unexpected SUPPORTED_PAYLOAD_VERSION.");
expect(importPlanVersion === "figma-import-plan-v1", "Unexpected SUPPORTED_BACKEND_IMPORT_PLAN_VERSION.");
expect(ui.includes(`Plugin v${pluginVersion}`), "ui.html must show the current plugin version.");
expect(ui.includes(pluginBuild), "ui.html must show the current plugin build.");
expect(
  ui.includes("Made by dMaya ·") &&
    ui.includes("dmaya.ai") &&
    ui.includes("Unlimited free forever") &&
    ui.includes('href="https://dmaya.ai"') &&
    ui.includes('target="_blank"'),
  "ui.html must include the dMaya attribution link."
);
expect(
  ui.includes("Try the full design tool at") && ui.includes("success-cta"),
  "ui.html must include the success-state dMaya CTA."
);
expect(readme.startsWith("# HTML to Figma by dMaya"), "README.md must start with the approved H1.");
expect(
  readme.includes("[HTML to Figma by dMaya](https://dmaya.ai/html-to-figma)") &&
    readme.includes("[dMaya](https://dmaya.ai)"),
  "README.md must link to the converter and company in the opening copy."
);
[
  "HTML to Figma",
  "URL to Figma",
  "Claude Code to Figma",
  "Lovable to Figma",
  "Cursor to Figma",
  "Bolt to Figma",
  "v0 to Figma",
  "Replit to Figma",
  "AI output to Figma",
].forEach((keyword) => {
  expect(readme.includes(keyword), `README.md must include keyword: ${keyword}.`);
  expect(storeListing.includes(keyword), `STORE_LISTING.md must include keyword: ${keyword}.`);
});
expect(baseline.includes(pluginBuild), "REGRESSION_BASELINE.md must mention the current plugin build.");
expect(changelog.includes(`## ${pluginVersion}`), "CHANGELOG.md must include the current version.");

expect(manifest.name === "HTML to Figma by dMaya", "manifest name is unexpected.");
expect(manifest.api === "1.0.0", "manifest api must stay 1.0.0 unless deliberately upgraded and tested.");
expect(Array.isArray(manifest.editorType) && manifest.editorType.includes("figma"), "manifest editorType must include figma.");
expect(manifest.main === "code.js", "manifest main must be code.js.");
expect(manifest.ui === "ui.html", "manifest ui must be ui.html.");
expect(manifest.documentAccess === "dynamic-page", "manifest documentAccess must be dynamic-page.");
const allowedDomains = manifest.networkAccess && Array.isArray(manifest.networkAccess.allowedDomains)
  ? manifest.networkAccess.allowedDomains
  : [];
expect(
  allowedDomains.length === 2 &&
    allowedDomains.includes("https://dmaya-prod-r2.dmaya.ai") &&
    allowedDomains.includes("https://dmaya-dev-r2.dmaya.ai"),
  "manifest networkAccess.allowedDomains must be limited to the approved dMaya R2 asset domains."
);
expect(
  code.includes("fetch(asset.url)") && code.includes("dataUrlToBytes(asset.dataUrl)"),
  "code.js must support both temporary remote asset URLs and legacy inline data URLs."
);
expect(
  code.includes("figma.createImageAsync(asset.url)") && code.includes("import-progress"),
  "code.js must import remote assets through Figma's URL image API and report import progress."
);
expect(existsSync(resolve(root, "assets/dmaya-plugin-icon.svg")), "Missing assets/dmaya-plugin-icon.svg.");
expect(existsSync(resolve(root, "assets/dmaya-plugin-icon.png")), "Missing assets/dmaya-plugin-icon.png.");
expect(storeListing.includes("HTML to Figma by dMaya"), "STORE_LISTING.md must include the plugin name.");
expect(
  storeListing.includes("Free forever. Unlimited HTML, URLs, and AI output into editable Figma layers."),
  "STORE_LISTING.md must include the approved tagline."
);

if (failures.length > 0) {
  console.error("Release check failed:");
  failures.forEach((failure) => console.error("- " + failure));
  process.exit(1);
}

console.log(`Release check passed for plugin v${pluginVersion} (${pluginBuild}).`);
