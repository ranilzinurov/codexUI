import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const productionMode = args.includes("--production");
const rootArg = args.find((arg) => !arg.startsWith("--"));
const extensionRoot = rootArg
  ? resolve(process.cwd(), rootArg)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(extensionRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const requiredPermissions = [
  "activeTab",
  "alarms",
  "debugger",
  "scripting",
  "tabs",
  "sidePanel",
  "storage"
];
const productionHostPermissions = [
  "https://annotate.todo-tg-app.ru/*"
];
const developmentHostPermissions = [
  ...productionHostPermissions,
  "http://127.0.0.1/*",
  "http://localhost/*"
];
const requiredHostPermissions = productionMode ? productionHostPermissions : developmentHostPermissions;
const requiredFiles = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  "shared/constants.js",
  "shared/url-utils.js",
  "shared/pairing-client.js",
  "shared/selection-context.js",
  "shared/annotation-queue.js",
  "shared/devtools-capture.js",
  "shared/screenshot-crop.js",
  "content/content-script.js"
];

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(
  manifest.background?.service_worker === "service-worker/service-worker.js",
  "background.service_worker must point at service-worker/service-worker.js"
);
assert(
  manifest.side_panel?.default_path === "sidepanel/sidepanel.html",
  "side_panel.default_path must point at sidepanel/sidepanel.html"
);
assert(
  manifest.commands?._execute_action?.suggested_key?.default === "Ctrl+Shift+Y",
  "commands._execute_action must provide the annotation keyboard shortcut"
);

for (const permission of requiredPermissions) {
  assert(
    manifest.permissions?.includes(permission),
    `missing required permission: ${permission}`
  );
}

for (const hostPermission of requiredHostPermissions) {
  assert(
    manifest.host_permissions?.includes(hostPermission),
    `missing required host permission: ${hostPermission}`
  );
}
assert(
  Array.isArray(manifest.host_permissions) &&
    manifest.host_permissions.length === requiredHostPermissions.length &&
    manifest.host_permissions.every((permission, index) =>
      permission === requiredHostPermissions[index]
    ),
  `host_permissions must be limited to ${productionMode ? "the production origin" : "production plus local development origins"}: ${requiredHostPermissions.join(", ")}`
);

const csp = manifest.content_security_policy?.extension_pages || "";
assert(!csp.includes("'unsafe-inline'"), "content_security_policy must not allow unsafe-inline");
assert(!csp.includes("'unsafe-eval'"), "content_security_policy must not allow unsafe-eval");
assert(!/https?:\/\//u.test(csp), "content_security_policy must not allow remote script origins");

for (const relativePath of requiredFiles) {
  assert(relativePath, "manifest referenced an empty file path");
  await readFile(resolve(extensionRoot, relativePath), "utf8");
}

if (productionMode) {
  await readFile(resolve(extensionRoot, "dev", "test-page.html"), "utf8")
    .then(() => {
      throw new Error("production artifact must not include dev/test-page.html");
    })
    .catch((error) => {
      if (error && error.code === "ENOENT") return;
      throw error;
    });
}

console.log(`Extension manifest/static validation passed${productionMode ? " for production artifact" : ""}.`);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
