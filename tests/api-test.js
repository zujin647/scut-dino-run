"use strict";

// 端到端接口测试：启动一个临时实例，跑完注册 / 登录 / 提交 / 榜单 / 管理端全流程。
// 用法：node tests/api-test.js

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = 4300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_USER = "testadmin";
const ADMIN_PASS = "test-admin-pass-123";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "scut-run-test-"));

let passed = 0;
let child = null;

function ok(name) {
  passed += 1;
  console.log(`  ok  ${name}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, pathname, { token, body, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return response;
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: response.status, body: payload, response };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // 还没起来
    }
    await sleep(200);
  }
  throw new Error("服务端没有在 12 秒内启动");
}

async function startServer() {
  const proc = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      DATA_DIR: dataDir,
      ADMIN_USERNAME: ADMIN_USER,
      ADMIN_PASSWORD: ADMIN_PASS,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", () => {});
  proc.stderr.on("data", () => {});
  return proc;
}

async function main() {
  child = await startServer();
  await waitForServer();
  ok("服务端启动");

  /* ---------------- 静态资源 ---------------- */

  const page = await call("GET", "/");
  assert.equal(page.status, 200);
  assert.match(String(page.body), /实时排行榜/);
  ok("首页返回并包含排行榜区块");

  const adminPage = await call("GET", "/admin.html");
  assert.equal(adminPage.status, 200);
  ok("管理端页面可访问");

  const dbFile = await call("GET", "/data/db.json");
  assert.equal(dbFile.status, 403);
  ok("数据文件不可直接下载");

  /* ---------------- 注册与登录 ---------------- */

  const alice = await call("POST", "/api/auth/register", {
    body: { username: "2025001", password: "alicepass", nickname: "李雷" },
  });
  assert.equal(alice.status, 201);
  assert.ok(alice.body.token);
  ok("注册成功并返回令牌");

  const dup = await call("POST", "/api/auth/register", {
    body: { username: "2025001", password: "alicepass", nickname: "李雷" },
  });
  assert.equal(dup.status, 409);
  ok("重复账号被拒绝");

  const weak = await call("POST", "/api/auth/register", {
    body: { username: "2025002", password: "123" },
  });
  assert.equal(weak.status, 400);
  ok("弱密码被拒绝");

  const bob = await call("POST", "/api/auth/register", {
    body: { username: "2025002", password: "bobpass1", nickname: "韩梅梅" },
  });
  assert.equal(bob.status, 201);

  const badLogin = await call("POST", "/api/auth/login", {
    body: { username: "2025001", password: "wrong-pass" },
  });
  assert.equal(badLogin.status, 401);
  ok("错误密码登录失败");

  const aliceLogin = await call("POST", "/api/auth/login", {
    body: { username: "2025001", password: "alicepass" },
  });
  assert.equal(aliceLogin.status, 200);
  const aliceToken = aliceLogin.body.token;
  ok("登录成功");

  /* ---------------- 成绩与榜单 ---------------- */

  const noAuth = await call("POST", "/api/scores", { body: { score: 100 } });
  assert.equal(noAuth.status, 401);
  ok("未登录不能提交成绩");

  const first = await call("POST", "/api/scores", { token: aliceToken, body: { score: 120 } });
  assert.equal(first.status, 200);
  assert.equal(first.body.best, 120);
  assert.equal(first.body.improved, true);
  assert.equal(first.body.rank, 1);
  ok("成绩提交成功并返回排名");

  await sleep(1400);
  const second = await call("POST", "/api/scores", { token: aliceToken, body: { score: 90 } });
  assert.equal(second.status, 200);
  assert.equal(second.body.best, 120, "低于最高分不应覆盖");
  assert.equal(second.body.improved, false);
  ok("低分不覆盖个人最佳");

  await sleep(1400);
  const third = await call("POST", "/api/scores", { token: aliceToken, body: { score: 480 } });
  assert.equal(third.status, 200);
  assert.equal(third.body.best, 480);
  ok("刷新个人最佳");

  const bobScore = await call("POST", "/api/scores", { token: bob.body.token, body: { score: 300 } });
  assert.equal(bobScore.status, 200);

  const board = await call("GET", "/api/leaderboard");
  assert.equal(board.status, 200);
  assert.equal(board.body.items.length, 2);
  assert.equal(board.body.items[0].nickname, "李雷");
  assert.equal(board.body.items[0].rank, 1);
  assert.equal(board.body.items[1].rank, 2);
  assert.equal(board.body.items[0].score, 480);
  ok("排行榜按最高分排序");

  const me = await call("GET", "/api/auth/me", { token: aliceToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.best, 480);
  assert.equal(me.body.rank, 1);
  ok("个人信息与排名正确");

  await sleep(1400);
  const badScore = await call("POST", "/api/scores", { token: aliceToken, body: { score: -5 } });
  assert.equal(badScore.status, 400);
  ok("非法成绩被拒绝");

  /* ---------------- 管理端 ---------------- */

  const adminBad = await call("POST", "/api/admin/login", {
    body: { username: ADMIN_USER, password: "nope" },
  });
  assert.equal(adminBad.status, 401);
  ok("管理员错误密码被拒绝");

  const adminLogin = await call("POST", "/api/admin/login", {
    body: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.body.token;
  ok("管理员登录成功");

  const forbidden = await call("GET", "/api/admin/users", { token: aliceToken });
  assert.equal(forbidden.status, 401);
  ok("普通用户访问管理接口被拒绝");

  const overview = await call("GET", "/api/admin/overview", { token: adminToken });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.totals.users, 3, "2 名选手 + 1 名管理员");
  assert.equal(overview.body.totals.players, 2);
  assert.equal(overview.body.totals.topScore, 480);
  ok("管理概览数据正确");

  const users = await call("GET", "/api/admin/users?size=50", { token: adminToken });
  assert.equal(users.status, 200);
  const aliceRow = users.body.items.find((item) => item.username === "2025001");
  const bobRow = users.body.items.find((item) => item.username === "2025002");
  assert.ok(aliceRow && bobRow);
  assert.equal(aliceRow.best, 480);
  ok("选手列表包含成绩");

  const reset = await call("POST", `/api/admin/users/${bobRow.id}/password`, {
    token: adminToken,
    body: {},
  });
  assert.equal(reset.status, 200);
  assert.ok(reset.body.password.length >= 6);
  const bobRelogin = await call("POST", "/api/auth/login", {
    body: { username: "2025002", password: reset.body.password },
  });
  assert.equal(bobRelogin.status, 200);
  ok("管理员重置密码后新密码可用");

  const ban = await call("POST", `/api/admin/users/${bobRow.id}/ban`, {
    token: adminToken,
    body: { banned: true },
  });
  assert.equal(ban.status, 200);
  const bannedLogin = await call("POST", "/api/auth/login", {
    body: { username: "2025002", password: reset.body.password },
  });
  assert.equal(bannedLogin.status, 403);
  const boardAfterBan = await call("GET", "/api/leaderboard");
  assert.equal(boardAfterBan.body.items.length, 1);
  ok("停用账号无法登录且退出榜单");

  await call("POST", `/api/admin/users/${bobRow.id}/ban`, {
    token: adminToken,
    body: { banned: false },
  });
  ok("解封账号");

  const manual = await call("POST", `/api/admin/users/${bobRow.id}/score`, {
    token: adminToken,
    body: { score: 777 },
  });
  assert.equal(manual.status, 200);
  const boardAfterManual = await call("GET", "/api/leaderboard");
  assert.equal(boardAfterManual.body.items[0].nickname, "韩梅梅");
  assert.equal(boardAfterManual.body.items[0].score, 777);
  ok("管理员补录成绩生效");

  const records = await call("GET", `/api/admin/users/${bobRow.id}/scores`, { token: adminToken });
  assert.equal(records.status, 200);
  const manualRecord = records.body.items.find((item) => item.score === 777);
  assert.ok(manualRecord);
  const remove = await call("DELETE", `/api/admin/scores/${manualRecord.id}`, { token: adminToken });
  assert.equal(remove.status, 200);
  assert.equal(remove.body.best, 300, "删除后回落到次高成绩");
  ok("删除异常成绩并重算最佳");

  const csv = await call("GET", "/api/admin/export.csv", { token: adminToken, raw: true });
  assert.equal(csv.status, 200);
  assert.match(String(csv.headers.get("content-type")), /csv/);
  const csvText = await csv.text();
  assert.match(csvText, /2025001/);
  ok("CSV 导出可用");

  /* ---------------- 活动开关 ---------------- */

  const close = await call("PUT", "/api/admin/settings", {
    token: adminToken,
    body: { open: false, startsAt: "", endsAt: "", minScore: 1, notice: "" },
  });
  assert.equal(close.status, 200);
  await sleep(1400);
  const closedSubmit = await call("POST", "/api/scores", {
    token: aliceToken,
    body: { score: 999 },
  });
  assert.equal(closedSubmit.status, 403);
  assert.match(String(closedSubmit.body.error), /未开放/);
  ok("关闭活动后拒绝提交");

  const reopen = await call("PUT", "/api/admin/settings", {
    token: adminToken,
    body: { open: true, startsAt: "", endsAt: "", minScore: 1, notice: "" },
  });
  assert.equal(reopen.status, 200);
  await sleep(1400);
  const reopenedSubmit = await call("POST", "/api/scores", {
    token: aliceToken,
    body: { score: 500 },
  });
  assert.equal(reopenedSubmit.status, 200);
  ok("重新开放后可提交");

  const timeWindow = await call("PUT", "/api/admin/settings", {
    token: adminToken,
    body: { open: true, startsAt: "2026-11-14T00:00:00.000Z", endsAt: "2026-11-20T15:59:59.000Z" },
  });
  assert.equal(timeWindow.status, 200);
  const config = await call("GET", "/api/config");
  assert.equal(config.status, 200);
  assert.ok(typeof config.body.event.allowed === "boolean");
  ok("时间窗口配置可读取");

  /* ---------------- 账号操作 ---------------- */

  const aliceLogout = await call("POST", "/api/auth/logout", { token: aliceToken });
  assert.equal(aliceLogout.status, 200);
  const afterLogout = await call("GET", "/api/auth/me", { token: aliceToken });
  assert.equal(afterLogout.status, 401);
  ok("退出登录后令牌失效");

  const relogin = await call("POST", "/api/auth/login", {
    body: { username: "2025001", password: "alicepass" },
  });
  assert.equal(relogin.status, 200);
  const aliceToken2 = relogin.body.token;

  const changed = await call("POST", "/api/auth/password", {
    token: aliceToken2,
    body: { oldPassword: "alicepass", newPassword: "alicepass2" },
  });
  assert.equal(changed.status, 200);

  const sessionStillValid = await call("GET", "/api/auth/me", { token: aliceToken2 });
  assert.equal(sessionStillValid.status, 200, "改密后当前会话应保持");

  const oldPasswordLogin = await call("POST", "/api/auth/login", {
    body: { username: "2025001", password: "alicepass" },
  });
  assert.equal(oldPasswordLogin.status, 401, "旧密码应失效");

  const newPasswordLogin = await call("POST", "/api/auth/login", {
    body: { username: "2025001", password: "alicepass2" },
  });
  assert.equal(newPasswordLogin.status, 200);
  ok("选手自助修改密码");

  /* ---------------- 持久化 ---------------- */

  const boardBeforeRestart = await call("GET", "/api/leaderboard");
  const before = boardBeforeRestart.body.items.map((item) => `${item.nickname}:${item.score}`);

  child.kill();
  await sleep(600);
  child = await startServer();
  await waitForServer();

  const boardAfterRestart = await call("GET", "/api/leaderboard");
  const after = boardAfterRestart.body.items.map((item) => `${item.nickname}:${item.score}`);
  assert.deepEqual(after, before, "重启后榜单应与重启前一致");
  ok("重启服务后数据仍在");

  const reloginAfterRestart = await call("POST", "/api/auth/login", {
    body: { username: "2025001", password: "alicepass2" },
  });
  assert.equal(reloginAfterRestart.status, 200, "重启后账号仍可登录");
  ok("重启后账号可用");

  console.log(`\n全部通过：${passed} 项检查\n`);
}

async function cleanup() {
  if (child && !child.killed) {
    child.kill();
    await sleep(300);
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows 上偶尔有句柄未释放，忽略即可。
  }
}

main()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("\n测试失败：", error && error.message ? error.message : error);
    await cleanup();
    process.exit(1);
  });
