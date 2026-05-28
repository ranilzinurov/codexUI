import http from "node:http";

const DEFAULT_SLOW_DELAY_MS = 650;

export const DEVTOOLS_SMOKE_PATHS = Object.freeze({
  page: "/",
  success: "/devtools/success.json",
  notFound: "/devtools/not-found.json",
  slow: "/devtools/slow.json",
  fail: "/devtools/fail"
});

export function buildDevToolsSmokePageHtml(options = {}) {
  const slowDelayMs = Number.isFinite(options.slowDelayMs)
    ? options.slowDelayMs
    : DEFAULT_SLOW_DELAY_MS;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Codex Annotation DevTools Smoke Page</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body {
        max-width: 840px;
        margin: 0 auto;
        padding: 40px 20px;
        line-height: 1.5;
      }

      button {
        min-height: 36px;
        border: 1px solid CanvasText;
        border-radius: 6px;
        padding: 6px 10px;
        font: inherit;
      }

      .button-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 10px;
        margin: 18px 0;
      }

      #devtools-smoke-log {
        min-height: 120px;
        border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
        border-radius: 8px;
        padding: 12px;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <h1>Codex annotation DevTools smoke page</h1>
    <p>
      Use this page while the extension DevTools mode is attached. The buttons emit predictable console
      events and network requests for capture verification.
    </p>

    <h2>Console triggers</h2>
    <div class="button-grid" aria-label="Console smoke triggers">
      <button id="console-info" type="button">Console info</button>
      <button id="console-warn" type="button">Console warn</button>
      <button id="console-error" type="button">Console error</button>
      <button id="console-burst" type="button">Console burst</button>
    </div>

    <h2>Network triggers</h2>
    <div class="button-grid" aria-label="Network smoke triggers">
      <button id="network-success" type="button">Network success</button>
      <button id="network-404" type="button">Network 404</button>
      <button id="network-slow" type="button">Network slow</button>
      <button id="network-fail" type="button">Network fail</button>
      <button id="network-burst" type="button">Network burst</button>
    </div>

    <h2>Fixture output</h2>
    <output id="devtools-smoke-log" aria-live="polite"></output>

    <script>
      const smokeLog = document.querySelector("#devtools-smoke-log");
      const paths = ${JSON.stringify(DEVTOOLS_SMOKE_PATHS)};
      let sequence = 0;

      function marker(label) {
        sequence += 1;
        return "codex-devtools-smoke:" + label + ":" + String(sequence).padStart(2, "0");
      }

      function write(message) {
        smokeLog.textContent += message + "\\n";
      }

      async function request(label, path) {
        const id = marker(label);
        console.info(id + ":request:start", { path });
        write(id + " fetch " + path);

        try {
          const response = await fetch(path + "?marker=" + encodeURIComponent(id), {
            headers: {
              "X-Codex-DevTools-Smoke": id
            },
            cache: "no-store"
          });
          const text = await response.text();
          console.info(id + ":request:finish", {
            ok: response.ok,
            status: response.status,
            bytes: text.length
          });
          write(id + " status " + response.status + " bytes " + text.length);
          return { id, ok: response.ok, status: response.status, text };
        } catch (error) {
          console.error(id + ":request:failed", {
            name: error && error.name,
            message: error && error.message
          });
          write(id + " failed " + (error && error.name ? error.name : "Error"));
          return { id, ok: false, status: 0, error };
        }
      }

      document.querySelector("#console-info").addEventListener("click", () => {
        const id = marker("console-info");
        console.info(id, { fixture: "info", url: location.href });
        write(id + " emitted");
      });

      document.querySelector("#console-warn").addEventListener("click", () => {
        const id = marker("console-warn");
        console.warn(id, { fixture: "warn", slowThresholdMs: ${slowDelayMs} });
        write(id + " emitted");
      });

      document.querySelector("#console-error").addEventListener("click", () => {
        const id = marker("console-error");
        console.error(id, new Error("Codex DevTools smoke error"));
        write(id + " emitted");
      });

      document.querySelector("#console-burst").addEventListener("click", () => {
        console.info(marker("console-burst-info"));
        console.warn(marker("console-burst-warn"));
        console.error(marker("console-burst-error"));
        write("console burst emitted");
      });

      document.querySelector("#network-success").addEventListener("click", () => {
        request("network-success", paths.success);
      });

      document.querySelector("#network-404").addEventListener("click", () => {
        request("network-404", paths.notFound);
      });

      document.querySelector("#network-slow").addEventListener("click", () => {
        request("network-slow", paths.slow);
      });

      document.querySelector("#network-fail").addEventListener("click", () => {
        request("network-fail", paths.fail);
      });

      document.querySelector("#network-burst").addEventListener("click", () => {
        request("network-success", paths.success);
        request("network-404", paths.notFound);
        request("network-slow", paths.slow);
        request("network-fail", paths.fail);
      });
    </script>
  </body>
</html>`;
}

export async function createDevToolsSmokeServer(options = {}) {
  const slowDelayMs = Number.isFinite(options.slowDelayMs)
    ? options.slowDelayMs
    : DEFAULT_SLOW_DELAY_MS;
  const server = http.createServer((request, response) => {
    handleDevToolsSmokeRequest(request, response, { slowDelayMs });
  });
  const host = options.host || "127.0.0.1";
  const port = Number.isFinite(options.port) ? options.port : 0;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const origin = `http://${address.address}:${address.port}`;
  return {
    server,
    origin,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

export function handleDevToolsSmokeRequest(request, response, options = {}) {
  const slowDelayMs = Number.isFinite(options.slowDelayMs)
    ? options.slowDelayMs
    : DEFAULT_SLOW_DELAY_MS;
  const url = new URL(request.url || "/", "http://127.0.0.1");

  if (url.pathname === DEVTOOLS_SMOKE_PATHS.page) {
    sendText(response, 200, buildDevToolsSmokePageHtml({ slowDelayMs }), "text/html; charset=utf-8");
    return;
  }

  if (url.pathname === DEVTOOLS_SMOKE_PATHS.success) {
    sendJson(response, 200, {
      ok: true,
      fixture: "success",
      marker: url.searchParams.get("marker") || null
    });
    return;
  }

  if (url.pathname === DEVTOOLS_SMOKE_PATHS.notFound) {
    sendJson(response, 404, {
      ok: false,
      fixture: "not-found",
      marker: url.searchParams.get("marker") || null
    });
    return;
  }

  if (url.pathname === DEVTOOLS_SMOKE_PATHS.slow) {
    setTimeout(() => {
      sendJson(response, 200, {
        ok: true,
        fixture: "slow",
        delayMs: slowDelayMs,
        marker: url.searchParams.get("marker") || null
      });
    }, slowDelayMs);
    return;
  }

  if (url.pathname === DEVTOOLS_SMOKE_PATHS.fail) {
    request.socket.destroy();
    return;
  }

  sendJson(response, 404, {
    ok: false,
    fixture: "unknown-route"
  });
}

function sendJson(response, statusCode, payload) {
  sendText(response, statusCode, JSON.stringify(payload), "application/json; charset=utf-8");
}

function sendText(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}
