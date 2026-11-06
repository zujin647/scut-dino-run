"use strict";

// 华工快跑 · 排行榜服务端
// 零第三方依赖：静态资源 + 账号 / 排行榜 / 管理 API，数据存 data/db.json。

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createStore } = require("./store");

const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const SCORE_SUBMIT_INTERVAL_MS = 1200;
const MAX_SCORE_VALUE = 1000000;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".manifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
};

/* ------------------------------------------------------------------ */
/* 存储                                                                */
/* ------------------------------------------------------------------ */

const store = createStore(DATA_DIR);

const nowIso = () => new Date().toISOString();

function readSettings() {
  return store.readSettings();
}


/* ------------------------------------------------------------------ */
/* 口令与会话                                                          */
/* ------------------------------------------------------------------ */

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, useSalt, 64).toString("hex");
  return { salt: useSalt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function createSession(userId, isAdmin) {
  const token = crypto.randomBytes(24).toString("base64url");
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_TTL_MS);
  store.createSession({
    token,
    userId,
    createdAt: created.toISOString(),
    expiresAt: expires.toISOString(),
    isAdmin,
  });
  return token;
}

function userFromRequest(request) {
  const header = String(request.headers.authorization || "");
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const session = store.findSession(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    store.removeSession(token);
    return null;
  }

  const user = store.findUserById(session.user_id);
  if (!user) return null;
  return { user, token, session };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    best: user.best_score,
    runs: user.runs,
    isAdmin: Boolean(user.is_admin),
    banned: Boolean(user.banned),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

/* ------------------------------------------------------------------ */
/* 频率限制                                                            */
/* ------------------------------------------------------------------ */

const rateBuckets = new Map();

function hitRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}, 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* HTTP 工具                                                           */
/* ------------------------------------------------------------------ */

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...corsHeaders(),
  });
  response.end(body);
}

function corsHeaders() {
  const origin = process.env.CORS_ORIGIN;
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function fail(response, status, message) {
  sendJson(response, status, { error: message });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("请求体过大"), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("请求格式不正确"), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket.remoteAddress || "";
}

/* ------------------------------------------------------------------ */
/* 业务校验                                                            */
/* ------------------------------------------------------------------ */

const USERNAME_PATTERN = /^[A-Za-z0-9_.@-]{3,24}$/;

function normalizeNickname(raw, fallback) {
  const text = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const value = text.slice(0, 16);
  return value || fallback;
}

function validateRegistration(body) {
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!USERNAME_PATTERN.test(username)) {
    return { error: "账号为 3-24 位字母、数字或 _ . @ -（建议直接用学号）" };
  }
  if (password.length < 6 || password.length > 64) {
    return { error: "密码长度需为 6-64 位" };
  }
  return { username, password, nickname: normalizeNickname(body.nickname, username) };
}

function eventState() {
  const settings = readSettings();
  if (!settings.open) return { allowed: false, reason: "活动未开放" };
  const now = Date.now();
  if (settings.startsAt) {
    const start = new Date(settings.startsAt).getTime();
    if (Number.isFinite(start) && now < start) {
      return { allowed: false, reason: "活动尚未开始" };
    }
  }
  if (settings.endsAt) {
    const end = new Date(settings.endsAt).getTime();
    if (Number.isFinite(end) && now > end) {
      return { allowed: false, reason: "活动已结束" };
    }
  }
  return { allowed: true, reason: "" };
}

function leaderboardRows(limit, viewerId) {
  const settings = readSettings();
  return store.leaderboard(limit, settings.minScore, viewerId).map((row) => ({
    rank: row.rank,
    nickname: row.nickname,
    score: row.score,
    at: row.at,
    isMe: row.isMe,
  }));
}

function rankOf(userId) {
  const settings = readSettings();
  return store.rankOf(userId, settings.minScore);
}

/* ------------------------------------------------------------------ */
/* API 路由                                                            */
/* ------------------------------------------------------------------ */

