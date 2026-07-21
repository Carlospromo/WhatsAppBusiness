import { fileURLToPath, pathToFileURL } from "node:url";

// The worker checks this before it creates timers, connects to WhatsApp or
// queries PostgreSQL. This imports the exact production ESM artifact.
process.env.WORKER_VERIFY_ONLY = "true";
await import(pathToFileURL(fileURLToPath(new URL("../dist/worker/worker.js", import.meta.url))).href);
