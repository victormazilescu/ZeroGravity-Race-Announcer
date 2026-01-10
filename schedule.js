const STORAGE_KEYS = {
  WEBHOOKS: "webhooks",
  SCHEDULED_JOBS: "scheduledJobs"
};

const cText = document.getElementById("cText");
const cH = document.getElementById("cH");
const cM = document.getElementById("cM");
const cS = document.getElementById("cS");
const cHook = document.getElementById("cHook");
const cAdd = document.getElementById("cAdd");

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const countEl = document.getElementById("count");

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function clampInt(v, min, max) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeWebhookEntries(raw) {
  const out = [];
  if (Array.isArray(raw)) {
    for (let i = 0; i < 5; i++) {
      const v = raw[i];
      if (typeof v === "string") out.push({ name: "", url: (v || "").trim() });
      else if (v && typeof v === "object") out.push({ name: (v.name || "").trim(), url: (v.url || "").trim() });
      else out.push({ name: "", url: "" });
    }
  } else {
    for (let i = 0; i < 5; i++) out.push({ name: "", url: "" });
  }
  return out;
}

function normalizeJobs(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((j) => j && typeof j === "object")
    .map((j) => ({
      id: String(j.id || ""),
      text: String(j.text || ""),
      webhookIndex: Number.isInteger(j.webhookIndex) ? j.webhookIndex : 0,
      kind: j.kind === "reminder" ? "reminder" : "scheduled",
      status: "scheduled",
      createdAt: Number.isFinite(j.createdAt) ? j.createdAt : 0,
      sendAt: Number.isFinite(j.sendAt) ? j.sendAt : 0
    }))
    .filter((j) => j.id && j.text && j.sendAt)
    .sort((a, b) => a.sendAt - b.sendAt);
}

async function getWebhooks() {
  const { webhooks } = await chrome.storage.sync.get([STORAGE_KEYS.WEBHOOKS]);
  return normalizeWebhookEntries(webhooks);
}

async function getJobs() {
  const { scheduledJobs } = await chrome.storage.sync.get([STORAGE_KEYS.SCHEDULED_JOBS]);
  return normalizeJobs(scheduledJobs);
}

async function setJobs(jobs) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SCHEDULED_JOBS]: jobs });
}

function hookLabel(h, i) {
  const base = h.name ? h.name : `Webhook ${i + 1}`;
  const mark = h.url ? " ✓" : "";
  return `${base}${mark}`;
}

function renderHookSelect(hooks) {
  cHook.innerHTML = hooks
    .map((h, i) => `<option value="${i}">${hookLabel(h, i)}</option>`)
    .join("");
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function itemTemplate(job, hooks) {
  const now = Math.floor(Date.now() / 1000);
  const remaining = Math.max(0, job.sendAt - now);

  const hookName = hookLabel(hooks[clampInt(job.webhookIndex, 0, 4)] || { name: "", url: "" }, clampInt(job.webhookIndex, 0, 4));
  const badge = job.kind === "reminder" ? "Auto (Reminder)" : "";

  return `
    <div class="item" data-id="${escapeHtml(job.id)}">
      <div>
        <div class="msg">${escapeHtml(job.text)}</div>
        <div class="badge">${badge ? `${badge} · ` : ""}${remaining}s remaining</div>
      </div>

      <div class="msg">${escapeHtml(String(remaining))}s</div>

      <div class="msg">${escapeHtml(hookName)}</div>

      <div style="display:flex; justify-content:flex-end;">
        <button class="secondary cancel">Cancel</button>
      </div>
    </div>
  `;
}

async function refresh() {
  const hooks = await getWebhooks();
  renderHookSelect(hooks);

  const jobs = await getJobs();
  countEl.textContent = `${jobs.length}/10`;

  cAdd.disabled = jobs.length >= 10;
  if (jobs.length >= 10) setStatus("Maximum of 10 scheduled items reached");

  if (jobs.length === 0) {
    listEl.innerHTML = "";
    return;
  }

  listEl.innerHTML = jobs.map((j) => itemTemplate(j, hooks)).join("");

  listEl.querySelectorAll(".cancel").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const item = e.target.closest(".item");
      const id = item.getAttribute("data-id");
      await chrome.runtime.sendMessage({ type: "CANCEL_JOB", id });
      setStatus("Canceled.");
      await refresh();
    });
  });
}

async function addFromCompiler() {
  const text = (cText.value || "").trim();
  const hh = clampInt(cH.value, 0, 999);
  const mm = clampInt(cM.value, 0, 59);
  const ss = clampInt(cS.value, 0, 59);
  const hookIndex = clampInt(cHook.value, 0, 4);

  const delaySeconds = hh * 3600 + mm * 60 + ss;

  if (!text) {
    setStatus("Message is empty.");
    return;
  }
  if (delaySeconds < 10) {
    setStatus("Delay must be at least 10 seconds.");
    return;
  }

  const jobs = await getJobs();
  if (jobs.length >= 10) {
    setStatus("Maximum of 10 scheduled items reached");
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const job = {
    id: uuid(),
    text,
    webhookIndex: hookIndex,
    kind: "scheduled",
    status: "scheduled",
    createdAt: nowSec,
    sendAt: nowSec + delaySeconds
  };

  const next = [...jobs, job].sort((a, b) => a.sendAt - b.sendAt);
  await setJobs(next);
  await chrome.runtime.sendMessage({ type: "CREATE_JOB", job });

  // clear compiler
  cText.value = "";
  cH.value = "0";
  cM.value = "0";
  cS.value = "10";

  setStatus("Scheduled.");
  await refresh();
}

cAdd.addEventListener("click", addFromCompiler);

let timer = null;
async function start() {
  await refresh();
  timer = setInterval(refresh, 1000);
}

window.addEventListener("beforeunload", () => {
  if (timer) clearInterval(timer);
});

start();
