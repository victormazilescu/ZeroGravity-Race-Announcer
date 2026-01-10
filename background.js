const STORAGE_KEYS = {
  WEBHOOKS: "webhooks",
  SCHEDULED_JOBS: "scheduledJobs",
  DOCK_WINDOW_ID: "dockWindowId",
  DOCK_BOUNDS: "dockBounds"
};

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
    .filter((j) => j.id && j.text && j.sendAt);
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

function alarmNameForJobId(id) {
  return `zg-job:${id}`;
}

async function createAlarmForJob(job) {
  const whenMs = Math.max(Date.now() + 250, job.sendAt * 1000);
  await chrome.alarms.create(alarmNameForJobId(job.id), { when: whenMs });
}

async function removeAlarmForJobId(id) {
  await chrome.alarms.clear(alarmNameForJobId(id));
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

async function removeJobById(id) {
  const jobs = await getJobs();
  const next = jobs.filter((j) => j.id !== id);
  await setJobs(next);
}

async function handleAlarm(alarm) {
  if (!alarm?.name?.startsWith("zg-job:")) return;
  const id = alarm.name.slice("zg-job:".length);

  const jobs = await getJobs();
  const job = jobs.find((j) => j.id === id);

  if (!job) {
    await chrome.alarms.clear(alarm.name);
    return;
  }

  const hooks = await getWebhooks();
  const webhookIndex = Math.min(4, Math.max(0, job.webhookIndex));
  const url = (hooks[webhookIndex]?.url || "").trim();

  try {
    if (!url) throw new Error("Webhook not configured.");
    await sendDiscord(url, job.text);
  } catch {
    // remove anyway to avoid loops
  } finally {
    await removeJobById(id);
    await chrome.alarms.clear(alarm.name);
  }
}

/* ---------------- Dock window open/focus ---------------- */

async function getPrimaryDisplayWorkArea() {
  return new Promise((resolve) => {
    if (!chrome?.system?.display?.getInfo) {
      resolve(null);
      return;
    }
    chrome.system.display.getInfo((displays) => {
      if (!Array.isArray(displays) || displays.length === 0) return resolve(null);
      const primary = displays.find((d) => d.isPrimary) || displays[0];
      const wa = primary.workArea || primary.bounds;
      resolve(wa || null);
    });
  });
}

async function focusOrCreateDockWindow() {
  const { dockWindowId, dockBounds } = await chrome.storage.sync.get([
    STORAGE_KEYS.DOCK_WINDOW_ID,
    STORAGE_KEYS.DOCK_BOUNDS
  ]);

  const existingId = Number.isInteger(dockWindowId) ? dockWindowId : null;

  if (existingId !== null) {
    try {
      await chrome.windows.update(existingId, { focused: true });
      return;
    } catch {
      await chrome.storage.sync.remove([STORAGE_KEYS.DOCK_WINDOW_ID]);
    }
  }

  const url = chrome.runtime.getURL("dock.html");

  // If you have last bounds, reuse (user may have moved it)
  if (dockBounds && typeof dockBounds === "object") {
    const createOpts = {
      url,
      type: "popup",
      focused: true,
      width: Number.isInteger(dockBounds.width) ? dockBounds.width : 380,
      height: Number.isInteger(dockBounds.height) ? dockBounds.height : 720
    };
    if (Number.isInteger(dockBounds.left)) createOpts.left = dockBounds.left;
    if (Number.isInteger(dockBounds.top)) createOpts.top = dockBounds.top;

    const win = await chrome.windows.create(createOpts);
    if (win && Number.isInteger(win.id)) {
      await chrome.storage.sync.set({ [STORAGE_KEYS.DOCK_WINDOW_ID]: win.id });
    }
    return;
  }

  // Otherwise snap to right edge of primary display work area
  const wa = await getPrimaryDisplayWorkArea();
  const width = 380;
  const height = wa?.height ? Math.min(wa.height, 840) : 720;

  const left = wa?.left != null && wa?.width != null ? (wa.left + wa.width - width) : undefined;
  const top = wa?.top != null ? wa.top : undefined;

  const win = await chrome.windows.create({
    url,
    type: "popup",
    focused: true,
    width,
    height,
    ...(Number.isInteger(left) ? { left } : {}),
    ...(Number.isInteger(top) ? { top } : {})
  });

  if (win && Number.isInteger(win.id)) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.DOCK_WINDOW_ID]: win.id });
  }
}

chrome.action.onClicked.addListener(() => {
  focusOrCreateDockWindow();
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { dockWindowId } = await chrome.storage.sync.get([STORAGE_KEYS.DOCK_WINDOW_ID]);
  if (Number.isInteger(dockWindowId) && dockWindowId === windowId) {
    await chrome.storage.sync.remove([STORAGE_KEYS.DOCK_WINDOW_ID]);
  }
});

chrome.windows.onBoundsChanged.addListener(async (win) => {
  const { dockWindowId } = await chrome.storage.sync.get([STORAGE_KEYS.DOCK_WINDOW_ID]);
  if (!Number.isInteger(dockWindowId) || win.id !== dockWindowId) return;

  const bounds = {
    left: Number.isInteger(win.left) ? win.left : undefined,
    top: Number.isInteger(win.top) ? win.top : undefined,
    width: Number.isInteger(win.width) ? win.width : undefined,
    height: Number.isInteger(win.height) ? win.height : undefined
  };
  await chrome.storage.sync.set({ [STORAGE_KEYS.DOCK_BOUNDS]: bounds });
});

/* ---------------- Messages from UI ---------------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "CREATE_JOB" && msg.job?.id) {
        await createAlarmForJob(msg.job);
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "CANCEL_JOB" && msg.id) {
        await removeJobById(msg.id);
        await removeAlarmForJobId(msg.id);
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message." });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  handleAlarm(alarm);
});
