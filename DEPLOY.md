# 部署说明

## 先说结论

GitHub Pages 只能托管静态文件，跑不了 Node 服务。要排行榜、账号和管理端，必须有一台能运行 `node server.js` 的机器。

两条路，选一条：

| 方案 | 适合 | 代价 |
| --- | --- | --- |
| A. 整站迁到 Node 主机 | 想省事、只有一个地址 | 换掉 github.io 链接，要重新发推文链接 |
| B. 页面留 GitHub Pages，接口单独部署 | 想保住现有网址 | 多配一个域名 + CORS，前端多一层依赖 |

推荐 A：一个地址同时提供页面和接口，最不容易出错。

---

## 方案 A：整站部署到 Node 主机

需要 Node.js ≥ 18，不需要数据库。

```powershell
npm install        # 没有依赖，这一步只是生成 lock 文件，可跳过
node server.js
```

服务监听 `PORT`（默认 4173）和 `HOST`（默认 0.0.0.0）。

### 必配环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 端口，平台一般会自动注入 |
| `DATA_DIR` | 数据库目录，默认 `./data`；平台有持久盘时指到持久盘路径 |
| `ADMIN_USERNAME` | 管理员账号，不设则默认 `admin` |
| `ADMIN_PASSWORD` | 管理员初始密码，不设则随机生成并打印在日志里 |

### 平台要点

- **Render / Railway / Fly.io**：新建 Web Service，启动命令 `node server.js`，Node 版本选 18 或以上。
- 免费实例的文件系统通常是**临时的**，重新部署或休眠重启会丢掉 `data/db.json`。活动期间必须挂持久磁盘（Render 的 Disk、Railway 的 Volume），否则榜单会清零。
- 如果只能用临时文件系统，就把 `DATA_DIR` 指到持久盘挂载点，例如 `/var/data`。
- 启动日志里会打印管理员账号密码，第一次部署后立刻登录 `/admin.html` 改密码。

### 部署后自检

1. 打开 `/api/health`，返回 `{"ok":true}`。
2. 打开首页，右下角排行榜显示「还没有人上榜」。
3. 注册一个测试账号，跑一局，看榜单是否出现该成绩。
4. 用管理员账号登录 `/admin.html`，能看到这个测试账号，删除它。

---

## 方案 B：页面留 GitHub Pages，接口单独部署

1. 把仓库里除 `index.html` 外的服务端文件部署到 Node 主机，得到一个接口地址，例如 `https://scut-run-api.example.com`。
2. 服务端设置：
   ```powershell
   $env:CORS_ORIGIN = "https://zujin647.github.io"
   node server.js
   ```
3. 在 GitHub Pages 那份 `config.js` 里写：
   ```js
   window.SCUT_API_BASE = "https://scut-run-api.example.com";
   ```
4. 推送后刷新页面，排行榜能加载就说明打通了。

注意：GitHub Pages 部署的是静态文件，`admin.html` 可以放在上面（它在浏览器里调接口），但管理端的登录态和接口都在服务端，安全性不受影响。

---

## 数据备份

活动结束、发完奖之前记得备份：

```powershell
Copy-Item .\data\db.json .\backup-db.json
```

一个文件就是全部数据，复制走即可；恢复时改回 `data/db.json` 再启动。

或者直接在管理端「导出 CSV」，里面有账号、姓名、最高分、达成时间、提交次数，足够发奖和公示。

## 常见问题

**排行榜显示「排行榜暂未连接」**
接口没起来，或者 `config.js` 里的接口地址写错、CORS 没放开。

**登录后成绩没上榜**
检查管理端「活动设置」：是否关闭了提交、当前时间是否在开始/结束时间之外。

**忘记管理员密码**
先停掉服务，然后：

```powershell
node scripts/reset-admin.js 新的管理员密码
```

脚本会重置密码并让所有旧令牌失效。不要用删库的办法，那会清空所有选手成绩。

**Windows 终端里中文显示乱码**
先用 `chcp 65001` 切到 UTF-8，或在 Windows Terminal 里运行。
