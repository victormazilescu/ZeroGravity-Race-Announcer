const el = (id) => document.getElementById(id);

const textEl = el("text");
const minEl = el("min");
const secEl = el("sec");
const useTsEl = el("useTs");
const previewEl = el("preview");
const sendBtn = el("send");
const statusEl = el("status");
const openSettings = el("openSettings");
const webhookSelect = el("webhookSelect");
const dockLink = el("dock");

const STORAGE_KEYS = {
  WEBHOOKS: "webhooks",            // [{ name: string, url: string }] length 5
  LAST_INDEX: "lastWebhookIndex",  // number 0..4
  DOCK_WINDOW_ID: "dockWindowId"   // number (chrome window id)
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
      if (typeof v === "string") {
        out.push({ name: "", url: (v || "").trim() });
      } else if (v && typeof v === "object") {
        out.push({
          name: (v.name || "").trim(),
          url: (v.url || "").trim()
        });
      } else {
        out.push({ name: "", url: "" });
      }
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
    return;
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
  } catch (err) {
    setStatus(String(err?.message || err));
  } finally {
    sendBtn.disabled = false;
  }
}

// --- Dock behavior ---
// Focus existing dock window if it exists; otherwise create a new one and remember its windowId.
async function focusOrCreateDockWindow() {
  const { dockWindowId } = await chrome.storage.sync.get([STORAGE_KEYS.DOCK_WINDOW_ID]);
  const id = Number.isInteger(dockWindowId) ? dockWindowId : null;

  if (id !== null) {
    try {
      // If this succeeds, the window exists
      await chrome.windows.update(id, { focused: true });
      return;
    } catch {
      // Window was closed or invalid; clear and create anew
      await chrome.storage.sync.remove([STORAGE_KEYS.DOCK_WINDOW_ID]);
    }
  }

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html"),
    type: "popup",
    width: 380,
    height: 520
  });

  if (win && Number.isInteger(win.id)) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.DOCK_WINDOW_ID]: win.id });
  }
}

// If a dock window is closed, clear the stored id (so Dock recreates next time).
// Note: This runs in any popup instance; it’s lightweight and avoids adding a background worker.
chrome.windows.onRemoved.addListener(async (windowId) => {
  const { dockWindowId } = await chrome.storage.sync.get([STORAGE_KEYS.DOCK_WINDOW_ID]);
  if (Number.isInteger(dockWindowId) && dockWindowId === windowId) {
    await chrome.storage.sync.remove([STORAGE_KEYS.DOCK_WINDOW_ID]);
  }
});

// Events
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
  if (!compiled) {
    setStatus("Nothing to send.");
    return;
  }
  await rememberSelectedIndex();
  await sendToDiscord(compiled);
});

openSettings.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

dockLink.addEventListener("click", async (e) => {
  e.preventDefault();
  await focusOrCreateDockWindow();
});

// init
compileMessage();
populateWebhookSelect();
