import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(extensionRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const requiredPermissions = [
  "activeTab",
  "scripting",
  "tabs",
  "sidePanel"
];
const requiredHostPermissions = [
  "https://annotate.todo-tg-app.ru/*"
];
const requiredFiles = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  "shared/constants.js",
  "shared/url-utils.js",
  "shared/pairing-client.js",
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
  `host_permissions must be limited to: ${requiredHostPermissions.join(", ")}`
);

for (const relativePath of requiredFiles) {
  assert(relativePath, "manifest referenced an empty file path");
  await readFile(resolve(extensionRoot, relativePath), "utf8");
}

console.log("Extension manifest/static validation passed.");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