async function handleApi(request, response, pathname, query) {
  const method = request.method || "GET";
  const ip = clientIp(request);
  const route = `${method} ${pathname}`;

  /* ---------- 公共 ---------- */

  if (route === "GET /api/health") {
    sendJson(response, 200, { ok: true, time: nowIso() });
    return;
  }

  if (route === "GET /api/config") {
    const settings = readSettings();
    const state = eventState();
    const total = store.countOnBoard(settings.minScore);
    sendJson(response, 200, {
      event: {
        open: settings.open,
        allowed: state.allowed,
        reason: state.reason,
        startsAt: settings.startsAt,
        endsAt: settings.endsAt,
        minScore: settings.minScore,
        notice: settings.notice,
      },
      totalPlayers: Number(total.n),
    });
    return;
  }

  if (route === "GET /api/leaderboard") {
    const limit = Math.min(100, Math.max(1, Number(query.get("limit")) || 50));
    const viewer = userFromRequest(request);
    const settings = readSettings();
    sendJson(response, 200, {
      items: leaderboardRows(limit, viewer ? viewer.user.id : null),
      totalPlayers: store.countOnBoard(settings.minScore),
      updatedAt: nowIso(),
    });
    return;
  }

  if (route === "POST /api/auth/register") {
    if (hitRateLimit(`register:${ip}`, 20, 10 * 60 * 1000)) {
      fail(response, 429, "注册过于频繁，请稍后再试");
      return;
    }
    const body = await readJsonBody(request);
    const parsed = validateRegistration(body);
    if (parsed.error) {
      fail(response, 400, parsed.error);
      return;
    }
    if (store.findUserByUsername(parsed.username)) {
      fail(response, 409, "该账号已被注册");
      return;
    }
    const { salt, hash } = hashPassword(parsed.password);
    const user = store.insertUser({
      username: parsed.username,
      nickname: parsed.nickname,
      password_hash: hash,
      password_salt: salt,
      created_at: nowIso(),
      last_login_at: nowIso(),
      last_ip: ip,
    });
    const token = createSession(user.id, false);
    sendJson(response, 201, { token, user: publicUser(user) });
    return;
  }

  if (route === "POST /api/auth/login") {
    const body = await readJsonBody(request);
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (hitRateLimit(`login:${ip}`, 30, 10 * 60 * 1000)) {
      fail(response, 429, "尝试过于频繁，请 10 分钟后再试");
      return;
    }
    if (hitRateLimit(`login:user:${username.toLowerCase()}`, 10, 10 * 60 * 1000)) {
      fail(response, 429, "该账号尝试过于频繁，请稍后再试");
      return;
    }
    const user = store.findUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      fail(response, 401, "账号或密码不正确");
      return;
    }
    if (user.banned) {
      fail(response, 403, "该账号已被停用，请联系活动负责人");
      return;
    }
    store.updateUser(user.id, { last_login_at: nowIso(), last_ip: ip });
    const token = createSession(user.id, Boolean(user.is_admin));
    sendJson(response, 200, {
      token,
      user: publicUser(user),
      isAdmin: Boolean(user.is_admin),
    });
    return;
  }

  /* ---------- 用户 ---------- */

  if (route === "GET /api/auth/me") {
    const viewer = userFromRequest(request);
    if (!viewer) {
      fail(response, 401, "未登录");
      return;
    }
    sendJson(response, 200, {
      user: publicUser(viewer.user),
      rank: rankOf(viewer.user.id),
    });
    return;
  }

  if (route === "POST /api/auth/logout") {
    const viewer = userFromRequest(request);
    if (viewer) store.removeSession(viewer.token);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (route === "POST /api/auth/password") {
    const viewer = userFromRequest(request);
    if (!viewer) {
      fail(response, 401, "未登录");
      return;
    }
    const body = await readJsonBody(request);
    const oldPassword = String(body.oldPassword ?? "");
    const newPassword = String(body.newPassword ?? "");
    if (!verifyPassword(oldPassword, viewer.user.password_salt, viewer.user.password_hash)) {
      fail(response, 400, "原密码不正确");
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 64) {
      fail(response, 400, "新密码长度需为 6-64 位");
      return;
    }
    const { salt, hash } = hashPassword(newPassword);
    store.updateUser(viewer.user.id, { password_hash: hash, password_salt: salt });
    store.removeSessionsForUser(viewer.user.id, viewer.token);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (route === "POST /api/scores") {
    const viewer = userFromRequest(request);
    if (!viewer) {
      fail(response, 401, "请先登录再提交成绩");
      return;
    }
    const user = viewer.user;
    if (user.banned) {
      fail(response, 403, "该账号已被停用");
      return;
    }
    if (hitRateLimit(`score:${user.id}`, 1, SCORE_SUBMIT_INTERVAL_MS)) {
      fail(response, 429, "提交太快了，稍等一下");
      return;
    }
    const state = eventState();
    if (!state.allowed) {
      fail(response, 403, state.reason);
      return;
    }
    const body = await readJsonBody(request);
    const score = Math.floor(Number(body.score));
    if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE_VALUE) {
      fail(response, 400, "成绩格式不正确");
      return;
    }
    const stamp = nowIso();
    store.insertScore({
      userId: user.id,
      score,
      createdAt: stamp,
      ip: clientIp(request),
      ua: String(request.headers["user-agent"] || "").slice(0, 200),
    });

    let updatedBest = false;
    const currentBest = Number(user.best_score) || 0;
    if (score > currentBest) {
      store.updateUser(user.id, { best_score: score, best_at: stamp });
      store.incrementRuns(user.id);
      updatedBest = true;
    } else {
      store.incrementRuns(user.id);
    }

    const fresh = store.findUserById(user.id);
    sendJson(response, 200, {
      ok: true,
      accepted: true,
      best: fresh.best_score,
      improved: updatedBest,
      rank: rankOf(user.id),
    });
    return;
  }

  /* ---------- 管理端 ---------- */

  if (route === "POST /api/admin/login") {
    const body = await readJsonBody(request);
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (hitRateLimit(`admin:${ip}`, 20, 10 * 60 * 1000)) {
      fail(response, 429, "尝试过于频繁，请稍后再试");
      return;
    }
    const candidate = store.findUserByUsername(username);
    const user = candidate && candidate.is_admin ? candidate : null;
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      fail(response, 401, "管理员账号或密码不正确");
      return;
    }
    const token = createSession(user.id, true);
    sendJson(response, 200, { token, user: publicUser(user) });
    return;
  }

  if (pathname.startsWith("/api/admin/")) {
    const viewer = userFromRequest(request);
    if (!viewer || !viewer.user.is_admin) {
      fail(response, 401, "需要管理员登录");
      return;
    }
    const admin = viewer.user;

    if (route === "GET /api/admin/overview") {
      const settings = readSettings();
      const totals = store.stats();
      sendJson(response, 200, {
        settings,
        allowed: eventState(),
        totals,
      });
      return;
    }

    if (route === "GET /api/admin/users") {
      const keyword = String(query.get("q") || "").trim();
      const page = Math.max(1, Number(query.get("page")) || 1);
      const size = Math.min(200, Math.max(5, Number(query.get("size")) || 50));
      const { total, items: rows } = store.listUsers({ keyword, page, size });
      sendJson(response, 200, {
        total,
        page,
        size,
        items: rows.map((row) => ({
          id: row.id,
          username: row.username,
          nickname: row.nickname,
          best: row.best_score,
          bestAt: row.best_at,
          runs: row.runs,
          banned: Boolean(row.banned),
          isAdmin: Boolean(row.is_admin),
          createdAt: row.created_at,
          lastLoginAt: row.last_login_at,
          lastIp: row.last_ip,
        })),
      });
      return;
    }

    const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/(password|ban|score|scores)$/);
    if (userMatch) {
      const targetId = Number(userMatch[1]);
      const action = userMatch[2];
      const target = store.findUserById(targetId);
      if (!target) {
        fail(response, 404, "用户不存在");
        return;
      }
      const body = method === "GET" ? {} : await readJsonBody(request);

      if (action === "password" && method === "POST") {
        const raw = String(body.password ?? "").trim();
        const password = raw || crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x");
        if (password.length < 6) {
          fail(response, 400, "新密码长度需为 6-64 位");
          return;
        }
        const { salt, hash } = hashPassword(password);
        store.updateUser(targetId, { password_hash: hash, password_salt: salt });
        store.removeSessionsForUser(targetId);
        sendJson(response, 200, { ok: true, password });
        return;
      }

      if (action === "ban" && method === "POST") {
        const banned = body.banned ? 1 : 0;
        if (target.is_admin && banned) {
          fail(response, 400, "不能停用管理员账号");
          return;
        }
        store.updateUser(targetId, { banned });
        if (banned) store.removeSessionsForUser(targetId);
        sendJson(response, 200, { ok: true, banned: Boolean(banned) });
        return;
      }

      if (action === "score" && method === "POST") {
        const score = Math.floor(Number(body.score));
        if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE_VALUE) {
          fail(response, 400, "成绩格式不正确");
          return;
        }
        const stamp = nowIso();
        store.insertScore({ userId: targetId, score, createdAt: stamp, ip: "admin", ua: "manual" });
        store.updateUser(targetId, { best_score: score, best_at: stamp });
        sendJson(response, 200, { ok: true, best: score });
        return;
      }

      if (action === "scores" && method === "GET") {
        const rows = store.scoresForUser(targetId).map((row) => ({
          id: row.id,
          score: row.score,
          created_at: row.created_at,
          ip: row.ip,
          ua: row.ua,
        }));
        sendJson(response, 200, { items: rows });
        return;
      }
    }

    const scoreMatch = pathname.match(/^\/api\/admin\/scores\/(\d+)$/);
    if (scoreMatch && method === "DELETE") {
      const scoreId = Number(scoreMatch[1]);
      const record = store.removeScore(scoreId);
      if (!record) {
        fail(response, 404, "记录不存在");
        return;
      }
      const top = store.topScoreForUser(record.user_id);
      store.updateUser(record.user_id, {
        best_score: top ? top.score : 0,
        best_at: top ? top.created_at : null,
      });
      sendJson(response, 200, { ok: true, best: top ? top.score : 0 });
      return;
    }

    const banMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (banMatch && method === "DELETE") {
      const targetId = Number(banMatch[1]);
      const target = store.findUserById(targetId);
      if (!target) {
        fail(response, 404, "用户不存在");
        return;
      }
      if (target.is_admin) {
        fail(response, 400, "不能删除管理员账号");
        return;
      }
      store.removeUser(targetId);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (route === "GET /api/admin/settings") {
      sendJson(response, 200, { settings: readSettings() });
      return;
    }

    if (route === "PUT /api/admin/settings") {
      const body = await readJsonBody(request);
      const next = {
        open: Boolean(body.open),
        startsAt: String(body.startsAt || ""),
        endsAt: String(body.endsAt || ""),
        minScore: Math.max(0, Math.floor(Number(body.minScore) || 0)),
        notice: String(body.notice || "").slice(0, 200),
      };
      store.updateSettings(next);
      sendJson(response, 200, { ok: true, settings: readSettings() });
      return;
    }

    if (route === "POST /api/admin/password") {
      const body = await readJsonBody(request);
      const newPassword = String(body.newPassword ?? "");
      if (newPassword.length < 8) {
        fail(response, 400, "管理员密码至少 8 位");
        return;
      }
      const { salt, hash } = hashPassword(newPassword);
      store.updateUser(admin.id, { password_hash: hash, password_salt: salt });
      store.removeSessionsForUser(admin.id, viewer.token);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (route === "GET /api/admin/export.csv") {
      const rows = store.allUsersSorted();
      const header = "账号,姓名,最高分,最高分时间,提交次数,状态,注册时间,最近登录";
      const lines = rows.map((row) =>
        [
          row.username,
          row.nickname,
          row.best_score,
          row.best_at || "",
          row.runs,
          row.banned ? "停用" : "正常",
          row.created_at,
          row.last_login_at || "",
        ]
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(","),
      );
      const csv = Buffer.from(`\uFEFF${[header, ...lines].join("\r\n")}`, "utf8");
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="scut-run-scores.csv"',
        "Content-Length": csv.length,
        "Cache-Control": "no-store",
      });
      response.end(csv);
      return;
    }

    fail(response, 404, "接口不存在");
    return;
  }

  fail(response, 404, "接口不存在");
}

