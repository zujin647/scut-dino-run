# 华工快跑

华南理工大学校园主题跑酷游戏。华南理工大学校徽作为主角，木棉树作为主要障碍，远景包含逸夫科技馆、图书馆、六号楼和正门刻石等校园地标。

在此基础上增加了活动功能：**选手账号、实时排行榜、活动管理端**。

## 本地运行

```powershell
npm start
```

浏览器打开 `http://localhost:4173`，管理端在 `http://localhost:4173/admin.html`。终端同时会输出局域网地址，同一网络内的手机或电脑可以直接访问。

首次启动会自动创建管理员账号，并把随机密码打印在终端（**只打印一次，务必记下来**）。也可以用环境变量固定：

```powershell
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "换成你自己的密码"
$env:PORT = "4173"
npm start
```

需要 Node.js 18 或更高版本。**不需要安装数据库**——数据存在 `data/db.json` 一个文件里，也能用记事本直接打开看。

## 一键启动（自带临时公网地址）

不想准备服务器时，双击 `启动.bat`（macOS / Linux 用 `./启动.sh`），或在命令行运行：

```powershell
npm run public
```

脚本会启动游戏服务，并尝试用 Cloudflare Quick Tunnel 开一个**免费、免注册**的临时公网地址，形如：

```
════════════════════════════════════════════════════════════
  公网地址已就绪
════════════════════════════════════════════════════════════
  游戏　　　 https://xxxx-xxxx-xxxx.trycloudflare.com
  管理端　　 https://xxxx-xxxx-xxxx.trycloudflare.com/admin.html
  管理员　　 admin / 随机密码（存在 data/admin-password.txt）
  数据　　　 data/db.json
════════════════════════════════════════════════════════════
```

用这个地址生成二维码发给学生即可，所有人打开都能看到同一个排行榜。

使用前提与限制：

- 需要 `cloudflared`。Windows 可以 `winget install cloudflared`，或从
  <https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe>
  下载后改名为 `cloudflared.exe` 放在本目录；macOS 用 `brew install cloudflared`。
- **这台电脑要一直开着、不能断网**，关掉或断网地址立即失效。
- 地址是临时的，**重启脚本会换一个新地址**，公众号里发出去的二维码要重新生成。适合先试跑或短时间活动。
- 只开局域网（不需要 cloudflared）：`npm run lan`。


## 活动功能

### 选手端

- 右上角「登录 / 注册」：账号建议直接用学号，姓名会显示在排行榜上。
- 登录后每局结束自动上传成绩，榜单取个人最高分，同分按达成时间先后排序。
- 页面下方是实时排行榜，会高亮自己那一行。
- 账号弹窗里可以修改密码、查看自己的最高分和当前名次。

### 管理端 `/admin.html`

- 概览：注册人数、参与人数、提交次数、最高分、当前活动状态。
- 选手管理：搜索、按最高分排序、重置密码（自动生成新密码）、停用/解封、删除、手动补录成绩、查看并删除单条成绩记录。
- 活动设置：开放/关闭提交、开始与结束时间、上榜最低分、榜单公告。
- 安全设置：修改管理员密码。
- 导出 CSV（带 BOM，Excel 直接打开不乱码）。

### 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册，返回令牌 |
| POST | `/api/auth/login` | 登录，返回令牌 |
| GET | `/api/auth/me` | 当前用户与名次 |
| POST | `/api/auth/logout` | 退出 |
| POST | `/api/auth/password` | 修改自己的密码 |
| POST | `/api/scores` | 提交成绩（需登录） |
| GET | `/api/leaderboard?limit=50` | 排行榜 |
| GET | `/api/config` | 活动状态 |
| POST | `/api/admin/login` | 管理员登录 |
| GET | `/api/admin/overview` `/users` `/settings` `/export.csv` | 管理查询 |
| POST | `/api/admin/users/:id/password` `/ban` `/score` | 管理操作 |
| DELETE | `/api/admin/users/:id` `/api/admin/scores/:id` | 删除选手 / 删除成绩 |

## 数据与安全

- 数据存在 `data/db.json`，就是一份普通 JSON 文件，已加入 `.gitignore`，不要提交。
- 每次改动都会整份写回（先写临时文件再改名），单进程小数据量够用；不要同时起多个实例指向同一个数据目录。
- 密码用 `scrypt` 加盐哈希，令牌有效期 30 天，服务端只存哈希与令牌，不存明文。
- 登录、注册、提交成绩都有频率限制；成绩提交间隔不得小于 1.2 秒。
- 接口默认只允许同源访问。前后端分开部署时用 `CORS_ORIGIN` 指定允许的页面域名。
- 成绩由客户端上报，服务端无法验证真实性。发现异常高分可以在管理端查看该选手的记录并删除，最高分会自动重算。

## 验证

```powershell
npm run check    # 语法检查
npm run test:api # 端到端接口测试（34 项，自动起临时实例，含重启后数据仍在）
```

## 操作

- 空格、向上键、轻触画面或“跳跃”按钮：跳跃
- 向下键或按住“低头”按钮：低头
- 页面失去焦点时自动暂停

## 部署

见 [DEPLOY.md](./DEPLOY.md)。注意：GitHub Pages 只能托管静态页面，排行榜需要一台能跑 Node 的服务器。

## 素材与发布提示

校徽为华南理工大学校方标识，本项目是非官方校园互动作品。若用于公开传播、商业场景或正式活动，请自行确认校徽与校名使用规范。校园建筑照片未直接嵌入游戏，仅用于确认地标特征；相关照片来自 Wikimedia Commons。

完整来源与授权说明见 [CREDITS.md](./CREDITS.md)。
