const el = (id) => document.getElementById(id);

const textEl = el("text");
const minEl = el("min");
const secEl = el("sec");
const useTsEl = el("useTs");
const use1mReminderEl = el("use1mReminder");
const previewEl = el("preview");
const sendBtn = el("send");
const statusEl = el("status");

const openSettings = el("openSettings");
const webhookSelect = el("webhookSelect");
const dockLink = el("dock");
const scheduleLink = el("openSchedule");

const STORAGE_KEYS = {
  WEBHOOKS: "webhooks",             // [{ name, url }] length 5
  LAST_INDEX: "lastWebhookIndex",   // 0..4
  DOCK_WINDOW_ID: "dockWindowId",
  SCHEDULE_WINDOW_ID: "scheduleWindowId",
  SCHEDULED_JOBS: "scheduledJobs"   // array of jobs, max 10
};

function clampInt(v, min, max) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function buildDiscordRelativeTimestamp(offsetSeconds) {
  const unix = Math.floor(Date.now() / 1000) + offsetSeconds;
  return `<t:${unix}:R>`;
}

function compileMessage() {
  const text = (textEl.value || "").trim();
  const m = clampInt(minEl.value, 0, 999);
  const s = clampInt(secEl.value, 0, 59);

  minEl.value = String(m);
  secEl.value = String(s);

  const offsetSeconds = m * 60 + s;
  const includeTs = useTsEl.checked && offsetSeconds > 0;

  const ts = includeTs ? buildDiscordRelativeTimestamp(offsetSeconds) : "";
  const compiled = [text, ts].filter(Boolean).join(" ");

  previewEl.textContent = compiled || "—";
  return compiled;
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

async function getSettings() {
  const { webhooks, lastWebhookIndex } = await chrome.storage.sync.get([
    STORAGE_KEYS.WEBHOOKS,
    STORAGE_KEYS.LAST_INDEX
  ]);
  return {
    webhooks: normalizeWebhookEntries(webhooks),
    lastWebhookIndex: Number.isInteger(lastWebhookIndex) ? lastWebhookIndex : 0
  };
}

function optionLabel(i, entry) {
  const filled = entry.url ? "✓" : "";
  const base = entry.name ? entry.name : `Webhook ${i + 1}`;
  return filled ? `${base} ${filled}` : base;
}

async function populateWebhookSelect() {
  const { webhooks, lastWebhookIndex } = await getSettings();

  webhookSelect.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = optionLabel(i, webhooks[i]);
    webhookSelect.appendChild(opt);
  }

  const idx = clampInt(lastWebhookIndex, 0, 4);
  webhookSelect.value = String(idx);

  if (!webhooks[idx].url) setStatus("Selected webhook is empty. Set it in Settings.");
  else setStatus("");
}

async function rememberSelectedIndex() {
  const idx = clampInt(webhookSelect.value, 0, 4);
  await chrome.storage.sync.set({ [STORAGE_KEYS.LAST_INDEX]: idx });
}

async function getSelectedWebhookUrl() {
  const { webhooks } = await getSettings();
  const idx = clampInt(webhookSelect.value, 0, 4);
  return (webhooks[idx]?.url || "").trim();
}

