const STORAGE_KEYS = {
  WEBHOOKS: "webhooks",             // [{name,url}] length 5
  LAST_INDEX: "lastWebhookIndex",   // 0..4
  SCHEDULED_JOBS: "scheduledJobs",  // array max 10
  QUICK_ACTIONS: "quickActions"     // array length 9
};

const $ = (id) => document.getElementById(id);

const app = $("app");
const stack = $("stack");

// top
const mainWebhook = $("mainWebhook");
const settingsBtn = $("settingsBtn");
const settingsIcon = $("settingsIcon");

// message panel
const mText = $("mText");
const mMin = $("mMin");
const mSec = $("mSec");
const mUseTs = $("mUseTs");
const mReminder = $("mReminder");
const mPreview = $("mPreview");
const mSend = $("mSend");
const mStatus = $("mStatus");
const qaGrid = $("qaGrid");
const toSchedule = $("toSchedule");

// schedule panel
const toMessage = $("toMessage");
const sText = $("sText");
const sH = $("sH");
const sM = $("sM");
const sS = $("sS");
const sWebhook = $("sWebhook");
const sAdd = $("sAdd");
const sStatus = $("sStatus");
const jobList = $("jobList");
const jobCount = $("jobCount");

// settings overlay
const settingsPane = $("settings");
const whList = $("whList");
const qaList = $("qaList");

function clampInt(v, min, max) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function setMode(mode) {
  app.dataset.mode = mode;
}

function setSettingsOpen(isOpen) {
  app.dataset.settings = isOpen ? "open" : "closed";
  settingsIcon.textContent = isOpen ? "✕" : "⚙";
}

function setStatus(el, msg) {
  el.textContent = msg || "";
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

function normalizeQuickActions(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (let i = 0; i < 9; i++) {
    const v = arr[i];
    if (v && typeof v === "object") {
      out.push({
        label: String(v.label || `${i + 1}`).trim() || `${i + 1}`,
        message: String(v.message || "").trim(),
        webhookIndex: Number.isInteger(v.webhookIndex) ? v.webhookIndex : 0
      });
    } else {
      out.push({ label: `${i + 1}`, message: "", webhookIndex: 0 });
    }
  }
  return out;
}

async function getAll() {
  const data = await chrome.storage.sync.get([
    STORAGE_KEYS.WEBHOOKS,
    STORAGE_KEYS.LAST_INDEX,
    STORAGE_KEYS.SCHEDULED_JOBS,
    STORAGE_KEYS.QUICK_ACTIONS
  ]);

  return {
    webhooks: normalizeWebhookEntries(data.webhooks),
    lastWebhookIndex: Number.isInteger(data.lastWebhookIndex) ? data.lastWebhookIndex : 0,
    jobs: normalizeJobs(data.scheduledJobs),
    quickActions: normalizeQuickActions(data.quickActions)
  };
}

async function setWebhooks(webhooks) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.WEBHOOKS]: webhooks });
}

async function setLastWebhookIndex(i) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.LAST_INDEX]: i });
}

async function setJobs(jobs) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SCHEDULED_JOBS]: jobs });
}

async function setQuickActions(quickActions) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.QUICK_ACTIONS]: quickActions });
}

function hookLabel(h, i) {
  const base = h.name ? h.name : `Webhook ${i + 1}`;
  const mark = h.url ? " ✓" : "";
  return `${base}${mark}`;
}

