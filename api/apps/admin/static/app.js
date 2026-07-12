// Admin dashboard — vanilla JS, no build step.
const API_BASE = "/api/admin";
const TOKEN_KEY = "admin_bearer_token";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  tab: "stats",
  authApiUrl: "",
  adminUser: null,
  // per-tab paging/filter state
  users: { page: 1, pageSize: 20, search: "" },
  transactions: { page: 1, pageSize: 20, userId: "", type: "" },
  renderJobs: { page: 1, pageSize: 20, status: "" },
  characterReview: { page: 1, pageSize: 25, selectedId: null, objectUrl: null },
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
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- auth / login ----------

function logout() {
  if (state.characterReview.objectUrl) { URL.revokeObjectURL(state.characterReview.objectUrl); state.characterReview.objectUrl = null; }
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
  el.innerHTML = msg ? `<div class="error-box" role="alert">${escapeHtml(msg)}</div>` : "";
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
    state.adminUser = await api("/me");
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
  document.getElementById("who-label").textContent = state.adminUser?.email || "";
  renderTab();
}

// ---------- shell ----------

function wireShell() {
  const menu = document.getElementById("mobile-menu");
  const tabs = document.getElementById("tabs");
  const scrim = document.getElementById("nav-scrim");
  const closeMobileNav = () => { tabs.classList.remove("open"); scrim.hidden = true; menu.setAttribute("aria-expanded", "false"); };
  document.getElementById("logout-btn").addEventListener("click", logout);
  document.querySelectorAll("#tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
	  if (state.characterReview.objectUrl) { URL.revokeObjectURL(state.characterReview.objectUrl); state.characterReview.objectUrl = null; }
      document.querySelectorAll("#tabs button").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll("#tabs button").forEach((b) => b.removeAttribute("aria-current"));
      btn.classList.add("active");
      btn.setAttribute("aria-current", "page");
      state.tab = btn.dataset.tab;
      closeMobileNav();
      renderTab();
    });
  });
  menu.addEventListener("click", () => { const open = !tabs.classList.contains("open"); tabs.classList.toggle("open", open); scrim.hidden = !open; menu.setAttribute("aria-expanded", String(open)); if (open) tabs.querySelector("button.active")?.focus(); });
  scrim.addEventListener("click", closeMobileNav);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && tabs.classList.contains("open")) { closeMobileNav(); menu.focus(); } });
  tabs.querySelector("button.active")?.setAttribute("aria-current", "page");
}

function main() {
  return document.getElementById("main");
}