async function sendToDiscord(content) {
  const webhookUrl = await getSelectedWebhookUrl();
  if (!webhookUrl) {
    setStatus("No webhook in this slot. Open Settings.");
    return { ok: false };
  }

  sendBtn.disabled = true;
  setStatus("Sending…");

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Discord error ${res.status}${text ? `: ${text}` : ""}`);
    }

    setStatus("Sent.");
    return { ok: true };
  } catch (err) {
    setStatus(String(err?.message || err));
    return { ok: false };
  } finally {
    sendBtn.disabled = false;
  }
}

/* ---------------- window helpers (no duplicates) ---------------- */
async function focusOrCreateWindow(storageKey, createOpts) {
  const obj = await chrome.storage.sync.get([storageKey]);
  const id = Number.isInteger(obj[storageKey]) ? obj[storageKey] : null;

  if (id !== null) {
    try {
      await chrome.windows.update(id, { focused: true });
      return;
    } catch {
      await chrome.storage.sync.remove([storageKey]);
    }
  }

  const win = await chrome.windows.create(createOpts);
  if (win && Number.isInteger(win.id)) {
    await chrome.storage.sync.set({ [storageKey]: win.id });
  }
}

async function focusOrCreateDockWindow() {
  return focusOrCreateWindow(STORAGE_KEYS.DOCK_WINDOW_ID, {
    url: chrome.runtime.getURL("popup.html"),
    type: "popup",
    width: 380,
    height: 520
  });
}

async function focusOrCreateScheduleWindow() {
  return focusOrCreateWindow(STORAGE_KEYS.SCHEDULE_WINDOW_ID, {
    url: chrome.runtime.getURL("schedule.html"),
    type: "popup",
    width: 820,
    height: 640
  });
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { dockWindowId, scheduleWindowId } = await chrome.storage.sync.get([
    STORAGE_KEYS.DOCK_WINDOW_ID,
    STORAGE_KEYS.SCHEDULE_WINDOW_ID
  ]);

  if (Number.isInteger(dockWindowId) && dockWindowId === windowId) {
    await chrome.storage.sync.remove([STORAGE_KEYS.DOCK_WINDOW_ID]);
  }
  if (Number.isInteger(scheduleWindowId) && scheduleWindowId === windowId) {
    await chrome.storage.sync.remove([STORAGE_KEYS.SCHEDULE_WINDOW_ID]);
  }
});

/* ---------------- scheduled jobs list helpers ---------------- */
function normalizeJobs(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((j) => j && typeof j === "object")
    .map((j) => ({
      id: String(j.id || ""),
      text: String(j.text || ""),
      webhookIndex: Number.isInteger(j.webhookIndex) ? j.webhookIndex : 0,
      kind: j.kind === "reminder" ? "reminder" : "scheduled",
      status: j.status === "scheduled" ? "scheduled" : "scheduled",
      createdAt: Number.isFinite(j.createdAt) ? j.createdAt : 0,
      sendAt: Number.isFinite(j.sendAt) ? j.sendAt : 0
    }))
    .filter((j) => j.id && j.text && j.sendAt);
}

async function getJobs() {
  const { scheduledJobs } = await chrome.storage.sync.get([STORAGE_KEYS.SCHEDULED_JOBS]);
  return normalizeJobs(scheduledJobs);
}

async function setJobs(jobs) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SCHEDULED_JOBS]: jobs });
}

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function addJob(job) {
  const jobs = await getJobs();
  if (jobs.length >= 10) return { ok: false, reason: "Maximum of 10 scheduled items reached" };

  const next = [...jobs, job].sort((a, b) => a.sendAt - b.sendAt);
  await setJobs(next);

  await chrome.runtime.sendMessage({ type: "CREATE_JOB", job });
  return { ok: true };
}

/* ---------------- events ---------------- */
textEl.addEventListener("input", compileMessage);
minEl.addEventListener("input", compileMessage);
secEl.addEventListener("input", compileMessage);
useTsEl.addEventListener("change", compileMessage);

webhookSelect.addEventListener("change", async () => {
  await rememberSelectedIndex();
  await populateWebhookSelect();
});

sendBtn.addEventListener("click", async () => {
  const compiled = compileMessage();
  const rawText = (textEl.value || "").trim();

  if (!compiled) {
    setStatus("Nothing to send.");
    return;
  }

  await rememberSelectedIndex();

  const sendRes = await sendToDiscord(compiled);
  if (!sendRes.ok) return;

  if (use1mReminderEl.checked && rawText) {
    const webhookIndex = clampInt(webhookSelect.value, 0, 4);
    const nowSec = Math.floor(Date.now() / 1000);

    const reminderJob = {
      id: uuid(),
      text: `@everyone Reminder: ${rawText}`,
      webhookIndex,
      kind: "reminder",
      status: "scheduled",
      createdAt: nowSec,
      sendAt: nowSec + 60
    };

    const r = await addJob(reminderJob);
    if (!r.ok) setStatus(r.reason);
    else setStatus("Sent. Reminder scheduled (+1m).");
  }
});

openSettings.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

dockLink.addEventListener("click", async (e) => {
  e.preventDefault();
  await focusOrCreateDockWindow();
});

scheduleLink.addEventListener("click", async (e) => {
  e.preventDefault();
  await focusOrCreateScheduleWindow();
});

// init
compileMessage();
populateWebhookSelect();
