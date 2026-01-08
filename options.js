const nameEls = [
  document.getElementById("n1"),
  document.getElementById("n2"),
  document.getElementById("n3"),
  document.getElementById("n4"),
  document.getElementById("n5")
];

const urlEls = [
  document.getElementById("u1"),
  document.getElementById("u2"),
  document.getElementById("u3"),
  document.getElementById("u4"),
  document.getElementById("u5")
];

const saveBtn = document.getElementById("save");
const clearBtn = document.getElementById("clear");
const statusEl = document.getElementById("status");

const STORAGE_KEYS = {
  WEBHOOKS: "webhooks",           // [{name,url}] length 5
  LAST_INDEX: "lastWebhookIndex"  // number 0..4
};

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function isLikelyDiscordWebhook(url) {
  if (!url) return true; // empty allowed
  try {
    const u = new URL(url);
    const okHost = u.hostname === "discord.com" || u.hostname === "discordapp.com";
    const okPath = u.pathname.startsWith("/api/webhooks/");
    return u.protocol === "https:" && okHost && okPath;
  } catch {
    return false;
  }
}

function normalizeWebhookEntries(raw) {
  // Support old string[5] format by converting to objects.
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

async function load() {
  const { webhooks } = await chrome.storage.sync.get([STORAGE_KEYS.WEBHOOKS]);
  const list = normalizeWebhookEntries(webhooks);

  for (let i = 0; i < 5; i++) {
    nameEls[i].value = list[i].name || "";
    urlEls[i].value = list[i].url || "";
  }

  setStatus("");
}

saveBtn.addEventListener("click", async () => {
  const entries = [];
  for (let i = 0; i < 5; i++) {
    const name = (nameEls[i].value || "").trim();
    const url = (urlEls[i].value || "").trim();

    if (!isLikelyDiscordWebhook(url)) {
      setStatus(`Webhook ${i + 1} doesn’t look like a Discord webhook URL.`);
      return;
    }

    entries.push({ name, url });
  }

  await chrome.storage.sync.set({ [STORAGE_KEYS.WEBHOOKS]: entries });

  // keep last index valid
  const { lastWebhookIndex } = await chrome.storage.sync.get([STORAGE_KEYS.LAST_INDEX]);
  const idx = Number.isInteger(lastWebhookIndex) ? lastWebhookIndex : 0;
  const safeIdx = Math.min(4, Math.max(0, idx));
  if (safeIdx !== idx) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.LAST_INDEX]: safeIdx });
  }

  setStatus("Saved.");
});

clearBtn.addEventListener("click", async () => {
  for (let i = 0; i < 5; i++) {
    nameEls[i].value = "";
    urlEls[i].value = "";
  }

  await chrome.storage.sync.set({
    [STORAGE_KEYS.WEBHOOKS]: [
      { name: "", url: "" },
      { name: "", url: "" },
      { name: "", url: "" },
      { name: "", url: "" },
      { name: "", url: "" }
    ],
    [STORAGE_KEYS.LAST_INDEX]: 0
  });

  setStatus("Cleared.");
});

load();
