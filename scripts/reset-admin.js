"use strict";

// 重置管理员密码（忘记密码时用）：
//   node scripts/reset-admin.js 新密码
// 需要先停掉正在运行的服务，避免两个进程同时写 data/db.json。

const crypto = require("node:crypto");
const path = require("node:path");
const { createStore } = require("../store");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));

const password = process.argv[2];
const username = process.argv[3] || process.env.ADMIN_USERNAME || "admin";

if (!password || password.length < 8) {
  console.error("用法：node scripts/reset-admin.js <新密码（至少 8 位）> [管理员账号]");
  process.exit(1);
}

const store = createStore(DATA_DIR);
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(password, salt, 64).toString("hex");

const existing = store.findUserByUsername(username);
if (existing) {
  store.updateUser(existing.id, { password_hash: hash, password_salt: salt, is_admin: 1 });
  store.removeSessionsForUser(existing.id);
  console.log(`已重置管理员「${username}」的密码。`);
} else {
  store.insertUser({
    username,
    nickname: "活动管理员",
    password_hash: hash,
    password_salt: salt,
    is_admin: 1,
  });
  console.log(`已创建管理员「${username}」。`);
}

console.log("旧令牌已全部失效，请用新密码登录 /admin.html。");
console.log(`数据文件：${store.file}`);