async function renderTab() {
  const el = main();
  el.innerHTML = `<div class="empty" role="status" aria-live="polite">Loading…</div>`;
  try {
    switch (state.tab) {
      case "stats": return await renderStats(el);
      case "users": return await renderUsers(el);
      case "transactions": return await renderTransactions(el);
      case "costs": return await renderCosts(el);
      case "settings": return await renderSettings(el);
      case "render-jobs": return await renderRenderJobs(el);
      case "templates": return await renderCatalogTemplates(el);
      case "categories": return await renderCategories(el);
      case "providers": return await renderProviders(el);
      case "pricing": return await renderPricing(el);
      case "voices": return await renderVoices(el);
      case "characters": return await renderCharacters(el);
      case "character-review": return await renderCharacterReview(el);
      case "generation-jobs": return await renderGenerationJobs(el);
      case "audit": return await renderAudit(el);
      default: return;
    }
  } catch (err) {
    el.innerHTML = `<div class="panel"><div class="error-box" role="alert">${escapeHtml(err.message)}</div></div>`;
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
  const map = { completed: "ok", ready: "ok", active: "ok", published: "ok", verified: "ok", rendering: "warn", queued: "neutral", pending: "neutral", draft: "neutral", archived: "neutral", failed: "danger", revoked: "danger", generating: "warn" };
  const cls = map[status] || "neutral";
  return `<span class="pill ${cls}">${escapeHtml(status)}</span>`;
}

function pageHead(title, description, action = "") {
  return `<div class="page-head"><div><span class="env-badge">PRODUCTION CONTROL PLANE</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${action}</div>`;
}

function canUi(permission) {
  return Boolean(state.adminUser?.isSuperAdmin || state.adminUser?.permissions?.includes("*") || state.adminUser?.permissions?.includes(permission));
}

function tableWrap(headers, rows, emptyText) {
  return `<div class="panel"><div class="table-scroll"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="empty">${escapeHtml(emptyText)}</td></tr>`}</tbody></table></div></div>`;
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

function openModal(title, bodyHtml, { onSubmit, submitLabel = "Save", destructive = false } = {}) {
  const returnFocus = document.activeElement;
  const titleId = `dialog-title-${crypto.randomUUID()}`;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
      <h3 id="${titleId}">${escapeHtml(title)}</h3>
      <div class="error-box" role="alert" data-modal-error hidden></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions">
        <button class="secondary" type="button" data-act="cancel">Cancel</button>
        <button type="button" ${destructive ? 'class="danger"' : ""} data-act="submit">${escapeHtml(submitLabel)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  let sequence = 0;
  backdrop.querySelectorAll(".field").forEach((field) => { const label = field.querySelector("label"); const control = field.querySelector("input,select,textarea"); if (label && control) { if (!control.id) control.id = `dialog-field-${sequence++}-${crypto.randomUUID()}`; label.htmlFor = control.id; } });
  backdrop.querySelectorAll('[data-field="reason"], textarea[id$="reason"]').forEach((control) => control.required = true);
  const focusable = () => [...backdrop.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
  const snapshot = () => [...backdrop.querySelectorAll("input,select,textarea")].map((control) => control.type === "checkbox" ? String(control.checked) : control.value).join("|");
  const initial = snapshot();
  let discardArmed = false;
  const close = (force = false) => { if (!force && snapshot() !== initial && !discardArmed) { discardArmed = true; toast("Unsaved changes remain. Press Cancel or Escape again to discard them.", "error"); return; } document.removeEventListener("keydown", onKey); backdrop.remove(); if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus(); };
  const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); close(); return; } if (event.key !== "Tab") return; const items = focusable(); if (!items.length) return; const first = items[0], last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } };
  document.addEventListener("keydown", onKey);
  backdrop.querySelectorAll("input,select,textarea").forEach((control) => control.addEventListener("input", () => control.removeAttribute("aria-invalid")));
  backdrop.querySelector('[data-act="cancel"]').addEventListener("click", () => close());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-act="submit"]').addEventListener("click", async () => {
    const required = [...backdrop.querySelectorAll("[required]")].filter((control) => !control.value.trim());
    const errorBox = backdrop.querySelector("[data-modal-error]");
    if (required.length) { required.forEach((control) => control.setAttribute("aria-invalid", "true")); errorBox.textContent = "Complete all required fields before continuing."; errorBox.hidden = false; required[0].focus(); return; }
    const submit = backdrop.querySelector('[data-act="submit"]'); submit.disabled = true; submit.setAttribute("aria-busy", "true"); errorBox.hidden = true;
    try {
      await onSubmit?.(backdrop, () => close(true));
    } catch (err) {
      errorBox.textContent = err.message || "Action failed"; errorBox.hidden = false;
      toast(err.message || "Action failed", "error");
    } finally {
      if (submit.isConnected) { submit.disabled = false; submit.removeAttribute("aria-busy"); }
    }
  });
  (backdrop.querySelector("input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button") || backdrop.querySelector(".modal"))?.focus();
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
    ${pageHead("Overview", "Platform activity and generation health from the current control-plane data.")}
    <div class="toolbar"><span class="pill neutral">Fresh ${escapeHtml(new Date().toLocaleTimeString())}</span></div>
    <div class="panel">
      <h2>Legacy activity and render queue</h2>
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
            <div class="security-note">Target user: <code class="mono">${escapeHtml(id)}</code>. This changes the spendable balance and writes an audit event.</div>
            <div class="field"><label>Amount (use negative to deduct)</label><input id="grant-amount" type="number" value="0" /></div>
            <div class="field"><label>Description</label><input id="grant-desc" value="Admin grant" /></div>
            <div class="field"><label>Required change reason</label><textarea id="grant-reason"></textarea></div>
          `, {
            submitLabel: "Apply",
            onSubmit: async (modal, close) => {
              const amount = Number(modal.querySelector("#grant-amount").value);
              const description = modal.querySelector("#grant-desc").value.trim() || "Admin grant";
              if (!amount) { toast("Amount must be non-zero", "error"); return; }
              await api(`/users/${id}/grant-tokens`, { method: "POST", body: JSON.stringify({ amount, description, reason: modal.querySelector("#grant-reason").value }) });
              toast("Tokens updated");
              close();
              loadUsers();
            },
          });
        });
      });
      body.querySelectorAll('button[data-act="toggle-admin"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = btn.closest("tr");
          const id = row.dataset.id;
          const makingAdmin = btn.textContent.includes("Make");
          openModal(`${makingAdmin ? "Grant" : "Revoke"} super-admin access`, `<div class="security-note">Target: <code class="mono">${escapeHtml(id)}</code>. ${makingAdmin ? "This grants unrestricted control-plane access." : "This removes the temporary super-admin fallback; assigned roles remain."}</div><div class="field"><label>Required change reason</label><textarea data-field="reason"></textarea></div>`, { destructive: true, submitLabel: makingAdmin ? "Grant super-admin" : "Revoke super-admin", onSubmit: async (modal, close) => { await api(`/users/${id}/toggle-admin`, { method: "POST", body: JSON.stringify({ isAdmin: makingAdmin, reason: modalValue(modal,"reason") }) }); close(); toast("Admin access updated"); loadUsers(); } });
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
            <div class="field"><label>Required change reason</label><textarea id="cost-reason"></textarea></div>
          `, {
            onSubmit: async (modal, close) => {
              const body = {
                cost: Number(modal.querySelector("#cost-value").value),
                description: modal.querySelector("#cost-desc").value.trim(),
                isActive: modal.querySelector("#cost-active").checked,
                reason: modal.querySelector("#cost-reason").value,
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
    openModal("Confirm system settings", `<div class="security-note">These values affect token policy for the whole application.</div><div class="field"><label>Required change reason</label><textarea data-field="reason"></textarea></div>`, { submitLabel: "Apply system settings", onSubmit: async (modal, close) => { await api("/settings", { method: "PUT", body: JSON.stringify({ ...body, reason: modalValue(modal,"reason") }) }); close(); toast("Settings saved"); } });
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
        toast("Legacy template deletion is disabled. Archive the versioned template instead.", "error"); return;
        await api(`/templates/${id}`, { method: "DELETE" });
        toast("Template deleted");
        load();
      });
    });
  }
}

// ---------- Control plane ----------

async function renderCategoriesLegacy(el) {
  const rows = await api("/categories");
  el.innerHTML = pageHead("Categories", "Order and visibility for public template discovery.", '<button id="category-new">New category</button>') + tableWrap(["Order", "Category", "Slug", "Description", "State"], rows.map((r) => `<tr><td>${fmtNum(r.sortOrder)}</td><td><strong>${escapeHtml(r.name)}</strong><br><code class="mono">${escapeHtml(r.id)}</code></td><td><code class="mono">${escapeHtml(r.slug)}</code></td><td>${escapeHtml(r.description || "—")}</td><td>${pillFor(r.isActive ? "active" : "inactive")}</td></tr>`).join(""), "No categories yet");
  document.getElementById("category-new").addEventListener("click", () => openModal("Create category", `<div class="field"><label for="c-name">Name</label><input id="c-name"></div><div class="field"><label for="c-slug">Slug</label><input id="c-slug" placeholder="social-video"></div><div class="field"><label for="c-desc">Description</label><textarea id="c-desc"></textarea></div><div class="field"><label for="c-reason">Change reason</label><input id="c-reason" placeholder="Initial catalog setup"></div>`, { submitLabel: "Create draft", onSubmit: async (m, close) => { await api("/categories", { method: "POST", body: JSON.stringify({ name: m.querySelector("#c-name").value, slug: m.querySelector("#c-slug").value, description: m.querySelector("#c-desc").value || null, sortOrder: 0, isActive: true, reason: m.querySelector("#c-reason").value }) }); close(); toast("Category created"); renderCategories(el); } }));
}

async function renderCatalogTemplatesLegacy(el) {
  const rows = await api("/templates");
  const body = rows.map((t) => { const current = t.versions.find((v) => v.id === t.currentVersionId); const latest = [...t.versions].sort((a,b) => b.version-a.version)[0]; return `<tr><td><strong>${escapeHtml(t.name)}</strong><br><code class="mono">${escapeHtml(t.slug || t.id)}</code></td><td>${pillFor(t.lifecycleStatus)}</td><td>${current ? `v${current.version} · ${pillFor(current.status)}` : "No published version"}</td><td>${t.versions.length}</td><td><div class="row-actions">${latest ? `<button class="secondary" data-version="${latest.id}">Inspect v${latest.version}</button>` : ""}${latest?.status === "draft" ? `<button data-publish-template="${latest.id}">Publish v${latest.version}</button>` : ""}${t.lifecycleStatus !== "archived" ? `<button class="danger" data-archive="${t.id}">Archive</button>` : ""}</div></td></tr>`; }).join("");
  el.innerHTML = pageHead("Versioned templates", "Draft safely, bind published pricing and models, then publish immutable versions.") + `<div class="security-note">Published versions are immutable. Archive preserves generation history. Catalog cache invalidation uses a versioned KV marker.</div><br>` + tableWrap(["Template", "Lifecycle", "Current version", "Versions", "Actions"], body, "No templates available");
  el.querySelectorAll("[data-version]").forEach((b) => b.addEventListener("click", async () => { const data = await api(`/templates/versions/${b.dataset.version}`); openModal(`Version ${data.version.version}`, `<div class="field"><label>Immutable version ID</label><code class="mono">${escapeHtml(data.version.id)}</code></div><div class="field"><label>Pipeline</label><div>${escapeHtml(data.version.pipelineType)}</div></div><div class="field"><label>Inputs (${data.inputs.length})</label><pre><code class="mono">${escapeHtml(JSON.stringify(data.inputs, null, 2))}</code></pre></div><div class="field"><label>Bindings (${data.bindings.length})</label><pre><code class="mono">${escapeHtml(JSON.stringify(data.bindings, null, 2))}</code></pre></div>`, { submitLabel: "Close", onSubmit: async (_m, close) => close() }); }));
  el.querySelectorAll("[data-publish-template]").forEach((b) => b.addEventListener("click", () => openModal("Publish template version", `<div class="security-note">Validation requires a published pricing version, a published active model binding, and a valid restricted input schema. Publishing is immutable.</div><div class="field"><label for="template-publish-reason">Required reason</label><textarea id="template-publish-reason"></textarea></div>`, { submitLabel: "Publish immutable version", onSubmit: async (m, close) => { await api(`/templates/versions/${b.dataset.publishTemplate}/publish`, { method: "POST", body: JSON.stringify({ reason: m.querySelector("#template-publish-reason").value }) }); close(); toast("Template version published"); renderCatalogTemplates(el); } })));
  el.querySelectorAll("[data-archive]").forEach((b) => b.addEventListener("click", () => openModal("Archive template", `<div class="security-note">This removes the template from discovery without deleting published history.</div><div class="field"><label for="archive-reason">Required reason</label><textarea id="archive-reason"></textarea></div>`, { submitLabel: "Archive", onSubmit: async (m, close) => { await api(`/templates/${b.dataset.archive}/archive`, { method: "POST", body: JSON.stringify({ reason: m.querySelector("#archive-reason").value }) }); close(); toast("Template archived"); renderCatalogTemplates(el); } })));
}

async function renderProvidersLegacy(el) {
  const data = await api("/providers");
  const providerById = Object.fromEntries(data.providers.map((p) => [p.id, p])); const modelById = Object.fromEntries(data.models.map((m) => [m.id, m]));
  const rows = data.versions.map((v) => { const model = modelById[v.providerModelId]; const provider = model && providerById[model.providerId]; const pinned = provider?.providerKey === "replicate" && model?.modelKey === "prunaai/p-video"; return `<tr><td>${escapeHtml(provider?.name || "Unknown")}<br><code class="mono">${escapeHtml(provider?.providerKey || "")}</code></td><td><strong>${escapeHtml(model?.name || "Unknown")}</strong><br><code class="mono">${escapeHtml(model?.modelKey || "")}</code>${pinned ? '<br><span class="pill warn">PINNED TEST DEFAULT</span>' : ""}</td><td>v${v.version}<br><code class="mono">${escapeHtml(v.providerVersionRef)}</code></td><td>${pillFor(v.status)}</td><td>${escapeHtml(JSON.stringify(v.costConfig || {}))}</td></tr>`; }).join("");
  el.innerHTML = pageHead("Providers & models", "Public capability and cost metadata only. Credentials remain Worker secrets.") + `<div class="security-note">Default test path: <strong>Replicate · prunaai/p-video</strong>. API tokens are never stored in D1 or exposed here.</div><br>` + tableWrap(["Provider", "Model", "Version ref", "Status", "Cost metadata"], rows, "No model versions registered");
}

async function renderPricing(el) {
  const rows = await api("/pricing");
  el.innerHTML = pageHead("Pricing versions", "Published prices are immutable snapshots.", '<button id="price-new">New pricing draft</button>') + tableWrap(["Price key", "Version", "Credits", "Estimated cost", "Status", "Actions"], rows.map((r) => `<tr><td><code class="mono">${escapeHtml(r.priceKey)}</code></td><td>v${r.version}</td><td>${fmtNum(r.creditAmount)}</td><td>${fmtNum(r.estimatedCostMicros)} µUSD</td><td>${pillFor(r.status)}</td><td>${r.status === "draft" ? `<button data-publish-price="${r.id}">Publish</button>` : "—"}</td></tr>`).join(""), "No pricing versions");
  document.getElementById("price-new").addEventListener("click", () => openModal("New pricing draft", `<div class="field"><label for="p-key">Price key</label><input id="p-key" placeholder="p_video.draft.720p"></div><div class="field"><label for="p-credits">Credits</label><input id="p-credits" type="number" min="0"></div><div class="field"><label for="p-cost">Estimated provider cost (micro USD)</label><input id="p-cost" type="number" min="0"></div><div class="field"><label for="p-reason">Reason</label><input id="p-reason"></div>`, { submitLabel: "Create draft", onSubmit: async (m, close) => { await api("/pricing", { method: "POST", body: JSON.stringify({ priceKey: m.querySelector("#p-key").value, creditAmount: Number(m.querySelector("#p-credits").value), estimatedCostMicros: Number(m.querySelector("#p-cost").value), currency: "USD", reason: m.querySelector("#p-reason").value }) }); close(); toast("Pricing draft created"); renderPricing(el); } }));
  el.querySelectorAll("[data-publish-price]").forEach((b) => b.addEventListener("click", () => openModal("Publish pricing", `<div class="security-note">Published price history cannot be edited.</div><div class="field"><label for="publish-reason">Reason</label><textarea id="publish-reason"></textarea></div>`, { submitLabel: "Publish immutable version", onSubmit: async (m, close) => { await api(`/pricing/${b.dataset.publishPrice}/publish`, { method: "POST", body: JSON.stringify({ reason: m.querySelector("#publish-reason").value }) }); close(); toast("Pricing published"); renderPricing(el); } })));
}

async function renderVoicesLegacy(el) {
  const rows = await api("/voices");
  el.innerHTML = pageHead("Voice catalog", "Curated voices and Cloudflare-owned sample asset metadata.") + tableWrap(["Order", "Voice", "Locale", "Style", "Sample asset", "State"], rows.map((r) => `<tr><td>${r.sortOrder}</td><td><strong>${escapeHtml(r.name)}</strong><br><code class="mono">${escapeHtml(r.slug)}</code></td><td>${escapeHtml(r.locale)}</td><td>${escapeHtml(r.style || "—")}</td><td><code class="mono">${escapeHtml(r.sampleAssetKey || "—")}</code></td><td>${pillFor(r.isActive ? "active" : "inactive")} ${r.isPremium ? '<span class="pill warn">premium</span>' : ""}</td></tr>`).join(""), "No voices curated");
}

async function renderCharactersLegacy(el) {
  const rows = await api("/characters");
  el.innerHTML = pageHead("Stock characters", "Consent and license state gate catalog availability.") + tableWrap(["Character", "Preview asset", "Consent", "License expiry", "State"], rows.map((r) => `<tr><td><strong>${escapeHtml(r.name)}</strong><br><code class="mono">${escapeHtml(r.slug)}</code></td><td><code class="mono">${escapeHtml(r.previewAssetKey)}</code></td><td>${pillFor(r.consentStatus)}</td><td>${fmtDate(r.licenseExpiresAt)}</td><td>${pillFor(r.isActive ? "active" : "inactive")}</td></tr>`).join(""), "No stock characters");
}

async function renderGenerationJobs(el) {
  const data = await api("/generation-jobs?page=1&pageSize=50");
  el.innerHTML = pageHead("Generation operations", "Read-only paid-job inspection. Manual retry is intentionally unavailable.") + tableWrap(["Created", "Job", "User", "Template", "Status", "Credits / cost", "Actions"], data.items.map((j) => `<tr><td>${fmtDate(j.createdAt)}</td><td><code class="mono">${escapeHtml(j.id)}</code></td><td>${escapeHtml(j.userEmail || j.userId)}</td><td>${escapeHtml(j.templateName || j.templateId)}</td><td>${pillFor(j.status)}<br>${j.progress}%</td><td>${fmtNum(j.quotedCredits)} cr<br>${fmtNum(j.actualCostMicros)} µUSD</td><td><button class="secondary" data-job="${j.id}">Inspect timeline</button></td></tr>`).join(""), "No generation jobs");
  el.querySelectorAll("[data-job]").forEach((b) => b.addEventListener("click", async () => { const d = await api(`/generation-jobs/${b.dataset.job}`); openModal(`Generation ${d.job.id}`, `<div class="security-note">Read-only operational view · no unsafe paid retry</div><h4>Reservation</h4><pre><code class="mono">${escapeHtml(JSON.stringify(d.reservation, null, 2))}</code></pre><h4>Attempts</h4><pre><code class="mono">${escapeHtml(JSON.stringify(d.attempts, null, 2))}</code></pre><h4>Timeline</h4><pre><code class="mono">${escapeHtml(JSON.stringify(d.events, null, 2))}</code></pre><h4>Assets</h4><pre><code class="mono">${escapeHtml(JSON.stringify(d.assets, null, 2))}</code></pre>`, { submitLabel: "Close", onSubmit: async (_m, close) => close() }); }));
}

async function renderAudit(el) {
  const rows = await api("/audit?limit=100");
  el.innerHTML = pageHead("Audit log", "Immutable history for privileged control-plane mutations.") + tableWrap(["Time", "Actor", "Action", "Target", "Reason", "Request"], rows.map((r) => `<tr><td>${fmtDate(r.createdAt)}</td><td>${escapeHtml(r.actorEmail || r.actorUserId || "system")}</td><td><code class="mono">${escapeHtml(r.action)}</code></td><td>${escapeHtml(r.targetType)}<br><code class="mono">${escapeHtml(r.targetId || "—")}</code></td><td>${escapeHtml(r.reason || "—")}</td><td><code class="mono">${escapeHtml(r.requestId)}</code></td></tr>`).join(""), "No privileged mutations recorded");
}

function modalValue(modal, name) { return modal.querySelector(`[data-field="${name}"]`)?.value?.trim() || ""; }
function modalChecked(modal, name) { return Boolean(modal.querySelector(`[data-field="${name}"]`)?.checked); }
function parsedJson(modal, name) { try { return JSON.parse(modalValue(modal, name)); } catch { throw new Error(`${name} must be valid JSON`); } }

async function renderCategories(el) {
  const rows = await api("/categories"); const mayWrite = canUi("catalog.write");
  el.innerHTML = pageHead("Categories", "Order and visibility for public template discovery.", mayWrite ? '<button id="category-new">New category</button>' : "") + tableWrap(["Order", "Category", "Slug", "Description", "State", "Actions"], rows.map((row) => `<tr><td>${row.sortOrder}</td><td><strong>${escapeHtml(row.name)}</strong><br><code class="mono">${escapeHtml(row.id)}</code></td><td><code class="mono">${escapeHtml(row.slug)}</code></td><td>${escapeHtml(row.description || "—")}</td><td>${pillFor(row.isActive ? "active" : "inactive")}</td><td>${mayWrite ? `<button class="secondary" data-edit-category="${row.id}">Edit</button>` : "—"}</td></tr>`).join(""), "No categories yet");
  const open = (row) => openModal(row ? `Edit ${row.name}` : "Create category", `<div class="field"><label>Name</label><input data-field="name" value="${escapeHtml(row?.name || "")}" required></div><div class="field"><label>Slug</label><input data-field="slug" value="${escapeHtml(row?.slug || "")}" required></div><div class="field"><label>Description</label><textarea data-field="description">${escapeHtml(row?.description || "")}</textarea></div><div class="field"><label>Sort order</label><input data-field="sortOrder" type="number" min="0" value="${row?.sortOrder ?? 0}"></div><div class="checkbox-field"><input data-field="isActive" id="category-active" type="checkbox" ${row?.isActive !== false ? "checked" : ""}><label for="category-active">Active in catalog</label></div><div class="field"><label>Required change reason</label><textarea data-field="reason" required></textarea></div>`, { submitLabel: row ? "Save category" : "Create category", onSubmit: async (m, close) => { const body = { name: modalValue(m,"name"), slug: modalValue(m,"slug"), description: modalValue(m,"description") || null, sortOrder: Number(modalValue(m,"sortOrder")), isActive: modalChecked(m,"isActive"), reason: modalValue(m,"reason") }; await api(row ? `/categories/${row.id}` : "/categories", { method: row ? "PUT" : "POST", body: JSON.stringify(body) }); close(); toast(row ? "Category updated" : "Category created"); renderCategories(el); } });
  document.getElementById("category-new")?.addEventListener("click", () => open(null)); el.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => open(rows.find((row) => row.id === button.dataset.editCategory))));
}

const P_VIDEO_DIGEST = "68b33d8ba1189a1a997abf2c09edc5bbb90d6cfa239befbf9c903bcfee7f9a59";
const DEFAULT_INPUT_SCHEMA = { version: 1, fields: [{ id: "input_prompt", key: "prompt", label: "Describe your video", helpText: "Include subject, setting, camera movement, lighting, and action.", required: true, order: 10, type: "long_text", minLength: 3, maxLength: 5000 }] };
const DEFAULT_PVIDEO_CONFIG = { provider: "replicate", model: "prunaai/p-video", modelVersion: P_VIDEO_DIGEST, mode: "test", defaults: { durationSec: 1, aspectRatio: "16:9", resolution: "720p", fps: 24, draft: true, promptUpsampling: true, includeGeneratedAudio: false } };

async function openTemplateDraft(template, refresh) {
  const [categories, pricing, registry] = await Promise.all([api("/categories"), api("/pricing"), api("/providers")]);
  const pinnedProvider = registry.providers.find((provider) => provider.providerKey === "replicate" && provider.isActive);
  const pinnedModel = registry.models.find((model) => model.providerId === pinnedProvider?.id && model.modelKey === "prunaai/p-video" && model.isActive);
  const pinnedVersion = registry.versions.find((version) => version.providerModelId === pinnedModel?.id && version.providerVersionRef === P_VIDEO_DIGEST && version.status === "published");
  const testPrice = pricing.find((price) => price.status === "published" && price.priceKey === "pvideo_test" && price.creditAmount === 5);
  if (!pinnedVersion || !testPrice) { toast("The published Replicate P-Video test model and 5-credit test price must be configured first.", "error"); return; }
  const publishedPrices = [testPrice]; let previous = null;
  if (template?.versions?.length) { const latest = [...template.versions].sort((a,b) => b.version-a.version)[0]; previous = await api(`/templates/versions/${latest.id}`); }
  const config = previous?.version?.configSnapshot || DEFAULT_PVIDEO_CONFIG; const inputSchema = config.inputSchema || DEFAULT_INPUT_SCHEMA; const capabilities = previous?.version?.capabilities || { durations: [1,5,10,20], aspectRatios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p"], supportsImage: true, supportsAudio: true };
  openModal(template ? `Create next draft for ${template.name}` : "New template draft", `${template ? "" : '<div class="field"><label>Template name</label><input data-field="name" required></div><div class="field"><label>Slug</label><input data-field="slug" placeholder="product-spotlight" required></div><div class="field"><label>Category</label><select data-field="categoryId"><option value="">None</option>'+categories.map((c)=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")+'</select></div>'}<div class="field"><label>Version display name</label><input data-field="displayName" value="${escapeHtml(previous?.version?.displayName || template?.name || "")}" required></div><div class="field"><label>Description</label><textarea data-field="description">${escapeHtml(previous?.version?.description || "")}</textarea></div><div class="field"><label>Published pricing binding</label><select data-field="pricingVersionId" required>${publishedPrices.map((p)=>`<option value="${p.id}" ${p.id === previous?.version?.pricingVersionId ? "selected" : ""}>${escapeHtml(p.priceKey)} · v${p.version} · ${p.creditAmount} credits</option>`).join("")}</select></div><div class="field"><label>Capabilities JSON</label><textarea data-field="capabilities" rows="6">${escapeHtml(JSON.stringify(capabilities,null,2))}</textarea></div><div class="field"><label>P-Video configuration JSON</label><textarea data-field="configSnapshot" rows="10">${escapeHtml(JSON.stringify(config,null,2))}</textarea></div><div class="field"><label>Restricted input schema JSON</label><textarea data-field="inputSchema" rows="10">${escapeHtml(JSON.stringify(inputSchema,null,2))}</textarea></div><div class="field"><label>Required change reason</label><textarea data-field="reason" required></textarea></div><div class="security-note">Provider binding is locked to Replicate · prunaai/p-video · ${P_VIDEO_DIGEST.slice(0,12)}… for the test path.</div>`, { submitLabel: "Create draft version", onSubmit: async (m, close) => { if (!pinnedVersion) throw new Error("Pinned published P-Video model version is missing from the registry"); const common = { displayName: modalValue(m,"displayName"), description: modalValue(m,"description") || null, previewAssetKey: null, pipelineType: "p_video", pricingVersionId: modalValue(m,"pricingVersionId"), capabilities: parsedJson(m,"capabilities"), configSnapshot: parsedJson(m,"configSnapshot"), inputSchema: parsedJson(m,"inputSchema"), providerBindings: [{ providerModelVersionId: pinnedVersion.id, priority: 0, rolloutPercent: 100, inputMapping: { prompt:"prompt",imageUrl:"image",audioUrl:"audio",lastFrameImageUrl:"last_frame_image",durationSec:"duration",aspectRatio:"aspect_ratio",resolution:"resolution",fps:"fps",draft:"draft",promptUpsampling:"prompt_upsampling",includeGeneratedAudio:"save_audio" }, isActive: true }], reason: modalValue(m,"reason") }; const body = template ? common : { ...common, name: modalValue(m,"name"), slug: modalValue(m,"slug"), categoryIds: modalValue(m,"categoryId") ? [modalValue(m,"categoryId")] : [] }; await api(template ? `/templates/${template.id}/versions` : "/templates", { method:"POST", body:JSON.stringify(body) }); close(); toast("Template draft created"); refresh(); } });
}

async function renderCatalogTemplates(el) {
  const rows = await api("/templates"); const canWrite = canUi("catalog.write"), canPublish = canUi("catalog.publish");
  const body = rows.map((template) => { const current = template.versions.find((version) => version.id === template.currentVersionId); const latest = [...template.versions].sort((a,b)=>b.version-a.version)[0]; return `<tr><td><strong>${escapeHtml(template.name)}</strong><br><code class="mono">${escapeHtml(template.slug || template.id)}</code></td><td>${pillFor(template.lifecycleStatus)}</td><td>${current ? `v${current.version} · ${pillFor(current.status)}` : "No published version"}</td><td>${template.versions.length}</td><td><div class="row-actions">${latest ? `<button class="secondary" data-version="${latest.id}">Inspect v${latest.version}</button>` : ""}${canWrite && template.lifecycleStatus !== "archived" ? `<button class="secondary" data-next-template="${template.id}">Create next draft</button>` : ""}${canPublish && latest?.status === "draft" ? `<button data-publish-template="${latest.id}">Publish v${latest.version}</button>` : ""}${canPublish && template.lifecycleStatus !== "archived" ? `<button class="danger" data-archive="${template.id}">Archive</button>` : ""}</div></td></tr>`; }).join("");
  el.innerHTML = pageHead("Versioned templates", "Draft safely, bind published pricing and models, then publish immutable versions.", canWrite ? '<button id="template-new">New template draft</button>' : "") + `<div class="security-note">Published versions are immutable. Archive preserves generation history.</div><br>` + tableWrap(["Template","Lifecycle","Current version","Versions","Actions"],body,"No templates available");
  document.getElementById("template-new")?.addEventListener("click",()=>openTemplateDraft(null,()=>renderCatalogTemplates(el))); el.querySelectorAll("[data-next-template]").forEach((button)=>button.addEventListener("click",()=>openTemplateDraft(rows.find((row)=>row.id===button.dataset.nextTemplate),()=>renderCatalogTemplates(el))));
  el.querySelectorAll("[data-version]").forEach((button)=>button.addEventListener("click",async()=>{const data=await api(`/templates/versions/${button.dataset.version}`);openModal(`Version ${data.version.version}`,`<div class="field"><label>Immutable version ID</label><code class="mono">${escapeHtml(data.version.id)}</code></div><pre><code class="mono">${escapeHtml(JSON.stringify(data,null,2))}</code></pre>`,{submitLabel:"Close",onSubmit:async(_m,close)=>close()});}));
  el.querySelectorAll("[data-publish-template]").forEach((button)=>button.addEventListener("click",()=>openModal("Publish template version",`<div class="security-note">This validates and freezes pricing, input, and pinned model configuration.</div><div class="field"><label>Required reason</label><textarea data-field="reason" required></textarea></div>`,{submitLabel:"Publish immutable version",onSubmit:async(m,close)=>{await api(`/templates/versions/${button.dataset.publishTemplate}/publish`,{method:"POST",body:JSON.stringify({reason:modalValue(m,"reason")})});close();toast("Template version published");renderCatalogTemplates(el);}})));
  el.querySelectorAll("[data-archive]").forEach((button)=>button.addEventListener("click",()=>openModal("Archive template",`<div class="security-note">This removes discovery access and preserves all history.</div><div class="field"><label>Required reason</label><textarea data-field="reason" required></textarea></div>`,{destructive:true,submitLabel:"Archive template",onSubmit:async(m,close)=>{await api(`/templates/${button.dataset.archive}/archive`,{method:"POST",body:JSON.stringify({reason:modalValue(m,"reason")})});close();toast("Template archived");renderCatalogTemplates(el);}})));
}

async function renderProviders(el) {
  const data = await api("/providers"); const mayWrite=canUi("providers.write"), mayPublish=canUi("providers.publish"); const providers=Object.fromEntries(data.providers.map((p)=>[p.id,p]));
  const providerRows=data.providers.map((p)=>`<tr><td><strong>${escapeHtml(p.name)}</strong><br><code class="mono">${escapeHtml(p.providerKey)}</code></td><td>${escapeHtml(p.kind)}</td><td>${pillFor(p.isActive?"active":"inactive")}</td><td>${mayWrite?`<div class="row-actions"><button class="secondary" data-add-model="${p.id}">Add model</button><button class="secondary" data-provider-status="${p.id}" data-next-active="${!p.isActive}">${p.isActive?"Disable":"Enable"}</button></div>`:"—"}</td></tr>`).join("");
  const modelRows=data.models.map((m)=>`<tr><td>${escapeHtml(providers[m.providerId]?.name||m.providerId)}</td><td><strong>${escapeHtml(m.name)}</strong><br><code class="mono">${escapeHtml(m.modelKey)}</code></td><td>${escapeHtml(m.modality)}</td><td>${pillFor(m.isActive?"active":"inactive")}</td><td>${mayWrite?`<div class="row-actions"><button class="secondary" data-add-model-version="${m.id}">Add version</button><button class="secondary" data-model-status="${m.id}" data-next-active="${!m.isActive}">${m.isActive?"Disable":"Enable"}</button></div>`:"—"}</td></tr>`).join("");
  const versionRows=data.versions.map((v)=>`<tr><td><code class="mono">${escapeHtml(data.models.find((m)=>m.id===v.providerModelId)?.modelKey||v.providerModelId)}</code></td><td>v${v.version}<br><code class="mono">${escapeHtml(v.providerVersionRef)}</code></td><td>${pillFor(v.status)}</td><td>${v.status==="draft"&&mayPublish?`<button data-publish-model-version="${v.id}">Publish</button>`:"—"}</td></tr>`).join("");
  el.innerHTML=pageHead("Providers & models","Public capability and cost metadata only. Credentials remain Worker secrets.",mayWrite?'<button id="provider-new">New provider</button>':"")+`<div class="security-note">Default test path: <strong>Replicate · prunaai/p-video</strong> pinned to ${P_VIDEO_DIGEST.slice(0,12)}…</div><br>`+tableWrap(["Provider","Kind","State","Actions"],providerRows,"No providers")+tableWrap(["Provider","Model","Modality","State","Actions"],modelRows,"No models")+tableWrap(["Model","Version ref","Status","Actions"],versionRows,"No versions");
  document.getElementById("provider-new")?.addEventListener("click",()=>openModal("Create provider",`<div class="field"><label>Name</label><input data-field="name" required></div><div class="field"><label>Provider key</label><input data-field="providerKey" required></div><div class="field"><label>Kind</label><select data-field="kind"><option>replicate</option><option>workers_ai</option><option>custom</option></select></div><div class="field"><label>Required reason</label><textarea data-field="reason"></textarea></div>`,{submitLabel:"Create provider",onSubmit:async(m,close)=>{await api("/providers",{method:"POST",body:JSON.stringify({name:modalValue(m,"name"),providerKey:modalValue(m,"providerKey"),kind:modalValue(m,"kind"),publicConfig:{},isActive:true,reason:modalValue(m,"reason")})});close();toast("Provider created");renderProviders(el);}}));
  el.querySelectorAll("[data-add-model]").forEach((button)=>button.addEventListener("click",()=>openModal("Add provider model",`<div class="field"><label>Name</label><input data-field="name"></div><div class="field"><label>Model key</label><input data-field="modelKey"></div><div class="field"><label>Modality</label><select data-field="modality"><option>video</option><option>image</option><option>audio</option><option>text</option><option>multimodal</option></select></div><div class="field"><label>Required reason</label><textarea data-field="reason"></textarea></div>`,{submitLabel:"Add model",onSubmit:async(m,close)=>{await api(`/providers/${button.dataset.addModel}/models`,{method:"POST",body:JSON.stringify({name:modalValue(m,"name"),modelKey:modalValue(m,"modelKey"),modality:modalValue(m,"modality"),isActive:true,reason:modalValue(m,"reason")})});close();toast("Model added");renderProviders(el);}})));
  el.querySelectorAll("[data-add-model-version]").forEach((button)=>button.addEventListener("click",()=>openModal("Add model version",`<div class="field"><label>Immutable provider version reference</label><input data-field="providerVersionRef" value="${escapeHtml(data.models.find((m)=>m.id===button.dataset.addModelVersion)?.modelKey==="prunaai/p-video"?P_VIDEO_DIGEST:"")}"></div><div class="field"><label>Capabilities JSON</label><textarea data-field="capabilities">{}</textarea></div><div class="field"><label>Cost metadata JSON</label><textarea data-field="costConfig">{}</textarea></div><div class="field"><label>Required reason</label><textarea data-field="reason"></textarea></div>`,{submitLabel:"Create version draft",onSubmit:async(m,close)=>{await api(`/providers/models/${button.dataset.addModelVersion}/versions`,{method:"POST",body:JSON.stringify({providerVersionRef:modalValue(m,"providerVersionRef"),capabilities:parsedJson(m,"capabilities"),costConfig:parsedJson(m,"costConfig"),reason:modalValue(m,"reason")})});close();toast("Model version draft created");renderProviders(el);}})));
  el.querySelectorAll("[data-publish-model-version]").forEach((button)=>button.addEventListener("click",()=>openModal("Publish model version",`<div class="security-note">The provider version reference becomes an immutable catalog dependency.</div><div class="field"><label>Required reason</label><textarea data-field="reason"></textarea></div>`,{submitLabel:"Publish version",onSubmit:async(m,close)=>{await api(`/providers/versions/${button.dataset.publishModelVersion}/publish`,{method:"POST",body:JSON.stringify({reason:modalValue(m,"reason")})});close();toast("Model version published");renderProviders(el);}})));
  const statusDialog=(button,type)=>openModal(`${button.dataset.nextActive==="true"?"Enable":"Disable"} ${type}`,`<div class="security-note">This changes routing availability for new generation requests.</div><div class="field"><label>Required reason</label><textarea data-field="reason"></textarea></div>`,{destructive:button.dataset.nextActive!=="true",submitLabel:button.dataset.nextActive==="true"?"Enable":"Disable",onSubmit:async(m,close)=>{const id=type==="provider"?button.dataset.providerStatus:button.dataset.modelStatus;await api(type==="provider"?`/providers/${id}/status`:`/providers/models/${id}/status`,{method:"PUT",body:JSON.stringify({isActive:button.dataset.nextActive==="true",reason:modalValue(m,"reason")})});close();toast(`${type} status updated`);renderProviders(el);}}); el.querySelectorAll("[data-provider-status]").forEach((button)=>button.addEventListener("click",()=>statusDialog(button,"provider")));el.querySelectorAll("[data-model-status]").forEach((button)=>button.addEventListener("click",()=>statusDialog(button,"model")));
}

async function renderVoices(el) {
  const rows=await api("/voices"),mayWrite=canUi("voices.write"); el.innerHTML=pageHead("Voice catalog","Curated voices and Cloudflare-owned sample asset metadata.",mayWrite?'<button id="voice-new">New voice</button>':"")+tableWrap(["Order","Voice","Locale","Style","Sample asset","State","Actions"],rows.map((r)=>`<tr><td>${r.sortOrder}</td><td><strong>${escapeHtml(r.name)}</strong><br><code class="mono">${escapeHtml(r.slug)}</code></td><td>${escapeHtml(r.locale)}</td><td>${escapeHtml(r.style||"—")}</td><td><code class="mono">${escapeHtml(r.sampleAssetKey||"—")}</code></td><td>${pillFor(r.isActive?"active":"inactive")}</td><td>${mayWrite?`<button class="secondary" data-edit-voice="${r.id}">Edit</button>`:"—"}</td></tr>`).join(""),"No voices curated");
  const open=(row)=>openModal(row?`Edit ${row.name}`:"Create voice",`<div class="field"><label>Name</label><input data-field="name" value="${escapeHtml(row?.name||"")}"></div>${row?"":'<div class="field"><label>Slug</label><input data-field="slug"></div>'}<div class="field"><label>Locale</label><input data-field="locale" value="${escapeHtml(row?.locale||"en-US")}"></div><div class="field"><label>Style</label><input data-field="style" value="${escapeHtml(row?.style||"")}"></div><div class="field"><label>Sample R2 asset key</label><input data-field="sampleAssetKey" value="${escapeHtml(row?.sampleAssetKey||"")}"></div><div class="field"><label>Sort order</label><input data-field="sortOrder" type="number" value="${row?.sortOrder??0}"></div><div class="checkbox-field"><input id="voice-active" data-field="isActive" type="checkbox" ${row?.isActive!==false?"checked":""}><label for="voice-active">Active</label></div><div class="field"><label>Required reason</label><textarea data-field="reason"></textarea></div>`,{submitLabel:row?"Save voice":"Create voice",onSubmit:async(m,close)=>{const body={name:modalValue(m,"name"),locale:modalValue(m,"locale"),style:modalValue(m,"style")||null,sampleAssetKey:modalValue(m,"sampleAssetKey")||null,tags:[],isPremium:row?.isPremium||false,isActive:modalChecked(m,"isActive"),sortOrder:Number(modalValue(m,"sortOrder")),reason:modalValue(m,"reason"),...(row?{}:{slug:modalValue(m,"slug")})};await api(row?`/voices/${row.id}`:"/voices",{method:row?"PUT":"POST",body:JSON.stringify(body)});close();toast(row?"Voice updated":"Voice created");renderVoices(el);}}); document.getElementById("voice-new")?.addEventListener("click",()=>open(null));el.querySelectorAll("[data-edit-voice]").forEach((button)=>button.addEventListener("click",()=>open(rows.find((row)=>row.id===button.dataset.editVoice))));
}

async function renderCharacters(el) {
  const rows=await api("/characters"),mayWrite=canUi("characters.write"); el.innerHTML=pageHead("Stock characters","Consent and license state gate catalog availability.",mayWrite?'<button id="character-new">New character</button>':"")+tableWrap(["Character","Preview asset","Consent","License expiry","State","Actions"],rows.map((r)=>`<tr><td><strong>${escapeHtml(r.name)}</strong><br><code class="mono">${escapeHtml(r.slug)}</code></td><td><code class="mono">${escapeHtml(r.previewAssetKey)}</code></td><td>${pillFor(r.consentStatus)}</td><td>${fmtDate(r.licenseExpiresAt)}</td><td>${pillFor(r.isActive?"active":"inactive")}</td><td>${mayWrite?`<button class="secondary" data-edit-character="${r.id}">Edit</button>`:"—"}</td></tr>`).join(""),"No stock characters");
  const open=(row)=>openModal(row?`Edit ${row.name}`:"Create stock character",`<div class="field"><label>Name</label><input data-field="name" value="${escapeHtml(row?.name||"")}"></div>${row?"":'<div class="field"><label>Slug</label><input data-field="slug"></div>'}<div class="field"><label>Preview R2 asset key</label><input data-field="previewAssetKey" value="${escapeHtml(row?.previewAssetKey||"")}"></div><div class="field"><label>Consent status</label><select data-field="consentStatus">${["verified","pending","revoked"].map((v)=>`<option ${v===row?.consentStatus?"selected":""}>${v}</option>`).join("")}</select></div><div class="field"><label>License expiry (Unix milliseconds, optional)</label><input data-field="licenseExpiresAt" type="number" value="${row?.licenseExpiresAt||""}"></div><div class="checkbox-field"><input id="character-active" data-field="isActive" type="checkbox" ${row?.isActive!==false?"checked":""}><label for="character-active">Active</label></div><div class="field"><label>Required reason</label><textarea data-field="reason"></textarea></div>`,{submitLabel:row?"Save character":"Create character",onSubmit:async(m,close)=>{const body={name:modalValue(m,"name"),previewAssetKey:modalValue(m,"previewAssetKey"),tags:[],consentStatus:modalValue(m,"consentStatus"),licenseExpiresAt:modalValue(m,"licenseExpiresAt")?Number(modalValue(m,"licenseExpiresAt")):null,isActive:modalChecked(m,"isActive"),reason:modalValue(m,"reason"),...(row?{}:{slug:modalValue(m,"slug")})};await api(row?`/characters/${row.id}`:"/characters",{method:row?"PUT":"POST",body:JSON.stringify(body)});close();toast(row?"Character updated":"Character created");renderCharacters(el);}}); document.getElementById("character-new")?.addEventListener("click",()=>open(null));el.querySelectorAll("[data-edit-character]").forEach((button)=>button.addEventListener("click",()=>open(rows.find((row)=>row.id===button.dataset.editCharacter))));
}

async function renderCharacterReview(el) {
  if (!canUi("characters.moderate")) {
    el.innerHTML = pageHead("User character review", "Private presenter moderation is restricted to authorized safety operators.") + '<div class="panel"><div class="error-box" role="alert">Permission required: characters.moderate</div></div>';
    return;
  }
  if (state.characterReview.objectUrl) { URL.revokeObjectURL(state.characterReview.objectUrl); state.characterReview.objectUrl = null; }
  const data = await api(`/characters/review${qs({ page: state.characterReview.page, pageSize: state.characterReview.pageSize })}`);
  if (!data.items.some((item) => item.versionId === state.characterReview.selectedId)) state.characterReview.selectedId = data.items[0]?.versionId ?? null;
  const selected = data.items.find((item) => item.versionId === state.characterReview.selectedId) ?? null;
  const rows = data.items.map((item) => `<tr aria-selected="${item.versionId === selected?.versionId}"><td><strong>${escapeHtml(item.name)}</strong><br><code class="mono">v${item.version}</code></td><td>${escapeHtml(item.userEmail || item.userId)}</td><td>${fmtDate(item.createdAt)}</td><td><button class="secondary" data-review-select="${item.versionId}" aria-label="Review ${escapeHtml(item.name)}">Review</button></td></tr>`).join("");
  const consent = selected?.consentRecord || {};
  const detail = selected ? `<section class="panel" aria-labelledby="review-detail-title">
      <h2 id="review-detail-title">Review ${escapeHtml(selected.name)}</h2>
      <div class="review-source" id="review-source"><div class="empty"><p>The source image is private and is loaded only on operator request.</p><button type="button" id="load-review-source">Load private source</button></div></div>
      <div class="security-note" style="margin:14px 0">Sensitive user media. Do not download, copy, or share it outside this review.</div>
      <dl class="review-meta">
        <dt>Owner</dt><dd>${escapeHtml(selected.userEmail || selected.userId)}</dd>
        <dt>Submitted</dt><dd>${fmtDate(selected.createdAt)}</dd>
        <dt>Consent confirmed</dt><dd>${consent.confirmed ? "Yes" : "No"}</dd>
        <dt>Consent statement</dt><dd>${escapeHtml(consent.statement || "No statement recorded")}</dd>
      </dl>
      <div class="review-actions"><button type="button" id="approve-review">Approve presenter</button><button type="button" class="danger" id="reject-review">Reject</button></div>
    </section>` : '<section class="panel"><div class="empty" role="status"><strong>Queue clear</strong><p>No user characters are awaiting moderation.</p></div></section>';
  el.innerHTML = pageHead("User character review", "Consent-aware moderation before a private presenter becomes available for generation.", `<span class="pill ${data.total ? "warn" : "ok"}">${fmtNum(data.total)} pending</span>`)
    + '<div class="security-note" style="margin-bottom:18px">Source images remain private in R2. Every decision requires a reason and writes an immutable operator audit event.</div>'
    + `<div class="review-layout"><section aria-labelledby="review-queue-title"><div class="panel"><h2 id="review-queue-title">Pending queue</h2><div class="table-scroll review-queue"><table><thead><tr><th>Presenter</th><th>Owner</th><th>Submitted</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">No pending reviews</td></tr>'}</tbody></table></div><div id="review-pager"></div></div></section>${detail}</div>`;
  const pagerEl = document.getElementById("review-pager");
  if (pagerEl && data.total > data.pageSize) pagerEl.appendChild(pager(state.characterReview, data.total, () => renderCharacterReview(el)));
  el.querySelectorAll("[data-review-select]").forEach((button) => button.addEventListener("click", () => { state.characterReview.selectedId = button.dataset.reviewSelect; renderCharacterReview(el); }));
  document.getElementById("load-review-source")?.addEventListener("click", async (event) => {
    const button = event.currentTarget; const source = document.getElementById("review-source"); button.disabled = true; button.textContent = "Loading private source…";
    try {
      const response = await fetch(`${API_BASE}/characters/review/${encodeURIComponent(selected.versionId)}/source`, { headers: { Authorization: `Bearer ${state.token}` }, cache: "no-store" });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body?.error?.message || "Private source could not be loaded"); }
      const blob = await response.blob(); state.characterReview.objectUrl = URL.createObjectURL(blob);
      source.innerHTML = `<img alt="Private source for ${escapeHtml(selected.name)}" src="${state.characterReview.objectUrl}">`;
    } catch (error) { button.disabled = false; button.textContent = "Retry private source"; toast(error.message || "Private source could not be loaded", "error"); }
  });
  const decide = (decision) => openModal(`${decision === "approve" ? "Approve" : "Reject"} ${selected.name}`, `<div class="security-note">${decision === "approve" ? "Approval verifies consent and the finalized private source, then makes this presenter ready for generation." : "Rejection keeps this presenter unavailable and records the reason for the owner."}</div><div class="field" style="margin-top:12px"><label>Decision reason</label><textarea data-field="reason" minlength="8" required placeholder="Record the safety and consent rationale"></textarea></div>`, { destructive: decision === "reject", submitLabel: decision === "approve" ? "Approve presenter" : "Reject presenter", onSubmit: async (modal, close) => { await api(`/characters/review/${selected.versionId}/decision`, { method: "POST", body: JSON.stringify({ decision, reason: modalValue(modal, "reason") }) }); close(); toast(decision === "approve" ? "Presenter approved and ready" : "Presenter rejected"); state.characterReview.selectedId = null; await renderCharacterReview(el); } });
  document.getElementById("approve-review")?.addEventListener("click", () => decide("approve"));
  document.getElementById("reject-review")?.addEventListener("click", () => decide("reject"));
}

// ---------- misc ----------

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function enhanceTables(root = document) {
  const tables = [...root.querySelectorAll("table")]; const own = root.closest?.("table"); if (own) tables.push(own);
  [...new Set(tables)].forEach((table) => {
    const labels = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim() || "Actions");
    table.querySelectorAll("tbody tr").forEach((row) => [...row.children].forEach((cell, index) => { if (!cell.dataset.label) cell.dataset.label = labels[index] || "Value"; }));
  });
}

// ---------- boot ----------

(async function boot() {
  new MutationObserver((mutations) => { for (const mutation of mutations) for (const node of mutation.addedNodes) if (node instanceof HTMLElement) enhanceTables(node.parentElement || node); }).observe(document.body, { childList: true, subtree: true });
  wireLogin();
  wireShell();
  await loadConfig();
  if (state.token) {
    try {
      state.adminUser = await api("/me");
      enterApp();
      return;
    } catch {
      state.token = "";
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  document.getElementById("login-view").style.display = "flex";
})();
