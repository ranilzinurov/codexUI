import { createDevToolsSmokeServer, DEVTOOLS_SMOKE_PATHS } from "./devtools-smoke-fixtures.mjs";

const port = Number.parseInt(process.env.PORT || "8899", 10);
const host = process.env.HOST || "127.0.0.1";
const slowDelayMs = Number.parseInt(process.env.SLOW_DELAY_MS || "650", 10);
const fixture = await createDevToolsSmokeServer({ host, port, slowDelayMs });

console.log("Codex annotation DevTools smoke fixture is running.");
console.log(`Open ${fixture.origin}${DEVTOOLS_SMOKE_PATHS.page}`);
console.log(`Success endpoint: ${fixture.origin}${DEVTOOLS_SMOKE_PATHS.success}`);
console.log(`404 endpoint: ${fixture.origin}${DEVTOOLS_SMOKE_PATHS.notFound}`);
console.log(`Slow endpoint: ${fixture.origin}${DEVTOOLS_SMOKE_PATHS.slow}`);
console.log(`Fail endpoint: ${fixture.origin}${DEVTOOLS_SMOKE_PATHS.fail}`);
console.log("Press Ctrl+C to stop.");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await fixture.close();
    process.exit(0);
  });
}