function renderHookSelect(selectEl, hooks, selected) {
  selectEl.innerHTML = hooks
    .map((h, i) => `<option value="${i}">${escapeHtml(hookLabel(h, i))}</option>`)
    .join("");
  selectEl.value = String(clampInt(selected, 0, 4));
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- Message compiler ---------- */

function buildDiscordRelativeTimestamp(offsetSeconds) {
  const unix = Math.floor(Date.now() / 1000) + offsetSeconds;
  return `<t:${unix}:R>`;
}

function compileMessagePreview() {
  const text = (mText.value || "").trim();
  const mm = clampInt(mMin.value, 0, 999);
  const ss = clampInt(mSec.value, 0, 59);

  mMin.value = String(mm);
  mSec.value = String(ss);

  const offset = mm * 60 + ss;
  const includeTs = mUseTs.checked && offset > 0;
  const ts = includeTs ? buildDiscordRelativeTimestamp(offset) : "";
  const compiled = [text, ts].filter(Boolean).join(" ");

  mPreview.textContent = compiled || "—";
  return { compiled, rawText: text };
}

async function sendDiscord(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord error ${res.status}${text ? `: ${text}` : ""}`);
  }
}

async function addJob(job) {
  const { jobs } = await getAll();
  if (jobs.length >= 10) return { ok: false, reason: "Maximum of 10 scheduled items reached" };

  const next = [...jobs, job].sort((a, b) => a.sendAt - b.sendAt);
  await setJobs(next);
  await chrome.runtime.sendMessage({ type: "CREATE_JOB", job });
  return { ok: true };
}

/* ---------- Schedule panel list ---------- */

function formatRemaining(sendAt) {
  const now = Math.floor(Date.now() / 1000);
  const r = Math.max(0, sendAt - now);
  const m = Math.floor(r / 60);
  const s = r % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function jobItemTemplate(job, hooks) {
  const rem = formatRemaining(job.sendAt);
  const hookName = hookLabel(hooks[clampInt(job.webhookIndex, 0, 4)] || { name: "", url: "" }, clampInt(job.webhookIndex, 0, 4));
  const badge = job.kind === "reminder" ? "Auto (Reminder)" : "Scheduled";

  return `
    <div class="item" data-id="${escapeHtml(job.id)}">
      <div>
        <div class="msg">${escapeHtml(job.text)}</div>
        <div class="badge">${escapeHtml(badge)} · ${escapeHtml(rem)}</div>
      </div>
      <div class="msg">${escapeHtml(rem)}</div>
      <div class="msg">${escapeHtml(hookName)}</div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="secondaryBtn cancelBtn">Cancel</button>
      </div>
    </div>
  `;
}

async function refreshScheduleView() {
  const { webhooks, jobs } = await getAll();

  jobCount.textContent = `${jobs.length}/10`;
  sAdd.disabled = jobs.length >= 10;
  if (jobs.length >= 10) setStatus(sStatus, "Maximum of 10 scheduled items reached");
  else if (sStatus.textContent === "Maximum of 10 scheduled items reached") setStatus(sStatus, "");

  if (jobs.length === 0) {
    jobList.innerHTML = "";
    return;
  }

  jobList.innerHTML = jobs.map((j) => jobItemTemplate(j, webhooks)).join("");

  jobList.querySelectorAll(".cancelBtn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const item = e.target.closest(".item");
      const id = item.getAttribute("data-id");
      await chrome.runtime.sendMessage({ type: "CANCEL_JOB", id });
      setStatus(sStatus, "Canceled.");
      await refreshScheduleView();
    });
  });
}

/* ---------- Quick Actions ---------- */

function qaBtnTemplate(i, qa) {
  const label = qa.label || `${i + 1}`;
  const subtitle = qa.message ? "Send" : "Not set";
  return `
    <button class="qaBtn" data-qa="${i}">
      ${escapeHtml(label)}
      <small>${escapeHtml(subtitle)}</small>
    </button>
  `;
}

function setQaState(btn, state) {
  btn.classList.remove("state-sending", "state-ok", "state-bad");
  if (state) btn.classList.add(state);
}

async function handleQuickActionClick(index, btn) {
  const { webhooks, quickActions } = await getAll();
  const qa = quickActions[index];

  // Immediate feedback
  setQaState(btn, "state-sending");

  try {
    const msg = (qa.message || "").trim();
    const webhookIndex = clampInt(qa.webhookIndex, 0, 4);
    const url = (webhooks[webhookIndex]?.url || "").trim();

    if (!msg) throw new Error("Quick action not set.");
    if (!url) throw new Error("Webhook not configured.");

    await sendDiscord(url, msg);

    setQaState(btn, "state-ok");
    setStatus(mStatus, "Quick action sent.");
  } catch (e) {
    setQaState(btn, "state-bad");
    setStatus(mStatus, String(e?.message || e));
  } finally {
    // Return to idle after a moment
    setTimeout(() => setQaState(btn, ""), 900);
  }
}

async function renderQuickActions() {
  const { quickActions } = await getAll();
  qaGrid.innerHTML = quickActions.map((qa, i) => qaBtnTemplate(i, qa)).join("");

  qaGrid.querySelectorAll(".qaBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = clampInt(btn.getAttribute("data-qa"), 0, 8);
      handleQuickActionClick(i, btn);
    });
  });
}

/* ---------- Settings overlay ---------- */

let saveTimer = null;
function scheduleAutosave(fn) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(fn, 250);
}

function renderSettingsWebhooks(webhooks) {
  whList.innerHTML = webhooks
    .map((w, i) => `
      <div class="formRow" data-wh="${i}">
        <div class="formRowHeader">
          <div>Webhook ${i + 1}</div>
        </div>
        <div class="twoCol">
          <input class="whName input" placeholder="Name" value="${escapeHtml(w.name)}" />
          <input class="whUrl input" placeholder="URL" value="${escapeHtml(w.url)}" />
        </div>
      </div>
    `)
    .join("");

  whList.querySelectorAll(".formRow").forEach((row) => {
    const idx = clampInt(row.getAttribute("data-wh"), 0, 4);

    const nameEl = row.querySelector(".whName");
    const urlEl = row.querySelector(".whUrl");

    const onChange = () => {
      scheduleAutosave(async () => {
        const { webhooks } = await getAll();
        webhooks[idx].name = (nameEl.value || "").trim();
        webhooks[idx].url = (urlEl.value || "").trim();
        await setWebhooks(webhooks);
        await refreshAllUI();
      });
    };

    nameEl.addEventListener("input", onChange);
    urlEl.addEventListener("input", onChange);
  });
}

function renderSettingsQuickActions(quickActions, webhooks) {
  qaList.innerHTML = quickActions
    .map((qa, i) => `
      <div class="formRow" data-qa="${i}">
        <div class="formRowHeader">
          <div>Action ${i + 1}</div>
        </div>

        <div class="threeCol">
          <input class="qaLabel input" placeholder="Label (e.g. A1)" value="${escapeHtml(qa.label)}" />
          <select class="qaHook select"></select>
          <input class="qaMsg input" placeholder="Message" value="${escapeHtml(qa.message)}" />
        </div>
      </div>
    `)
    .join("");

  qaList.querySelectorAll(".formRow").forEach((row) => {
    const idx = clampInt(row.getAttribute("data-qa"), 0, 8);

    const labelEl = row.querySelector(".qaLabel");
    const hookEl = row.querySelector(".qaHook");
    const msgEl = row.querySelector(".qaMsg");

    // hook select options
    hookEl.innerHTML = webhooks
      .map((h, i) => `<option value="${i}">${escapeHtml(hookLabel(h, i))}</option>`)
      .join("");
    hookEl.value = String(clampInt(quickActions[idx].webhookIndex, 0, 4));

    const onChange = () => {
      scheduleAutosave(async () => {
        const { quickActions: qas } = await getAll();
        qas[idx].label = (labelEl.value || "").trim() || `${idx + 1}`;
        qas[idx].webhookIndex = clampInt(hookEl.value, 0, 4);
        qas[idx].message = (msgEl.value || "").trim();
        await setQuickActions(qas);
        await renderQuickActions();
      });
    };

    labelEl.addEventListener("input", onChange);
    hookEl.addEventListener("change", onChange);
    msgEl.addEventListener("input", onChange);
  });
}

async function refreshAllUI() {
  const { webhooks, lastWebhookIndex, quickActions } = await getAll();

  renderHookSelect(mainWebhook, webhooks, lastWebhookIndex);
  renderHookSelect(sWebhook, webhooks, lastWebhookIndex);

  renderSettingsWebhooks(webhooks);
  renderSettingsQuickActions(quickActions, webhooks);
  await renderQuickActions();
  await refreshScheduleView();
}

/* ---------- Events ---------- */

mText.addEventListener("input", compileMessagePreview);
mMin.addEventListener("input", compileMessagePreview);
mSec.addEventListener("input", compileMessagePreview);
mUseTs.addEventListener("change", compileMessagePreview);

mainWebhook.addEventListener("change", async () => {
  await setLastWebhookIndex(clampInt(mainWebhook.value, 0, 4));
  await refreshAllUI();
});

sWebhook.addEventListener("change", async () => {
  await setLastWebhookIndex(clampInt(sWebhook.value, 0, 4));
  await refreshAllUI();
});

mSend.addEventListener("click", async () => {
  const { webhooks } = await getAll();
  const { compiled, rawText } = compileMessagePreview();
  if (!compiled) {
    setStatus(mStatus, "Nothing to send.");
    return;
  }

  const webhookIndex = clampInt(mainWebhook.value, 0, 4);
  const url = (webhooks[webhookIndex]?.url || "").trim();

  if (!url) {
    setStatus(mStatus, "Selected webhook is empty. Set it in Settings.");
    return;
  }

  mSend.disabled = true;
  setStatus(mStatus, "Sending…");

  try {
    await sendDiscord(url, compiled);
    setStatus(mStatus, "Sent.");

    // Reminder only for Send-now
    if (mReminder.checked && rawText) {
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
      if (!r.ok) setStatus(mStatus, r.reason);
      else setStatus(mStatus, "Sent. Reminder scheduled (+1m).");
    }

    await refreshScheduleView();
  } catch (e) {
    setStatus(mStatus, String(e?.message || e));
  } finally {
    mSend.disabled = false;
  }
});

toSchedule.addEventListener("click", () => setMode("schedule"));
toMessage.addEventListener("click", () => setMode("message"));

settingsBtn.addEventListener("click", async () => {
  const open = app.dataset.settings === "open";
  setSettingsOpen(!open);
  if (!open) await refreshAllUI();
});

// Schedule compiler
sAdd.addEventListener("click", async () => {
  const text = (sText.value || "").trim();
  const hh = clampInt(sH.value, 0, 999);
  const mm = clampInt(sM.value, 0, 59);
  const ss = clampInt(sS.value, 0, 59);
  const delaySeconds = hh * 3600 + mm * 60 + ss;

  if (!text) {
    setStatus(sStatus, "Message is empty.");
    return;
  }
  if (delaySeconds < 10) {
    setStatus(sStatus, "Delay must be at least 10 seconds.");
    return;
  }

  const webhookIndex = clampInt(sWebhook.value, 0, 4);
  const nowSec = Math.floor(Date.now() / 1000);

  const job = {
    id: uuid(),
    text,
    webhookIndex,
    kind: "scheduled",
    status: "scheduled",
    createdAt: nowSec,
    sendAt: nowSec + delaySeconds
  };

  const r = await addJob(job);
  if (!r.ok) {
    setStatus(sStatus, r.reason);
    await refreshScheduleView();
    return;
  }

  // reset
  sText.value = "";
  sH.value = "0";
  sM.value = "0";
  sS.value = "10";

  setStatus(sStatus, "Scheduled.");
  await refreshScheduleView();
});

// refresh schedule list periodically (for remaining time + auto removal)
setInterval(() => {
  refreshScheduleView();
}, 1000);

/* ---------- Init ---------- */
(async function init() {
  // Default mode: message
  setMode("message");
  setSettingsOpen(false);

  // Ensure defaults exist for quick actions
  const { quickActions, webhooks, lastWebhookIndex } = await getAll();
  await setQuickActions(quickActions); // normalized to 9

  renderHookSelect(mainWebhook, webhooks, lastWebhookIndex);
  renderHookSelect(sWebhook, webhooks, lastWebhookIndex);

  compileMessagePreview();
  await renderQuickActions();
  await refreshScheduleView();

  // Settings UI initial render (only opens on demand)
})();
