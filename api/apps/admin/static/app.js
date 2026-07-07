// Admin dashboard — vanilla JS, no build step.
const API_BASE = "/api/admin";
const TOKEN_KEY = "admin_bearer_token";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  tab: "stats",
  authApiUrl: "",
  // per-tab paging/filter state
  users: { page: 1, pageSize: 20, search: "" },
  transactions: { page: 1, pageSize: 20, userId: "", type: "" },
  renderJobs: { page: 1, pageSize: 20, status: "" },
};

// ---------- fetch helpers ----------

async function api(path, opts = {}) {
  const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (res.status === 401) {
    logout();
    throw new Error("Session expired, please sign in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body.data;
}

function qs(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// ---------- toast ----------

function toast(message, kind = "success") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- auth / login ----------

function logout() {
  state.token = "";
  localStorage.removeItem(TOKEN_KEY);
  document.getElementById("app-view").style.display = "none";
  document.getElementById("login-view").style.display = "flex";
}

async function loadConfig() {
  try {
    const res = await fetch(API_BASE + "/config");
    const body = await res.json();
    state.authApiUrl = body?.data?.authApiUrl || "";
  } catch {
    state.authApiUrl = "";
  }
}

function setLoginError(msg) {
  const el = document.getElementById("login-error");
  el.innerHTML = msg ? `<div class="error-box">${escapeHtml(msg)}</div>` : "";
}

function wireLogin() {
  const tabToken = document.getElementById("login-tab-token");
  const tabPw = document.getElementById("login-tab-pw");
  const formToken = document.getElementById("login-form-token");
  const formPw = document.getElementById("login-form-pw");

  tabToken.addEventListener("click", () => {
    tabToken.classList.add("active");
    tabPw.classList.remove("active");
    formToken.style.display = "block";
    formPw.style.display = "none";
    setLoginError("");
  });
  tabPw.addEventListener("click", () => {
    tabPw.classList.add("active");
    tabToken.classList.remove("active");
    formPw.style.display = "block";
    formToken.style.display = "none";
    setLoginError("");
  });

  formToken.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = document.getElementById("token-input").value.trim();
    if (!token) return;
    await tryEnter(token);
  });

  formPw.addEventListener("submit", async (e) => {
    e.preventDefault();
    setLoginError("");
    const email = document.getElementById("email-input").value.trim();
    const password = document.getElementById("password-input").value;
    if (!email || !password) return;
    if (!state.authApiUrl) {
      setLoginError("Auth API URL is not configured (see /api/admin/config).");
      return;
    }
    try {
      const res = await fetch(`${state.authApiUrl}/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoginError(body?.message || body?.error?.message || "Sign-in failed");
        return;
      }
      const token = res.headers.get("set-auth-token") || body?.token || body?.data?.token;
      if (!token) {
        setLoginError("Signed in, but no session token was returned.");
        return;
      }
      await tryEnter(token);
    } catch (err) {
      setLoginError(err.message || "Sign-in failed");
    }
  });
}

async function tryEnter(token) {
  state.token = token;
  try {
    await api("/stats"); // validates admin access
    localStorage.setItem(TOKEN_KEY, token);
    setLoginError("");
    enterApp();
  } catch (err) {
    state.token = "";
    setLoginError(err.message || "Invalid credentials or not an admin.");
  }
}

function enterApp() {
  document.getElementById("login-view").style.display = "none";
  document.getElementById("app-view").style.display = "block";
  renderTab();
}

// ---------- shell ----------

function wireShell() {
  document.getElementById("logout-btn").addEventListener("click", logout);
  document.querySelectorAll("#tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.tab = btn.dataset.tab;
      renderTab();
    });
  });
}

function main() {
  return document.getElementById("main");
}

async function renderTab() {
  const el = main();
  el.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    switch (state.tab) {
      case "stats": return await renderStats(el);
      case "users": return await renderUsers(el);
      case "transactions": return await renderTransactions(el);
      case "costs": return await renderCosts(el);
      case "settings": return await renderSettings(el);
      case "render-jobs": return await renderRenderJobs(el);
      case "templates": return await renderTemplates(el);
      default: return;
    }
  } catch (err) {
    el.innerHTML = `<div class="panel"><div class="error-box">${escapeHtml(err.message)}</div></div>`;
  }
}

// ---------- utils ----------

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function fmtDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}
function fmtNum(n) {
  return typeof n === "number" ? n.toLocaleString() : n ?? "—";
}
function pillFor(status) {
  const map = { completed: "ok", ready: "ok", active: "ok", rendering: "warn", queued: "neutral", pending: "neutral", failed: "danger", generating: "warn" };
  const cls = map[status] || "neutral";
  return `<span class="pill ${cls}">${escapeHtml(status)}</span>`;
}
function pager(pageState, total, onChange) {
  const totalPages = Math.max(1, Math.ceil(total / pageState.pageSize));
  const wrap = document.createElement("div");
  wrap.className = "pager";
  wrap.innerHTML = `
    <span>Page ${pageState.page} of ${totalPages} · ${fmtNum(total)} total</span>
    <button class="secondary" ${pageState.page <= 1 ? "disabled" : ""} data-dir="-1">Prev</button>
    <button class="secondary" ${pageState.page >= totalPages ? "disabled" : ""} data-dir="1">Next</button>
  `;
  wrap.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      pageState.page += Number(b.dataset.dir);
      onChange();
    });
  });
  return wrap;
}

// ---------- modal ----------

function openModal(title, bodyHtml, { onSubmit, submitLabel = "Save" } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3>${escapeHtml(title)}</h3>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions">
        <button class="secondary" data-act="cancel">Cancel</button>
        <button data-act="submit">${escapeHtml(submitLabel)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('[data-act="cancel"]').addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-act="submit"]').addEventListener("click", async () => {
    try {
      await onSubmit?.(backdrop, close);
    } catch (err) {
      toast(err.message || "Action failed", "error");
    }
  });
  return backdrop;
}

// ---------- Stats ----------

async function renderStats(el) {
  const data = await api("/stats");
  const renders = data.rendersByStatus || {};
  const renderTiles = Object.entries(renders)
    .map(([status, n]) => `<div class="stat-tile"><div class="label">Renders: ${escapeHtml(status)}</div><div class="value">${fmtNum(n)}</div></div>`)
    .join("");
  el.innerHTML = `
    <div class="panel">
      <h2>Overview</h2>
      <div class="stat-grid">
        <div class="stat-tile"><div class="label">Users</div><div class="value">${fmtNum(data.userCount)}</div></div>
        <div class="stat-tile"><div class="label">Projects</div><div class="value">${fmtNum(data.projectCount)}</div></div>
        <div class="stat-tile"><div class="label">Tokens spent (30d)</div><div class="value">${fmtNum(data.tokensSpentLast30d)}</div></div>
        ${renderTiles}
      </div>
    </div>
  `;
}

// ---------- Users ----------

async function renderUsers(el) {
  const s = state.users;
  el.innerHTML = `
    <div class="panel">
      <h2>Users</h2>
      <div class="toolbar">
        <input id="user-search" placeholder="Search name or email" value="${escapeHtml(s.search)}" />
        <div class="spacer"></div>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Tokens</th><th>Admin</th><th>Joined</th><th></th></tr></thead>
        <tbody id="users-body"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
      </table>
      <div id="users-pager"></div>
    </div>
  `;
  document.getElementById("user-search").addEventListener("input", debounce((e) => {
    s.search = e.target.value;
    s.page = 1;
    loadUsers();
  }, 350));

  await loadUsers();

  async function loadUsers() {
    const data = await api("/users" + qs({ search: s.search, page: s.page, pageSize: s.pageSize }));
    const body = document.getElementById("users-body");
    if (!data.items.length) {
      body.innerHTML = `<tr><td colspan="6" class="empty">No users found</td></tr>`;
    } else {
      body.innerHTML = data.items.map((u) => `
        <tr data-id="${u.id}">
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${fmtNum(u.tokens)}</td>
          <td>${u.isAdmin ? '<span class="pill ok">admin</span>' : '<span class="pill neutral">user</span>'}</td>
          <td>${fmtDate(u.createdAt)}</td>
          <td>
            <div class="row-actions">
              <button class="secondary" data-act="grant">Grant tokens</button>
              <button class="secondary" data-act="toggle-admin">${u.isAdmin ? "Revoke admin" : "Make admin"}</button>
            </div>
          </td>
        </tr>
      `).join("");
      body.querySelectorAll('button[data-act="grant"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = btn.closest("tr");
          const id = row.dataset.id;
          openModal("Grant / deduct tokens", `
            <div class="field"><label>Amount (use negative to deduct)</label><input id="grant-amount" type="number" value="0" /></div>
            <div class="field"><label>Description</label><input id="grant-desc" value="Admin grant" /></div>
          `, {
            submitLabel: "Apply",
            onSubmit: async (modal, close) => {
              const amount = Number(modal.querySelector("#grant-amount").value);
              const description = modal.querySelector("#grant-desc").value.trim() || "Admin grant";
              if (!amount) { toast("Amount must be non-zero", "error"); return; }
              await api(`/users/${id}/grant-tokens`, { method: "POST", body: JSON.stringify({ amount, description }) });
              toast("Tokens updated");
              close();
              loadUsers();
            },
          });
        });
      });
      body.querySelectorAll('button[data-act="toggle-admin"]').forEach((btn) => {
        btn.addEventListener("click", async () => {
          const row = btn.closest("tr");
          const id = row.dataset.id;
          const makingAdmin = btn.textContent.includes("Make");
          if (!confirm(`${makingAdmin ? "Grant" : "Revoke"} admin access for this user?`)) return;
          await api(`/users/${id}/toggle-admin`, { method: "POST", body: JSON.stringify({ isAdmin: makingAdmin }) });
          toast("Updated");
          loadUsers();
        });
      });
    }
    const pagerEl = document.getElementById("users-pager");
    pagerEl.innerHTML = "";
    pagerEl.appendChild(pager(s, data.total, loadUsers));
  }
}

// ---------- Transactions ----------

async function renderTransactions(el) {
  const s = state.transactions;
  el.innerHTML = `
    <div class="panel">
      <h2>Token transactions</h2>
      <div class="toolbar">
        <input id="tx-user" placeholder="Filter by userId" value="${escapeHtml(s.userId)}" />
        <select id="tx-type">
          <option value="">All types</option>
          ${["signup_bonus","purchase","script_generation","voice_generation","image_generation","render","refund","admin_grant"]
            .map((t) => `<option value="${t}" ${s.type === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>
        <div class="spacer"></div>
      </div>
      <table>
        <thead><tr><th>Date</th><th>User</th><th>Type</th><th>Amount</th><th>Description</th></tr></thead>
        <tbody id="tx-body"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody>
      </table>
      <div id="tx-pager"></div>
    </div>
  `;
  document.getElementById("tx-user").addEventListener("input", debounce((e) => { s.userId = e.target.value.trim(); s.page = 1; load(); }, 350));
  document.getElementById("tx-type").addEventListener("change", (e) => { s.type = e.target.value; s.page = 1; load(); });

  await load();

  async function load() {
    const data = await api("/transactions" + qs({ userId: s.userId, type: s.type, page: s.page, pageSize: s.pageSize }));
    const body = document.getElementById("tx-body");
    if (!data.items.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty">No transactions</td></tr>`;
    } else {
      body.innerHTML = data.items.map((t) => `
        <tr>
          <td>${fmtDate(t.createdAt)}</td>
          <td>${escapeHtml(t.userName || t.userId)}<br/><code class="mono">${escapeHtml(t.userEmail || "")}</code></td>
          <td>${escapeHtml(t.type)}</td>
          <td style="color:${t.amount < 0 ? "var(--danger)" : "var(--accent-2)"}">${t.amount > 0 ? "+" : ""}${fmtNum(t.amount)}</td>
          <td>${escapeHtml(t.description)}</td>
        </tr>
      `).join("");
    }
    const pagerEl = document.getElementById("tx-pager");
    pagerEl.innerHTML = "";
    pagerEl.appendChild(pager(s, data.total, load));
  }
}

// ---------- Token costs ----------

async function renderCosts(el) {
  el.innerHTML = `
    <div class="panel">
      <h2>Token costs</h2>
      <table>
        <thead><tr><th>Action</th><th>Cost</th><th>Description</th><th>Active</th><th></th></tr></thead>
        <tbody id="costs-body"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody>
      </table>
    </div>
  `;
  await load();

  async function load() {
    const rows = await api("/token-costs");
    const body = document.getElementById("costs-body");
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty">No cost rows yet</td></tr>`;
    } else {
      body.innerHTML = rows.map((r) => `
        <tr data-action="${escapeHtml(r.action)}">
          <td>${escapeHtml(r.action)}</td>
          <td>${fmtNum(r.cost)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td>${r.isActive ? '<span class="pill ok">active</span>' : '<span class="pill neutral">inactive</span>'}</td>
          <td><button class="secondary" data-act="edit">Edit</button></td>
        </tr>
      `).join("");
      body.querySelectorAll('button[data-act="edit"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = btn.closest("tr");
          const action = row.dataset.action;
          const cells = row.querySelectorAll("td");
          const cost = cells[1].textContent.replace(/,/g, "");
          const description = cells[2].textContent;
          const isActive = cells[3].textContent.trim() === "active";
          openModal(`Edit cost: ${action}`, `
            <div class="field"><label>Cost (tokens)</label><input id="cost-value" type="number" min="0" value="${escapeHtml(cost)}" /></div>
            <div class="field"><label>Description</label><input id="cost-desc" value="${escapeHtml(description)}" /></div>
            <div class="checkbox-field"><input id="cost-active" type="checkbox" ${isActive ? "checked" : ""} /><label for="cost-active">Active</label></div>
          `, {
            onSubmit: async (modal, close) => {
              const body = {
                cost: Number(modal.querySelector("#cost-value").value),
                description: modal.querySelector("#cost-desc").value.trim(),
                isActive: modal.querySelector("#cost-active").checked,
              };
              await api(`/token-costs/${encodeURIComponent(action)}`, { method: "PUT", body: JSON.stringify(body) });
              toast("Cost updated");
              close();
              load();
            },
          });
        });
      });
    }
  }
}

// ---------- Settings ----------

async function renderSettings(el) {
  const data = await api("/settings");
  el.innerHTML = `
    <div class="panel">
      <h2>System settings</h2>
      <div class="field"><label>Default signup bonus</label><input id="s-signup-bonus" type="number" value="${data.defaultSignupBonus}" /></div>
      <div class="field"><label>Minimum token balance</label><input id="s-min-balance" type="number" value="${data.minimumTokenBalance}" /></div>
      <div class="field"><label>Max tokens per user</label><input id="s-max-tokens" type="number" value="${data.maxTokensPerUser}" /></div>
      <div class="field"><label>Token expiration (days, 0 = never)</label><input id="s-expiration" type="number" value="${data.tokenExpirationDays}" /></div>
      <div class="checkbox-field"><input id="s-enable-tokens" type="checkbox" ${data.enableTokenSystem ? "checked" : ""} /><label for="s-enable-tokens">Enable token system</label></div>
      <div class="checkbox-field"><input id="s-enable-bonus" type="checkbox" ${data.enableSignupBonus ? "checked" : ""} /><label for="s-enable-bonus">Enable signup bonus</label></div>
      <button id="save-settings">Save settings</button>
    </div>
  `;
  document.getElementById("save-settings").addEventListener("click", async () => {
    const body = {
      defaultSignupBonus: Number(document.getElementById("s-signup-bonus").value),
      minimumTokenBalance: Number(document.getElementById("s-min-balance").value),
      maxTokensPerUser: Number(document.getElementById("s-max-tokens").value),
      tokenExpirationDays: Number(document.getElementById("s-expiration").value),
      enableTokenSystem: document.getElementById("s-enable-tokens").checked,
      enableSignupBonus: document.getElementById("s-enable-bonus").checked,
    };
    try {
      await api("/settings", { method: "PUT", body: JSON.stringify(body) });
      toast("Settings saved");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ---------- Render jobs ----------

async function renderRenderJobs(el) {
  const s = state.renderJobs;
  el.innerHTML = `
    <div class="panel">
      <h2>Render jobs</h2>
      <div class="toolbar">
        <select id="rj-status">
          <option value="">All statuses</option>
          ${["queued","rendering","completed","failed"].map((v) => `<option value="${v}" ${s.status === v ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <div class="spacer"></div>
      </div>
      <table>
        <thead><tr><th>Created</th><th>User</th><th>Resolution</th><th>Status</th><th>Progress</th><th>Video</th></tr></thead>
        <tbody id="rj-body"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
      </table>
      <div id="rj-pager"></div>
    </div>
  `;
  document.getElementById("rj-status").addEventListener("change", (e) => { s.status = e.target.value; s.page = 1; load(); });
  await load();

  async function load() {
    const data = await api("/render-jobs" + qs({ status: s.status, page: s.page, pageSize: s.pageSize }));
    const body = document.getElementById("rj-body");
    if (!data.items.length) {
      body.innerHTML = `<tr><td colspan="6" class="empty">No render jobs</td></tr>`;
    } else {
      body.innerHTML = data.items.map((j) => `
        <tr>
          <td>${fmtDate(j.createdAt)}</td>
          <td>${escapeHtml(j.userEmail || j.userId)}</td>
          <td>${escapeHtml(j.resolution)}</td>
          <td>${pillFor(j.status)}</td>
          <td>${fmtNum(j.progress)}%</td>
          <td>${j.videoUrl ? `<a href="${escapeHtml(j.videoUrl)}" target="_blank" rel="noopener">link</a>` : "—"}</td>
        </tr>
      `).join("");
    }
    const pagerEl = document.getElementById("rj-pager");
    pagerEl.innerHTML = "";
    pagerEl.appendChild(pager(s, data.total, load));
  }
}

// ---------- Templates ----------

function templateFormHtml(t = {}) {
  return `
    <div class="field"><label>Vertical</label><input id="t-vertical" value="${escapeHtml(t.vertical || "")}" /></div>
    <div class="field"><label>Name</label><input id="t-name" value="${escapeHtml(t.name || "")}" /></div>
    <div class="field"><label>Preview video URL</label><input id="t-preview" value="${escapeHtml(t.previewVideoUrl || "")}" /></div>
    <div class="field"><label>Script prompt preset</label><textarea id="t-script-preset">${escapeHtml(t.scriptPromptPreset || "")}</textarea></div>
    <div class="field"><label>Image style preset</label><textarea id="t-image-preset">${escapeHtml(t.imageStylePreset || "")}</textarea></div>
    <div class="field"><label>Music track URL</label><input id="t-music" value="${escapeHtml(t.musicTrackUrl || "")}" /></div>
    <div class="field"><label>Default duration (sec)</label><input id="t-duration" type="number" value="${t.defaultDuration ?? 45}" /></div>
    <div class="checkbox-field"><input id="t-active" type="checkbox" ${t.isActive !== false ? "checked" : ""} /><label for="t-active">Active</label></div>
  `;
}
function readTemplateForm(modal) {
  return {
    vertical: modal.querySelector("#t-vertical").value.trim(),
    name: modal.querySelector("#t-name").value.trim(),
    previewVideoUrl: modal.querySelector("#t-preview").value.trim() || null,
    scriptPromptPreset: modal.querySelector("#t-script-preset").value.trim(),
    imageStylePreset: modal.querySelector("#t-image-preset").value.trim(),
    musicTrackUrl: modal.querySelector("#t-music").value.trim() || null,
    defaultDuration: Number(modal.querySelector("#t-duration").value) || 45,
    isActive: modal.querySelector("#t-active").checked,
  };
}

async function renderTemplates(el) {
  el.innerHTML = `
    <div class="panel">
      <h2>Templates</h2>
      <div class="toolbar">
        <div class="spacer"></div>
        <button id="new-template">New template</button>
      </div>
      <table>
        <thead><tr><th>Vertical</th><th>Name</th><th>Duration</th><th>Active</th><th></th></tr></thead>
        <tbody id="tpl-body"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody>
      </table>
    </div>
  `;
  document.getElementById("new-template").addEventListener("click", () => {
    openModal("New template", templateFormHtml(), {
      submitLabel: "Create",
      onSubmit: async (modal, close) => {
        await api("/templates", { method: "POST", body: JSON.stringify(readTemplateForm(modal)) });
        toast("Template created");
        close();
        load();
      },
    });
  });

  await load();

  async function load() {
    const rows = await api("/templates");
    const body = document.getElementById("tpl-body");
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty">No templates yet</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((t) => `
      <tr data-id="${t.id}">
        <td>${escapeHtml(t.vertical)}</td>
        <td>${escapeHtml(t.name)}</td>
        <td>${fmtNum(t.defaultDuration)}s</td>
        <td>${t.isActive ? '<span class="pill ok">active</span>' : '<span class="pill neutral">inactive</span>'}</td>
        <td>
          <div class="row-actions">
            <button class="secondary" data-act="edit">Edit</button>
            <button class="danger" data-act="delete">Delete</button>
          </div>
        </td>
      </tr>
    `).join("");
    body.querySelectorAll('button[data-act="edit"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("tr").dataset.id;
        const t = await api(`/templates/${id}`);
        openModal(`Edit template: ${t.name}`, templateFormHtml(t), {
          onSubmit: async (modal, close) => {
            await api(`/templates/${id}`, { method: "PUT", body: JSON.stringify(readTemplateForm(modal)) });
            toast("Template updated");
            close();
            load();
          },
        });
      });
    });
    body.querySelectorAll('button[data-act="delete"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("tr").dataset.id;
        if (!confirm("Delete this template?")) return;
        await api(`/templates/${id}`, { method: "DELETE" });
        toast("Template deleted");
        load();
      });
    });
  }
}

// ---------- misc ----------

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- boot ----------

(async function boot() {
  wireLogin();
  wireShell();
  await loadConfig();
  if (state.token) {
    try {
      await api("/stats");
      enterApp();
      return;
    } catch {
      state.token = "";
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  document.getElementById("login-view").style.display = "flex";
})();
