import http from "node:http";
import https from "node:https";

const target = process.argv[2] || "http://127.0.0.1:3000/api/health/live";
const timeoutMs = Number(process.env.WAIT_FOR_URL_TIMEOUT_MS || 60000);
const intervalMs = Number(process.env.WAIT_FOR_URL_INTERVAL_MS || 500);
const startedAt = Date.now();
const url = new URL(target);
const client = url.protocol === "https:" ? https : http;

function wait() {
  const request = client.request(
    url,
    { method: "GET", timeout: Math.min(intervalMs, 5000) },
    (response) => {
      response.resume();
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
        process.exit(0);
      }
      retry();
    },
  );

  request.on("timeout", () => {
    request.destroy();
    retry();
  });
  request.on("error", retry);
  request.end();
}

function retry() {
  if (Date.now() - startedAt >= timeoutMs) {
    console.error(`Timed out waiting for ${target}`);
    process.exit(1);
  }
  setTimeout(wait, intervalMs);
}

console.log(`Waiting for ${target}`);
wait();