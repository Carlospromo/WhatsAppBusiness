import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("../dist/worker/worker.js", import.meta.url));
const MAX_RESTART_DELAY_MS = 30_000;
const SHUTDOWN_GRACE_MS = 10_000;

let child;
let restartTimer;
let shutdownTimer;
let stopping = false;
let consecutiveRestarts = 0;

function log(event, details = {}) {
  process.stderr.write(`${JSON.stringify({ component: "whatsapp-business", event, ...details })}\n`);
}

function nextRestartDelay() {
  consecutiveRestarts = Math.min(consecutiveRestarts + 1, 6);
  return Math.min(1_000 * 2 ** (consecutiveRestarts - 1), MAX_RESTART_DELAY_MS);
}

function startWorker() {
  child = spawn(process.execPath, [workerPath], {
    env: process.env,
    stdio: "inherit",
  });

  child.once("error", (error) => {
    log("worker.spawn_error", { error: error instanceof Error ? error.name : "Error" });
  });

  child.once("exit", (code, signal) => {
    child = undefined;

    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = undefined;
    }

    if (stopping) {
      process.exit(code ?? 0);
      return;
    }

    const restartInMs = nextRestartDelay();
    log("worker.exited", {
      code: code ?? null,
      signal: signal ?? null,
      restartInMs,
    });
    restartTimer = setTimeout(startWorker, restartInMs);
  });
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }

  if (!child) {
    process.exit(0);
    return;
  }

  child.kill(signal);
  shutdownTimer = setTimeout(() => {
    if (child) child.kill("SIGKILL");
  }, SHUTDOWN_GRACE_MS);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

startWorker();
