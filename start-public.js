"use strict";

// 一键启动：本机跑游戏 + 服务，并尝试用 Cloudflare 隧道开一个临时公网地址。
//   node start-public.js          启动并开公网隧道
//   node start-public.js --lan    只开本地/局域网
//
// 隧道来自 Cloudflare Quick Tunnel：免费、不用注册，但地址每次重启都会变。

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const PORT = Number(process.env.PORT) || 4173;
const LAN_ONLY = process.argv.includes("--lan");

fs.mkdirSync(DATA_DIR, { recursive: true });

const children = [];
let shuttingDown = false;

function line(prefix) {
  return (chunk) => {
    const text = String(chunk).trim();
    if (!text) return;
    if (process.env.VERBOSE) console.log(`${prefix} ${text}`);
  };
}

function adminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const file = path.join(DATA_DIR, "admin-password.txt");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const generated = crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (response.ok) return true;
    } catch {
      // 还没起来
    }
    await sleep(250);
  }
  return false;
}

function findCloudflared() {
  const candidates = [
    process.env.CLOUDFLARED,
    path.join(ROOT, process.platform === "win32" ? "cloudflared.exe" : "cloudflared"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${PORT}`);
}

function banner(title, rows) {
  console.log("");
  console.log("═".repeat(60));
  console.log(`  ${title}`);
  console.log("═".repeat(60));
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(10, "　")} ${value}`);
  }
  console.log("═".repeat(60));
  console.log("");
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // 忽略
    }
  }
  await sleep(300);
  process.exit(code);
}

async function main() {
  const password = adminPassword();

  const server = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "0.0.0.0",
      DATA_DIR,
      ADMIN_PASSWORD: password,
      ADMIN_USERNAME: process.env.ADMIN_USERNAME || "admin",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(server);
  server.stdout.on("data", line("[服务]"));
  server.stderr.on("data", line("[服务]"));
  server.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`服务进程退出（${code}），请检查端口 ${PORT} 是否被占用。`);
      shutdown(1);
    }
  });

  if (!(await waitForServer())) {
    console.error("服务没有启动成功。");
    await shutdown(1);
    return;
  }

  const localUrl = `http://localhost:${PORT}`;
  const lan = lanAddresses();

  if (LAN_ONLY) {
    banner("已启动（仅本机 / 局域网）", [
      ["本机", localUrl],
      ["管理端", `${localUrl}/admin.html`],
      ["管理员", `admin / ${password}`],
      ...lan.map((url) => ["局域网", url]),
    ]);
    return;
  }

  const cloudflared = findCloudflared();
  if (!cloudflared) {
    banner("已启动（未找到 cloudflared，只开了局域网）", [
      ["本机", localUrl],
      ["管理端", `${localUrl}/admin.html`],
      ["管理员", `admin / ${password}`],
      ...lan.map((url) => ["局域网", url]),
      ["", ""],
      ["想要公网地址", "下载 cloudflared 放到本目录后重新运行"],
      ["Windows", "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"],
      ["macOS", "brew install cloudflared"],
    ]);
    return;
  }

  const tunnel = spawn(
    cloudflared,
    ["tunnel", "--url", `http://127.0.0.1:${PORT}`, "--no-autoupdate"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(tunnel);

  let publicUrl = "";
  const onTunnelData = (chunk) => {
    const text = String(chunk);
    if (!publicUrl) {
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) publicUrl = match[0];
    }
  };
  tunnel.stdout.on("data", onTunnelData);
  tunnel.stderr.on("data", onTunnelData);
  tunnel.on("exit", () => {
    if (!shuttingDown) console.error("隧道已断开，公网地址失效。");
  });

  for (let i = 0; i < 40 && !publicUrl; i += 1) await sleep(250);

  if (!publicUrl) {
    console.error("隧道没有拿到地址（可能是网络限制），先按局域网用。");
    banner("已启动（隧道失败）", [
      ["本机", localUrl],
      ["管理端", `${localUrl}/admin.html`],
      ["管理员", `admin / ${password}`],
      ...lan.map((url) => ["局域网", url]),
    ]);
    return;
  }

  banner("公网地址已就绪", [
    ["游戏", publicUrl],
    ["管理端", `${publicUrl}/admin.html`],
    ["管理员", `admin / ${password}`],
    ["本机", localUrl],
    ["", ""],
    ["注意", "这台电脑要一直开着，关掉或断网地址就失效"],
    ["注意", "重启后地址会变，公众号里的二维码要重新生成"],
    ["数据", path.join(DATA_DIR, "db.json")],
  ]);
  fs.writeFileSync(path.join(DATA_DIR, "public-url.txt"), `${publicUrl}\n`);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch(async (error) => {
  console.error(error);
  await shutdown(1);
});
