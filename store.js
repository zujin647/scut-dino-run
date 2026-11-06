"use strict";

// 简单的 JSON 文件存储。
// 数据全部读进内存，写入时整份原子替换（写临时文件再 rename），
// 适合几百人规模的活动：单进程、数据量小、随时可以用文本编辑器打开查看。

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = {
  open: true,
  startsAt: "",
  endsAt: "",
  minScore: 1,
  notice: "",
};

function emptyData() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    users: [],
    scores: [],
    sessions: [],
  };
}

function createStore(dataDir) {
  const file = path.join(dataDir, "db.json");
  const tmpFile = `${file}.tmp`;
  fs.mkdirSync(dataDir, { recursive: true });

  let data = emptyData();
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      data = {
        version: 1,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        users: Array.isArray(parsed.users) ? parsed.users : [],
        scores: Array.isArray(parsed.scores) ? parsed.scores : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
    } catch (error) {
      const backup = `${file}.broken-${Date.now()}`;
      fs.copyFileSync(file, backup);
      console.error(`[存储] db.json 解析失败，已备份到 ${backup}，将使用空数据启动。`);
    }
  }

  function save() {
    const text = JSON.stringify(data);
    fs.writeFileSync(tmpFile, text, "utf8");
    fs.renameSync(tmpFile, file);
  }

  const nowIso = () => new Date().toISOString();
  const nextId = (list) => list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;

  function purgeExpiredSessions() {
    const now = Date.now();
    const before = data.sessions.length;
    data.sessions = data.sessions.filter((session) => new Date(session.expires_at).getTime() > now);
    return data.sessions.length !== before;
  }

  if (purgeExpiredSessions()) save();

  /* ---------------- 设置 ---------------- */

  function readSettings() {
    return {
      open: Boolean(data.settings.open),
      startsAt: String(data.settings.startsAt || ""),
      endsAt: String(data.settings.endsAt || ""),
      minScore: Math.max(0, Number(data.settings.minScore) || 0),
      notice: String(data.settings.notice || ""),
    };
  }

  function updateSettings(patch) {
    data.settings = { ...data.settings, ...patch };
    save();
    return readSettings();
  }

  /* ---------------- 用户 ---------------- */

  function findUserById(id) {
    return data.users.find((user) => user.id === Number(id)) || null;
  }

  function findUserByUsername(username) {
    const key = String(username || "").toLowerCase();
    return data.users.find((user) => String(user.username).toLowerCase() === key) || null;
  }

  function findAdmin() {
    return data.users.find((user) => user.is_admin) || null;
  }

  function insertUser(fields) {
    const user = {
      id: nextId(data.users),
      username: fields.username,
      nickname: fields.nickname,
      password_hash: fields.password_hash,
      password_salt: fields.password_salt,
      is_admin: fields.is_admin ? 1 : 0,
      banned: 0,
      best_score: 0,
      best_at: null,
      runs: 0,
      created_at: fields.created_at || nowIso(),
      last_login_at: fields.last_login_at || null,
      last_ip: fields.last_ip || null,
    };
    data.users.push(user);
    save();
    return user;
  }

  function updateUser(id, patch) {
    const user = findUserById(id);
    if (!user) return null;
    Object.assign(user, patch);
    save();
    return user;
  }

  function incrementRuns(id) {
    const user = findUserById(id);
    if (!user) return null;
    user.runs = Number(user.runs || 0) + 1;
    save();
    return user;
  }

  function removeUser(id) {
    const userId = Number(id);
    data.users = data.users.filter((user) => user.id !== userId);
    data.scores = data.scores.filter((score) => score.user_id !== userId);
    data.sessions = data.sessions.filter((session) => session.user_id !== userId);
    save();
  }

  function sortByRank(users) {
    return users.slice().sort((a, b) => {
      if (b.best_score !== a.best_score) return b.best_score - a.best_score;
      const at = a.best_at ? new Date(a.best_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bt = b.best_at ? new Date(b.best_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (at !== bt) return at - bt;
      return a.id - b.id;
    });
  }

  function listUsers({ keyword = "", page = 1, size = 50 } = {}) {
    const text = String(keyword).trim().toLowerCase();
    const filtered = text
      ? data.users.filter(
          (user) =>
            String(user.username).toLowerCase().includes(text) ||
            String(user.nickname).toLowerCase().includes(text),
        )
      : data.users.slice();
    const sorted = sortByRank(filtered);
    const start = (Math.max(1, page) - 1) * size;
    return {
      total: sorted.length,
      items: sorted.slice(start, start + size),
    };
  }

  function allUsersSorted() {
    return sortByRank(data.users);
  }

  function stats() {
    const submissions = data.scores.length;
    const players = data.users.filter((user) => user.best_score > 0).length;
    const banned = data.users.filter((user) => user.banned).length;
    const topScore = data.users
      .filter((user) => !user.banned)
      .reduce((max, user) => Math.max(max, Number(user.best_score) || 0), 0);
    return { users: data.users.length, banned, players, submissions, topScore };
  }

  /* ---------------- 成绩 ---------------- */

  function insertScore({ userId, score, ip = null, ua = null, createdAt = null }) {
    const record = {
      id: nextId(data.scores),
      user_id: Number(userId),
      score: Number(score),
      created_at: createdAt || nowIso(),
      ip,
      ua,
    };
    data.scores.push(record);
    save();
    return record;
  }

  function scoresForUser(userId, limit = 100) {
    return data.scores
      .filter((score) => score.user_id === Number(userId))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
  }

  function topScoreForUser(userId) {
    const own = data.scores.filter((score) => score.user_id === Number(userId));
    if (!own.length) return null;
    return own.reduce((best, item) => {
      if (!best) return item;
      if (item.score > best.score) return item;
      if (item.score === best.score && String(item.created_at) < String(best.created_at)) return item;
      return best;
    }, null);
  }

  function removeScore(id) {
    const scoreId = Number(id);
    const record = data.scores.find((score) => score.id === scoreId);
    if (!record) return null;
    data.scores = data.scores.filter((score) => score.id !== scoreId);
    save();
    return record;
  }

  /* ---------------- 会话 ---------------- */

  function createSession({ token, userId, createdAt, expiresAt, isAdmin }) {
    data.sessions.push({
      token,
      user_id: Number(userId),
      created_at: createdAt,
      expires_at: expiresAt,
      is_admin: isAdmin ? 1 : 0,
    });
    save();
  }

  function findSession(token) {
    return data.sessions.find((session) => session.token === token) || null;
  }

  function removeSession(token) {
    const before = data.sessions.length;
    data.sessions = data.sessions.filter((session) => session.token !== token);
    if (data.sessions.length !== before) save();
  }

  function removeSessionsForUser(userId, exceptToken = null) {
    const before = data.sessions.length;
    data.sessions = data.sessions.filter(
      (session) => session.user_id !== Number(userId) || (exceptToken && session.token === exceptToken),
    );
    if (data.sessions.length !== before) save();
  }

  /* ---------------- 排行榜 ---------------- */

  function leaderboard(limit, minScore, viewerId) {
    const eligible = sortByRank(
      data.users.filter((user) => !user.banned && user.best_score >= minScore),
    ).slice(0, limit);

    // 同分同名次，与 SQL 的 RANK() 行为一致。
    const rows = [];
    let rank = 0;
    let previousScore = null;
    eligible.forEach((user, index) => {
      if (previousScore === null || user.best_score !== previousScore) {
        rank = index + 1;
        previousScore = user.best_score;
      }
      rows.push({
        rank,
        id: user.id,
        nickname: user.nickname,
        score: user.best_score,
        at: user.best_at,
        isMe: user.id === viewerId,
      });
    });
    return rows;
  }

  function rankOf(userId, minScore) {
    const user = findUserById(userId);
    if (!user || user.banned) return null;
    if (user.best_score < minScore) return null;
    const ahead = data.users.filter(
      (other) => !other.banned && other.best_score > user.best_score,
    ).length;
    return ahead + 1;
  }

  function countOnBoard(minScore) {
    return data.users.filter((user) => !user.banned && user.best_score >= minScore).length;
  }

  return {
    file,
    readSettings,
    updateSettings,
    findUserById,
    findUserByUsername,
    findAdmin,
    insertUser,
    updateUser,
    incrementRuns,
    removeUser,
    listUsers,
    allUsersSorted,
    stats,
    insertScore,
    scoresForUser,
    topScoreForUser,
    removeScore,
    createSession,
    findSession,
    removeSession,
    removeSessionsForUser,
    leaderboard,
    rankOf,
    countOnBoard,
    save,
    raw: () => data,
  };
}

module.exports = { createStore, DEFAULT_SETTINGS };
