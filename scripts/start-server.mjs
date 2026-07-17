import { spawn } from "node:child_process";

const nextBin = new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname;
const child = spawn(process.execPath, [nextBin, "start", "-p", process.env.PORT || "3000"], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
