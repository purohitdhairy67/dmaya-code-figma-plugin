import { readFileSync } from "node:fs";
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
const baseline = read("REGRESSION_BASELINE.md");
const changelog = read("CHANGELOG.md");

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
expect(baseline.includes(pluginBuild), "REGRESSION_BASELINE.md must mention the current plugin build.");
expect(changelog.includes(`## ${pluginVersion}`), "CHANGELOG.md must include the current version.");

expect(manifest.name === "dMaya HTML to Figma", "manifest name is unexpected.");
expect(manifest.api === "1.0.0", "manifest api must stay 1.0.0 unless deliberately upgraded and tested.");
expect(Array.isArray(manifest.editorType) && manifest.editorType.includes("figma"), "manifest editorType must include figma.");
expect(manifest.main === "code.js", "manifest main must be code.js.");
expect(manifest.ui === "ui.html", "manifest ui must be ui.html.");
expect(manifest.documentAccess === "dynamic-page", "manifest documentAccess must be dynamic-page.");
expect(
  manifest.networkAccess &&
    Array.isArray(manifest.networkAccess.allowedDomains) &&
    manifest.networkAccess.allowedDomains.length === 1 &&
    manifest.networkAccess.allowedDomains[0] === "none",
  "manifest networkAccess.allowedDomains must be [\"none\"] for this no-network importer."
);

if (failures.length > 0) {
  console.error("Release check failed:");
  failures.forEach((failure) => console.error("- " + failure));
  process.exit(1);
}

console.log(`Release check passed for plugin v${pluginVersion} (${pluginBuild}).`);