/* ------------------------------------------------------------------ */
/* 静态资源                                                            */
/* ------------------------------------------------------------------ */

function sendStatic(response, filePath) {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendPage(response, 404, "Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": stats.size,
    };

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        sendPage(response, 500, "Server error");
        return;
      }
      sendPage(response, 200, data, headers);
    });
  });
}

function sendPage(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-cache",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

function ensureAdminAccount() {
  const existing = store.findAdmin();
  if (existing) return existing;

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const { salt, hash } = hashPassword(password);
  const created = store.insertUser({
    username,
    nickname: "活动管理员",
    password_hash: hash,
    password_salt: salt,
    is_admin: 1,
    created_at: nowIso(),
  });

  console.log("======================================================");
  console.log("已创建管理员账号，请立即记录并登录管理端修改密码：");
  console.log(`  账号：${username}`);
  console.log(`  密码：${password}`);
  console.log(`  管理端地址：http://localhost:${PORT}/admin.html`);
  console.log("======================================================");
  return created;
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }
    handleApi(request, response, pathname, requestUrl.searchParams).catch((error) => {
      const status = error && error.status ? error.status : 500;
      if (status >= 500) console.error("[api]", request.method, pathname, error);
      sendJson(response, status, { error: error && error.message ? error.message : "服务异常" });
    });
    return;
  }

  const target = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(ROOT, `.${target}`);
  if (!filePath.startsWith(ROOT)) {
    sendPage(response, 403, "Forbidden");
    return;
  }
  if (filePath.startsWith(DATA_DIR) || target.startsWith("/data/")) {
    sendPage(response, 403, "Forbidden");
    return;
  }
  sendStatic(response, filePath);
});

function start() {
  ensureAdminAccount();
  server.listen(PORT, HOST, () => {
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((item) => item && item.family === "IPv4" && !item.internal)
      .map((item) => `http://${item.address}:${PORT}`);

    console.log(`华工快跑已启动：http://localhost:${PORT}`);
    console.log(`排行榜接口：http://localhost:${PORT}/api/leaderboard`);
    if (addresses.length) {
      console.log(`局域网访问：${addresses.join("  ")}`);
    }
  });
}

if (require.main === module) {
  start();
}

module.exports = { server, store, start };
