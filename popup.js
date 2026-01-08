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

const STORAGE_KEYS = {
  WEBHOOKS: "webhooks",           // [{ name: string, url: string }] length 5
  LAST_INDEX: "lastWebhookIndex"  // number 0..4
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
  // Support old format string[5] (URLs) gracefully by converting to objects.
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

async function populateWebhookSelect()
