(() => {
  "use strict";

  /* 若前端与接口不在同一域名（例如页面在 GitHub Pages、接口在别处），
     在 index.html 里提前设置 window.SCUT_API_BASE = "https://你的接口域名"。 */
  const API_BASE = String(window.SCUT_API_BASE || "").replace(/\/+$/, "");
  const TOKEN_KEY = "scut-run-token";

  const api = (pathname) => `${API_BASE}/api${pathname}`;

  const el = {
    accountButton: document.getElementById("accountButton"),
    leaderboard: document.getElementById("leaderboard"),
    leaderboardList: document.getElementById("leaderboardList"),
    leaderboardMeta: document.getElementById("leaderboardMeta"),
    leaderboardEmpty: document.getElementById("leaderboardEmpty"),
    myRank: document.getElementById("myRank"),
    authDialog: document.getElementById("authDialog"),
    authTitle: document.getElementById("authTitle"),
    authSubtitle: document.getElementById("authSubtitle"),
    authForm: document.getElementById("authForm"),
    authTabs: document.getElementById("authTabs"),
    authSubmit: document.getElementById("authSubmit"),
    authHint: document.getElementById("authHint"),
    fieldNickname: document.getElementById("fieldNickname"),
    nicknameField: document.getElementById("nicknameField"),
    fieldUsername: document.getElementById("fieldUsername"),
    fieldPassword: document.getElementById("fieldPassword"),
    closeAuthButton: document.getElementById("closeAuthButton"),
    accountPanel: document.getElementById("accountPanel"),
    accountName: document.getElementById("accountName"),
    accountBest: document.getElementById("accountBest"),
    accountRank: document.getElementById("accountRank"),
    logoutButton: document.getElementById("logoutButton"),
    passwordForm: document.getElementById("passwordForm"),
    passwordHint: document.getElementById("passwordHint"),
    overlayNote: document.getElementById("overlayNote"),
  };

  const state = {
    token: "",
    user: null,
    mode: "login",
    config: null,
    submitting: false,
    lastSubmittedScore: -1,
  };

  /* ---------------------------------------------------------------- */
  /* 请求                                                              */
  /* ---------------------------------------------------------------- */

  async function request(pathname, options = {}) {
    const headers = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (state.token) headers.Authorization = `Bearer ${state.token}`;

    let response;
    try {
      response = await fetch(api(pathname), {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new Error("网络不可用，请检查连接");
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const message = (payload && payload.error) || `请求失败（${response.status}）`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload || {};
  }

  function readToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function saveToken(token) {
    state.token = token || "";
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // 无痕模式下无法持久化，本次会话仍然可用。
    }
  }

  /* ---------------------------------------------------------------- */
  /* 渲染                                                              */
  /* ---------------------------------------------------------------- */

  function formatScore(value) {
    return Number(value || 0).toLocaleString("zh-CN");
  }

  function renderAccountButton() {
    if (!el.accountButton) return;
    if (state.user) {
      el.accountButton.textContent = state.user.nickname || state.user.username;
      el.accountButton.classList.add("is-signed-in");
      el.accountButton.setAttribute("aria-label", "账号设置");
    } else {
      el.accountButton.textContent = "登录 / 注册";
      el.accountButton.classList.remove("is-signed-in");
      el.accountButton.setAttribute("aria-label", "登录或注册");
    }
  }

  function renderLeaderboard(payload) {
    if (!el.leaderboardList) return;
    const items = (payload && payload.items) || [];
    el.leaderboardList.textContent = "";

    items.forEach((item) => {
      const row = document.createElement("li");
      row.className = "rank-row";
      if (item.isMe) row.classList.add("is-me");
      if (item.rank <= 3) row.classList.add(`rank-row--top${item.rank}`);

      const rank = document.createElement("span");
      rank.className = "rank-no";
      rank.textContent = String(item.rank);

      const name = document.createElement("span");
      name.className = "rank-name";
      name.textContent = item.nickname;

      const score = document.createElement("span");
      score.className = "rank-score";
      score.textContent = formatScore(item.score);

      row.append(rank, name, score);
      el.leaderboardList.append(row);
    });

    if (el.leaderboardEmpty) {
      el.leaderboardEmpty.hidden = items.length > 0;
      el.leaderboardEmpty.textContent = items.length
        ? ""
        : "还没有人上榜，第一条记录等你来写。";
    }

    if (el.leaderboardMeta) {
      const total = payload && typeof payload.totalPlayers === "number" ? payload.totalPlayers : items.length;
      el.leaderboardMeta.textContent = total ? `${total} 位选手已上榜` : "等待第一位选手";
    }
  }

  function renderMyRank() {
    if (!el.myRank) return;
    if (!state.user) {
      el.myRank.hidden = true;
      return;
    }
    el.myRank.hidden = false;
    if (!state.user.best) {
      el.myRank.textContent = `已登录：${state.user.nickname}，还没有上传过成绩，跑一轮试试。`;
      return;
    }
    el.myRank.textContent = `我的最高分 ${formatScore(state.user.best)}${
      typeof state.user.rank === "number" ? ` · 当前第 ${state.user.rank} 名` : ""
    }`;
  }

  function renderOverlayNote(text, tone) {
    if (!el.overlayNote) return;
    el.overlayNote.textContent = text || "";
    el.overlayNote.hidden = !text;
    el.overlayNote.dataset.tone = tone || "";
  }

  /* ---------------------------------------------------------------- */
  /* 账号弹窗                                                          */
  /* ---------------------------------------------------------------- */

  function setAuthMode(mode) {
    state.mode = mode;
    if (!el.authDialog) return;
    const isLogin = mode === "login";
    el.authDialog.dataset.mode = mode;
    el.authTitle.textContent = isLogin ? "登录" : "注册";
    el.authSubtitle.textContent = isLogin
      ? "用你的账号登录，成绩会自动进入排行榜。"
      : "账号建议直接用学号，姓名会显示在排行榜上。";
    el.authSubmit.textContent = isLogin ? "登录" : "注册并登录";
    if (el.nicknameField) el.nicknameField.hidden = isLogin;
    el.accountPanel.hidden = true;
    el.authForm.hidden = false;
    el.authHint.textContent = "";
    el.authHint.dataset.tone = "";
    el.authTabs.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === mode);
      button.setAttribute("aria-selected", String(button.dataset.mode === mode));
    });
  }

  function setAuthHint(message, tone) {
    el.authHint.textContent = message || "";
    el.authHint.dataset.tone = tone || "";
  }

  function openAuthDialog() {
    if (!el.authDialog) return;
    if (state.user) {
      el.authForm.hidden = true;
      el.accountPanel.hidden = false;
      el.authTitle.textContent = "我的账号";
      el.authSubtitle.textContent = "成绩会以你的姓名出现在排行榜上。";
      el.accountName.textContent = `${state.user.nickname}（${state.user.username}）`;
      el.accountBest.textContent = state.user.best ? formatScore(state.user.best) : "还没有成绩";
      el.accountRank.textContent =
        typeof state.user.rank === "number" ? `第 ${state.user.rank} 名` : "暂未上榜";
    } else {
      setAuthMode("login");
    }
    el.authDialog.showModal();
  }

  async function refreshMe() {
    if (!state.token) {
      state.user = null;
      renderAccountButton();
      renderMyRank();
      return;
    }
    try {
      const payload = await request("/auth/me");
      state.user = { ...payload.user, rank: payload.rank };
    } catch (error) {
      if (error.status === 401) saveToken("");
      state.user = null;
    }
    renderAccountButton();
    renderMyRank();
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const username = el.fieldUsername.value.trim();
    const password = el.fieldPassword.value;
    const nickname = el.fieldNickname.value.trim();

    if (!username || !password) {
      setAuthHint("请填写账号和密码", "error");
      return;
    }
    if (state.mode === "register" && password.length < 6) {
      setAuthHint("密码至少 6 位", "error");
      return;
    }

    el.authSubmit.disabled = true;
    el.authSubmit.textContent = state.mode === "login" ? "登录中…" : "提交中…";
    try {
      const payload = await request(state.mode === "login" ? "/auth/login" : "/auth/register", {
        method: "POST",
        body:
          state.mode === "login"
            ? { username, password }
            : { username, password, nickname: nickname || username },
      });
      saveToken(payload.token);
      state.user = payload.user;
      el.authForm.reset();
      setAuthHint(state.mode === "login" ? "登录成功" : "注册成功", "ok");
      await refreshMe();
      await loadLeaderboard(true);
      window.setTimeout(() => {
        if (el.authDialog.open) el.authDialog.close();
      }, 700);
    } catch (error) {
      setAuthHint(error.message, "error");
    } finally {
      el.authSubmit.disabled = false;
      el.authSubmit.textContent = state.mode === "login" ? "登录" : "注册并登录";
    }
  }

  async function logout() {
    try {
      await request("/auth/logout", { method: "POST" });
    } catch {
      // 服务端不可达时也允许本地退出。
    }
    saveToken("");
    state.user = null;
    renderAccountButton();
    renderMyRank();
    if (el.authDialog && el.authDialog.open) el.authDialog.close();
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    const oldPassword = el.passwordForm.oldPassword.value;
    const newPassword = el.passwordForm.newPassword.value;
    if (newPassword.length < 6) {
      el.passwordHint.textContent = "新密码至少 6 位";
      el.passwordHint.dataset.tone = "error";
      return;
    }
    try {
      await request("/auth/password", {
        method: "POST",
        body: { oldPassword, newPassword },
      });
      el.passwordForm.reset();
      el.passwordHint.textContent = "密码已更新";
      el.passwordHint.dataset.tone = "ok";
    } catch (error) {
      el.passwordHint.textContent = error.message;
      el.passwordHint.dataset.tone = "error";
    }
  }

  /* ---------------------------------------------------------------- */
  /* 排行榜与成绩                                                      */
  /* ---------------------------------------------------------------- */

  async function loadConfig() {
    try {
      const payload = await request("/config");
      state.config = payload.event;
      if (el.leaderboardMeta && !payload.event.allowed && payload.event.reason) {
        el.leaderboardMeta.textContent = `${payload.event.reason} · 仍可浏览榜单`;
      }
    } catch {
      state.config = null;
    }
  }

  async function loadLeaderboard(quiet) {
    if (!el.leaderboardList) return;
    if (!quiet) el.leaderboardMeta.textContent = "加载中…";
    try {
      const payload = await request("/leaderboard?limit=50");
      renderLeaderboard(payload);
    } catch (error) {
      if (quiet) return;
      el.leaderboardList.textContent = "";
      el.leaderboardMeta.textContent = "排行榜未连接";
      if (el.leaderboardEmpty) {
        el.leaderboardEmpty.hidden = false;
        el.leaderboardEmpty.textContent = "服务端上线后，这里会显示所有选手的实时排名。";
      }
      if (el.myRank) el.myRank.hidden = true;
      void error;
    }
  }

  async function submitScore(score) {
    if (!state.user || state.submitting) return;
    if (score === state.lastSubmittedScore) return;
    state.submitting = true;
    state.lastSubmittedScore = score;
    renderOverlayNote("正在上传成绩…", "muted");
    try {
      const payload = await request("/scores", { method: "POST", body: { score } });
      state.user.best = payload.best;
      state.user.rank = payload.rank;
      const text = payload.improved
        ? `成绩已上传，个人最佳 ${formatScore(payload.best)}`
        : `成绩已上传，个人最佳仍是 ${formatScore(payload.best)}`;
      renderOverlayNote(
        typeof payload.rank === "number" ? `${text} · 当前第 ${payload.rank} 名` : text,
        "ok",
      );
      renderMyRank();
      await loadLeaderboard(true);
    } catch (error) {
      renderOverlayNote(error.message, "error");
    } finally {
      state.submitting = false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* 初始化                                                            */
  /* ---------------------------------------------------------------- */

  function bindEvents() {
    if (el.accountButton) el.accountButton.addEventListener("click", openAuthDialog);
    if (el.closeAuthButton) el.closeAuthButton.addEventListener("click", () => el.authDialog.close());
    if (el.authForm) el.authForm.addEventListener("submit", handleAuthSubmit);
    if (el.logoutButton) el.logoutButton.addEventListener("click", logout);
    if (el.passwordForm) el.passwordForm.addEventListener("submit", handlePasswordChange);
    if (el.authTabs) {
      el.authTabs.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-mode]");
        if (button) setAuthMode(button.dataset.mode);
      });
    }
    if (el.authDialog) {
      el.authDialog.addEventListener("click", (event) => {
        if (event.target === el.authDialog) el.authDialog.close();
      });
    }

    window.addEventListener("scut:run-finished", (event) => {
      const detail = event.detail || {};
      if (!state.user) {
        renderOverlayNote("登录后成绩可计入排行榜（右上角登录）", "muted");
        return;
      }
      submitScore(Number(detail.score) || 0);
    });
  }

  async function main() {
    bindEvents();
    state.token = readToken();
    renderAccountButton();
    await loadConfig();
    await refreshMe();
    await loadLeaderboard(false);
    if (state.user) window.setTimeout(() => loadLeaderboard(true), 4000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }

  window.SCUT_BOARD = {
    refresh: () => loadLeaderboard(false),
    getState: () => ({ ...state, token: state.token ? "(已设置)" : "" }),
  };
})();
