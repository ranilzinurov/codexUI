import assert from "node:assert/strict";
import {
  buildDevToolsSmokePageHtml,
  createDevToolsSmokeServer,
  DEVTOOLS_SMOKE_PATHS
} from "./devtools-smoke-fixtures.mjs";

const html = buildDevToolsSmokePageHtml({ slowDelayMs: 120 });
for (const expected of [
  'id="console-info"',
  'id="console-warn"',
  'id="console-error"',
  'id="network-success"',
  'id="network-404"',
  'id="network-slow"',
  'id="network-fail"',
  "console.info",
  "console.warn",
  "console.error",
  DEVTOOLS_SMOKE_PATHS.success,
  DEVTOOLS_SMOKE_PATHS.notFound,
  DEVTOOLS_SMOKE_PATHS.slow,
  DEVTOOLS_SMOKE_PATHS.fail
]) {
  assert.ok(html.includes(expected), `fixture page should include ${expected}`);
}

const fixture = await createDevToolsSmokeServer({ port: 0, slowDelayMs: 120 });

try {
  const page = await fetch(`${fixture.origin}${DEVTOOLS_SMOKE_PATHS.page}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Codex annotation DevTools smoke page/);

  const success = await fetch(`${fixture.origin}${DEVTOOLS_SMOKE_PATHS.success}?marker=success-smoke`);
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), {
    ok: true,
    fixture: "success",
    marker: "success-smoke"
  });

  const notFound = await fetch(`${fixture.origin}${DEVTOOLS_SMOKE_PATHS.notFound}?marker=missing-smoke`);
  assert.equal(notFound.status, 404);
  assert.deepEqual(await notFound.json(), {
    ok: false,
    fixture: "not-found",
    marker: "missing-smoke"
  });

  const slowStartedAt = Date.now();
  const slow = await fetch(`${fixture.origin}${DEVTOOLS_SMOKE_PATHS.slow}?marker=slow-smoke`);
  const slowElapsedMs = Date.now() - slowStartedAt;
  assert.equal(slow.status, 200);
  assert.ok(slowElapsedMs >= 100, `slow endpoint returned too quickly: ${slowElapsedMs}ms`);
  assert.deepEqual(await slow.json(), {
    ok: true,
    fixture: "slow",
    delayMs: 120,
    marker: "slow-smoke"
  });

  await assert.rejects(
    fetch(`${fixture.origin}${DEVTOOLS_SMOKE_PATHS.fail}?marker=fail-smoke`),
    /fetch failed|terminated|other side closed/
  );
} finally {
  await fixture.close();
}

console.log("Extension DevTools fixture smoke passed.");
