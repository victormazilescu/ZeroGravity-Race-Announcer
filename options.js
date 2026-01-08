const whEls = [
  document.getElementById("wh1"),
  document.getElementById("wh2"),
  document.getElementById("wh3"),
  document.getElementById("wh4"),
  document.getElementById("wh5")
];

const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");
const statusEl = document.getElementById("status");

const STORAGE_KEYS = {
  WEBHOOKS: "webhooks",
  LAST_INDEX: "lastWebhookIndex"
};

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function normalizeWebhooks(arr) {
  const a = Array.isArray(arr) ? arr : [];
  const out = [];
  for (let i = 0; i < 5; i++) out.push((a[i] || "").trim());
  return out;
}

function isLikelyDiscordWebhook(url) {
  if (!url) return true; // empty is allowed
  try {
    const u = new URL(url);
    const okHost = u.hostname === "discord.com" || u.hostname === "discordapp.com";
    const okPath = u.pathname.startsWith("/api/webhooks/");
    return u.protocol === "https:" && okHost && okPath;
  } catch {
    return false;
  }
}

async function load() {
  const { webhooks } = await chrome.storage.sync.get([STORAGE_KEYS.WEBHOOKS]);
  const list = normalizeWebhooks(webhooks);
  for (let i = 0; i < 5; i++) whEls[i].value = list[i] || "";
  setStatus("");
}

saveBtn.addEventListener("click", async () => {
  const list = whEls.map((x) => (x.value || "").trim());

  // validate non-empty inputs
  for (let i = 0; i < 5; i++) {
    if (!isLikelyDiscordWebhook(list[i])) {
      setStatus(`Webhook ${i + 1} doesn’t look like a Discord webhook URL.`);
      return;
    }
  }

  await chrome.storage.sync.set({ [STORAGE_KEYS.WEBHOOKS]: list });

  // keep last index in range
  const { lastWebhookIndex } = await chrome.storage.sync.get([STORAGE_KEYS.LAST_INDEX]);
  const idx = Number.isInteger(lastWebhookIndex) ? lastWebhookIndex : 0;
  const safeIdx = Math.min(4, Math.max(0, idx));
  if (safeIdx !== idx) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.LAST_INDEX]: safeIdx });
  }

  setStatus("Saved.");
});

clearBtn.addEventListener("click", async () => {
  for (const e of whEls) e.value = "";
  await chrome.storage.sync.set({
    [STORAGE_KEYS.WEBHOOKS]: ["", "", "", "", ""],
    [STORAGE_KEYS.LAST_INDEX]: 0
  });
  setStatus("Cleared.");
});

load();
