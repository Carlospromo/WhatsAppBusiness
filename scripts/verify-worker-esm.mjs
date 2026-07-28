import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

// The Docker dependency stage must copy `patches/` before npm ci. Verify the
// installed package, not only the repository patch file, so a missing patch
// fails CI/the image build before Railway can deploy it.
const messageSource = await readFile(new URL("../node_modules/whatsapp-web.js/src/structures/Message.js", import.meta.url), "utf8");
const injectedUtilsSource = await readFile(new URL("../node_modules/whatsapp-web.js/src/util/Injected/Utils.js", import.meta.url), "utf8");
if (!messageSource.includes("this.id?._serialized ?? this.id?.$1") || !injectedUtilsSource.includes("window.WWebJS.normalizeSerialized")) {
  throw new Error("whatsapp-web.js compatibility patch is not installed");
}

// The worker checks this before it creates timers, connects to WhatsApp or
// queries PostgreSQL. This imports the exact production ESM artifact.
process.env.WORKER_VERIFY_ONLY = "true";
await import(pathToFileURL(fileURLToPath(new URL("../dist/worker/worker.js", import.meta.url))).href);
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  args: ["--disable-dev-shm-usage", "--disable-gpu", ...(process.env.PUPPETEER_NO_SANDBOX === "true" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [])],
});
const page = await browser.newPage();
await page.goto("about:blank");
await browser.close();
