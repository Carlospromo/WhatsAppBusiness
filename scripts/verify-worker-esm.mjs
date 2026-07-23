import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

// The worker checks this before it creates timers, connects to WhatsApp or
// queries PostgreSQL. This imports the exact production ESM artifact.
process.env.WORKER_VERIFY_ONLY = "true";
await import(pathToFileURL(fileURLToPath(new URL("../dist/worker/worker.js", import.meta.url))).href);
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  args: ["--disable-dev-shm-usage", "--disable-gpu"],
});
const page = await browser.newPage();
await page.goto("about:blank");
await browser.close();
