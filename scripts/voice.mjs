// Starts the local speech-to-text service (voice/server.py), creating its virtualenv on first run.
//   npm run voice            start (installs on first run)
//   npm run voice -- setup   install / update packages and download the Whisper models for offline use
import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const dir = path.resolve("voice");
const win = process.platform === "win32";
const py = path.join(dir, ".venv", win ? "Scripts/python.exe" : "bin/python");
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: dir, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const setup = process.argv.includes("setup");
if (!existsSync(py)) {
  console.log("Creating voice/.venv (Python 3.10–3.13) …");
  const base = win ? ["py", ["-3.13", "-m", "venv", ".venv"]] : ["python3", ["-m", "venv", ".venv"]];
  run(base[0], base[1]);
}
if (setup || !existsSync(path.join(dir, ".venv", ".installed"))) {
  run(py, ["-m", "pip", "install", "--upgrade", "pip"]);
  run(py, ["-m", "pip", "install", "-r", "requirements.txt"]);
  run(py, ["-c", "open('.venv/.installed','w').write('ok')"]);
  run(py, ["prewarm.py"]);
  if (setup) process.exit(0);
}
const child = spawn(py, ["server.py"], { stdio: "inherit", cwd: dir });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
