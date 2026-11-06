(() => {
  "use strict";

  const API_BASE = String(window.SCUT_API_BASE || "").replace(/\/+$/, "");
  const TOKEN_KEY = "scut-admin-token";

  const $ = (id) => document.getElementById(id);

  const el = {
    loginView: $("loginView"),
    consoleView: $("consoleView"),
    loginForm: $("loginForm"),
    loginHint: $("loginHint"),
    loginSubmit: $("loginSubmit"),
    logoutAdmin: $("logoutAdmin"),

    statUsers: $("statUsers"),
    statPlayers: $("statPlayers"),
    statSubmissions: $("statSubmissions"),
    statTop: $("statTop"),
    statState: $("statState"),

    adminTabs: $("adminTabs"),
    searchInput: $("searchInput"),
    searchButton: $("searchButton"),
    refreshButton: $("refreshButton"),
    exportButton: $("exportButton"),
    usersHint: $("usersHint"),
    userRows: $("userRows"),
    prevPage: $("prevPage"),
    nextPage: $("nextPage"),
    pageInfo: $("pageInfo"),

    settingsForm: $("settingsForm"),
    settingOpen: $("settingOpen"),
    settingStart: $("settingStart"),
    settingEnd: $("settingEnd"),
    settingMinScore: $("settingMinScore"),
    settingNotice: $("settingNotice"),
    settingsHint: $("settingsHint"),

    adminPasswordForm: $("adminPasswordForm"),
    newAdminPassword: $("newAdminPassword"),
    confirmAdminPassword: $("confirmAdminPassword"),
    securityHint: $("securityHint"),

    passwordDialog: $("passwordDialog"),
    generatedPassword: $("generatedPassword"),
    copyPassword: $("copyPassword"),
    closePasswordDialog: $("closePasswordDialog"),

    scoresDialog: $("scoresDialog"),
    scoresTitle: $("scoresTitle"),
    scoresHint: $("scoresHint"),
    scoresList: $("scoresList"),
    closeScoresDialog: $("closeScoresDialog"),

    toast: $("toast"),
  };

  const state = {
    token: "",
    page: 1,
    size: 50,
    keyword: "",
    total: 0,
    openScoresUserId: null,
  };

  /* ---------------------------------------------------------------- */

  function toast(message, tone) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.dataset.tone = tone || "";
    el.toast.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => {
      el.toast.hidden = true;
    }, 3200);
  }

  function setHint(node, message, tone) {
    if (!node) return;
    node.textContent = message || "";
    node.dataset.tone = tone || "";
  }

  async function request(pathname, options = {}) {
    const headers = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (state.token) headers.Authorization = `Bearer ${state.token}`;

    let response;
    try {
      response = await fetch(`${API_BASE}/api${pathname}`, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new Error("网络不可用");
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
      if (response.status === 401) handleExpired();
      throw new Error((payload && payload.error) || `请求失败（${response.status}）`);
    }
    return payload || {};
  }

  function handleExpired() {
    state.token = "";
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    el.loginView.hidden = false;
    el.consoleView.hidden = true;
    el.logoutAdmin.hidden = true;
    setHint(el.loginHint, "登录已过期，请重新登录", "error");
  }

  /* ---------------------------------------------------------------- */
  /* 登录                                                              */
  /* ---------------------------------------------------------------- */

  async function handleLogin(event) {
    event.preventDefault();
    const username = $("adminUsername").value.trim();
    const password = $("adminPassword").value;
    el.loginSubmit.disabled = true;
    el.loginSubmit.textContent = "登录中…";
    try {
      const payload = await request("/admin/login", {
        method: "POST",
        body: { username, password },
      });
      state.token = payload.token;
      try {
        window.localStorage.setItem(TOKEN_KEY, payload.token);
      } catch {
        /* ignore */
      }
      el.loginForm.reset();
      setHint(el.loginHint, "");
      enterConsole();
    } catch (error) {
      setHint(el.loginHint, error.message, "error");
    } finally {
      el.loginSubmit.disabled = false;
      el.loginSubmit.textContent = "登录";
    }
  }

  function enterConsole() {
    el.loginView.hidden = true;
    el.consoleView.hidden = false;
    el.logoutAdmin.hidden = false;
    loadOverview();
    loadUsers();
    loadSettings();
  }

  function logout() {
    state.token = "";
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    el.consoleView.hidden = true;
    el.loginView.hidden = false;
    el.logoutAdmin.hidden = true;
  }

  /* ---------------------------------------------------------------- */
  /* 概览                                                              */
  /* ---------------------------------------------------------------- */

  async function loadOverview() {
    try {
      const payload = await request("/admin/overview");
      const totals = payload.totals || {};
      el.statUsers.textContent = String(totals.users ?? "—");
      el.statPlayers.textContent = String(totals.players ?? "—");
      el.statSubmissions.textContent = String(totals.submissions ?? "—");
      el.statTop.textContent = Number(totals.topScore || 0).toLocaleString("zh-CN");

      const settings = payload.settings || {};
      const allowed = payload.allowed || {};
      const parts = [];
      if (!settings.open) parts.push("提交已关闭");
      if (allowed.allowed) parts.push("正在接收成绩");
      else if (allowed.reason) parts.push(allowed.reason);
      if (settings.startsAt) parts.push(`开始 ${formatLocal(settings.startsAt)}`);
      if (settings.endsAt) parts.push(`结束 ${formatLocal(settings.endsAt)}`);
      el.statState.textContent = parts.join(" · ") || "不限时间";
    } catch (error) {
      toast(error.message, "error");
    }
  }

  /* ---------------------------------------------------------------- */
  /* 选手列表                                                          */
  /* ---------------------------------------------------------------- */

  function formatLocal(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  }

  function toLocalInput(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  }

  function fromLocalInput(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function badge(text, kind) {
    const span = document.createElement("span");
    span.className = `badge badge--${kind}`;
    span.textContent = text;
    return span;
  }

  function actionButton(label, onClick, danger) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mini-button${danger ? " mini-button--danger" : ""}`;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderUsers(payload) {
    el.userRows.textContent = "";
    const items = payload.items || [];
    state.total = payload.total || 0;
    const pages = Math.max(1, Math.ceil(state.total / state.size));
    el.pageInfo.textContent = `第 ${payload.page || state.page} / ${pages} 页 · 共 ${state.total} 人`;

    if (!items.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 8;
      cell.textContent = "没有匹配的账号";
      cell.style.textAlign = "center";
      row.append(cell);
      el.userRows.append(row);
      return;
    }

    items.forEach((user, index) => {
      const row = document.createElement("tr");
      if (user.banned) row.classList.add("is-banned");

      const rank = document.createElement("td");
      rank.textContent = String((state.page - 1) * state.size + index + 1);

      const account = document.createElement("td");
      account.textContent = user.username;
      if (user.isAdmin) account.append(" ", badge("管理员", "ok"));

      const nickname = document.createElement("td");
      nickname.textContent = user.nickname;

      const best = document.createElement("td");
      best.textContent = Number(user.best || 0).toLocaleString("zh-CN");

      const bestAt = document.createElement("td");
      bestAt.textContent = formatLocal(user.bestAt);

      const runs = document.createElement("td");
      runs.textContent = String(user.runs ?? 0);

      const status = document.createElement("td");
      status.append(user.banned ? badge("已停用", "off") : badge("正常", "ok"));

      const actions = document.createElement("td");
      const box = document.createElement("div");
      box.className = "row-actions";

      box.append(
        actionButton("记录", () => openScores(user)),
        actionButton("录入", () => manualScore(user)),
        actionButton("重置密码", () => resetPassword(user)),
        actionButton(user.banned ? "解封" : "停用", () => toggleBan(user), user.banned === false),
      );
      if (!user.isAdmin) box.append(actionButton("删除", () => removeUser(user), true));

      actions.append(box);
      row.append(rank, account, nickname, best, bestAt, runs, status, actions);
      el.userRows.append(row);
    });
  }

  async function loadUsers() {
    el.usersHint.textContent = "加载中…";
    el.usersHint.dataset.tone = "";
    try {
      const params = new URLSearchParams({
        page: String(state.page),
        size: String(state.size),
      });
      if (state.keyword) params.set("q", state.keyword);
      const payload = await request(`/admin/users?${params.toString()}`);
      renderUsers(payload);
      el.usersHint.textContent = `共 ${state.total} 个账号`;
    } catch (error) {
      el.usersHint.textContent = error.message;
      el.usersHint.dataset.tone = "error";
    }
  }

  async function resetPassword(user) {
    if (!window.confirm(`重置「${user.nickname}（${user.username}）」的密码？`)) return;
    try {
      const payload = await request(`/admin/users/${user.id}/password`, { method: "POST", body: {} });
      el.generatedPassword.textContent = payload.password;
      el.passwordDialog.showModal();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function manualScore(user) {
    const input = window.prompt(
      `给「${user.nickname}」录入一个成绩（仅用于补录现场成绩，会直接覆盖最高分）：`,
      String(user.best || ""),
    );
    if (input === null) return;
    const score = Number(input);
    if (!Number.isFinite(score) || score < 0) {
      toast("成绩格式不正确", "error");
      return;
    }
    try {
      await request(`/admin/users/${user.id}/score`, { method: "POST", body: { score } });
      toast("已录入");
      loadUsers();
      loadOverview();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function toggleBan(user) {
    const next = !user.banned;
    if (next && !window.confirm(`停用「${user.nickname}」？停用后无法登录，榜单上也不再显示。`)) return;
    try {
      await request(`/admin/users/${user.id}/ban`, { method: "POST", body: { banned: next } });
      toast(next ? "已停用" : "已解封");
      loadUsers();
      loadOverview();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function removeUser(user) {
    if (!window.confirm(`删除「${user.nickname}（${user.username}）」及其全部成绩？此操作不可恢复。`)) {
      return;
    }
    try {
      await request(`/admin/users/${user.id}`, { method: "DELETE" });
      toast("已删除");
      loadUsers();
      loadOverview();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  /* ---------------------------------------------------------------- */
  /* 成绩记录                                                          */
  /* ---------------------------------------------------------------- */

  async function openScores(user) {
    state.openScoresUserId = user.id;
    el.scoresTitle.textContent = `${user.nickname} 的成绩记录`;
    el.scoresHint.textContent = "加载中…";
    el.scoresList.textContent = "";
    el.scoresDialog.showModal();
    await loadScores();
  }

  async function loadScores() {
    if (!state.openScoresUserId) return;
    try {
      const payload = await request(`/admin/users/${state.openScoresUserId}/scores`);
      const items = payload.items || [];
      el.scoresList.textContent = "";
      el.scoresHint.textContent = items.length
        ? "删除异常的记录后，最高分会自动重新计算。"
        : "还没有上传过成绩。";
      items.forEach((item) => {
        const li = document.createElement("li");
        const left = document.createElement("span");
        const score = document.createElement("strong");
        score.textContent = String(item.score);
        left.append(score, ` · ${formatLocal(item.created_at)}`);
        li.append(
          left,
          actionButton("删除", async () => {
            if (!window.confirm(`删除这条 ${item.score} 分的记录？`)) return;
            try {
              await request(`/admin/scores/${item.id}`, { method: "DELETE" });
              toast("已删除");
              loadScores();
              loadUsers();
              loadOverview();
            } catch (error) {
              toast(error.message, "error");
            }
          }, true),
        );
        el.scoresList.append(li);
      });
    } catch (error) {
      el.scoresHint.textContent = error.message;
    }
  }

  /* ---------------------------------------------------------------- */
  /* 设置                                                              */
  /* ---------------------------------------------------------------- */

  async function loadSettings() {
    try {
      const payload = await request("/admin/settings");
      const settings = payload.settings || {};
      el.settingOpen.checked = Boolean(settings.open);
      el.settingStart.value = toLocalInput(settings.startsAt);
      el.settingEnd.value = toLocalInput(settings.endsAt);
      el.settingMinScore.value = String(settings.minScore ?? 1);
      el.settingNotice.value = settings.notice || "";
    } catch (error) {
      setHint(el.settingsHint, error.message, "error");
    }
  }

  async function handleSettingsSave(event) {
    event.preventDefault();
    const body = {
      open: el.settingOpen.checked,
      startsAt: fromLocalInput(el.settingStart.value),
      endsAt: fromLocalInput(el.settingEnd.value),
      minScore: Number(el.settingMinScore.value) || 0,
      notice: el.settingNotice.value,
    };
    try {
      await request("/admin/settings", { method: "PUT", body });
      setHint(el.settingsHint, "已保存", "ok");
      toast("设置已保存");
      loadOverview();
    } catch (error) {
      setHint(el.settingsHint, error.message, "error");
    }
  }

  async function handleAdminPassword(event) {
    event.preventDefault();
    if (el.newAdminPassword.value !== el.confirmAdminPassword.value) {
      setHint(el.securityHint, "两次输入的密码不一致", "error");
      return;
    }
    try {
      await request("/admin/password", {
        method: "POST",
        body: { newPassword: el.newAdminPassword.value },
      });
      el.adminPasswordForm.reset();
      setHint(el.securityHint, "管理员密码已更新", "ok");
    } catch (error) {
      setHint(el.securityHint, error.message, "error");
    }
  }

  async function exportCsv() {
    try {
      const response = await fetch(`${API_BASE}/api/admin/export.csv`, {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (!response.ok) throw new Error(`导出失败（${response.status}）`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "scut-run-scores.csv";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  /* ---------------------------------------------------------------- */
  /* 初始化                                                            */
  /* ---------------------------------------------------------------- */

  function bindTabs() {
    el.adminTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-panel]");
      if (!button) return;
      const name = button.dataset.panel;
      el.adminTabs.querySelectorAll("button").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      document.querySelectorAll(".panel").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== name;
      });
    });
  }

  function bindEvents() {
    el.loginForm.addEventListener("submit", handleLogin);
    el.logoutAdmin.addEventListener("click", logout);
    el.searchButton.addEventListener("click", () => {
      state.keyword = el.searchInput.value.trim();
      state.page = 1;
      loadUsers();
    });
    el.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        el.searchButton.click();
      }
    });
    el.refreshButton.addEventListener("click", () => {
      loadOverview();
      loadUsers();
    });
    el.exportButton.addEventListener("click", exportCsv);
    el.prevPage.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        loadUsers();
      }
    });
    el.nextPage.addEventListener("click", () => {
      if (state.page * state.size < state.total) {
        state.page += 1;
        loadUsers();
      }
    });
    el.settingsForm.addEventListener("submit", handleSettingsSave);
    el.adminPasswordForm.addEventListener("submit", handleAdminPassword);
    el.closePasswordDialog.addEventListener("click", () => el.passwordDialog.close());
    el.closeScoresDialog.addEventListener("click", () => el.scoresDialog.close());
    el.copyPassword.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(el.generatedPassword.textContent);
        toast("已复制");
      } catch {
        toast("复制失败，请手动选择", "error");
      }
    });
    bindTabs();
  }

  async function restoreSession() {
    try {
      state.token = window.localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      state.token = "";
    }
    if (!state.token) return;
    try {
      await request("/admin/overview");
      enterConsole();
    } catch {
      state.token = "";
    }
  }

  bindEvents();
  restoreSession();
})();
