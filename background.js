const STORAGE_KEYS = {
  WEBHOOKS: "webhooks",          // [{name,url}] length 5
  SCHEDULE_ROWS: "scheduleRows"  // length 10
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

function emptyRow() {
  return {
    id: "",
    text: "",
    delaySeconds: 0,
    webhookIndex: 0,
    kind: "scheduled",
    status: "empty",
    createdAt: 0,
    sendAt: 0
  };
}

function normalizeScheduleRows(raw) {
  const out = [];
  const arr = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < 10; i++) {
    const r = arr[i];
    if (r && typeof r === "object") {
      out.push({
        id: String(r.id || ""),
        text: String(r.text || ""),
        delaySeconds: Number.isFinite(r.delaySeconds) ? r.delaySeconds : 0,
        webhookIndex: Number.isInteger(r.webhookIndex) ? r.webhookIndex : 0,
        kind: r.kind === "reminder" ? "reminder" : "scheduled",
        status: ["empty", "scheduled", "sent", "canceled"].includes(r.status) ? r.status : "empty",
        createdAt: Number.isFinite(r.createdAt) ? r.createdAt : 0,
        sendAt: Number.isFinite(r.sendAt) ? r.sendAt : 0
      });
    } else {
      out.push(emptyRow());
    }
  }
  return out;
}

async function getWebhooks() {
  const { webhooks } = await chrome.storage.sync.get([STORAGE_KEYS.WEBHOOKS]);
  return normalizeWebhookEntries(webhooks);
}

async function getScheduleRows() {
  const { scheduleRows } = await chrome.storage.sync.get([STORAGE_KEYS.SCHEDULE_ROWS]);
  return normalizeScheduleRows(scheduleRows);
}

async function setScheduleRows(rows) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SCHEDULE_ROWS]: rows });
}

function alarmNameForJobId(id) {
  return `zg-job:${id}`;
}

async function createAlarmForJob(job) {
  const whenMs = Math.max(Date.now() + 250, job.sendAt * 1000); // ensure future
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

async function handleAlarm(alarm) {
  if (!alarm || !alarm.name || !alarm.name.startsWith("zg-job:")) return;

  const id = alarm.name.slice("zg-job:".length);
  const rows = await getScheduleRows();
  const idx = rows.findIndex((r) => r.id === id);

  if (idx === -1) {
    // orphan alarm
    await chrome.alarms.clear(alarm.name);
    return;
  }

  const job = rows[idx];
  if (job.status !== "scheduled") {
    await chrome.alarms.clear(alarm.name);
    return;
  }

  const hooks = await getWebhooks();
  const webhookIndex = Math.min(4, Math.max(0, job.webhookIndex));
  const url = (hooks[webhookIndex]?.url || "").trim();

  try {
    if (!url) throw new Error("Webhook not configured.");
    await sendDiscord(url, job.text);

    // Auto-clear after sending (frees slot)
    rows[idx] = emptyRow();
    await setScheduleRows(rows);
  } catch (err) {
    // If send failed, keep it scheduled but mark canceled? We'll keep it scheduled and free the alarm to avoid loops.
    // User can re-schedule manually.
    rows[idx].status = "canceled";
    await setScheduleRows(rows);
  } finally {
    await chrome.alarms.clear(alarm.name);
  }
}

/* Create job message from UI */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "CREATE_JOB" && msg.job?.id) {
        await createAlarmForJob(msg.job);
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "CANCEL_JOB" && msg.id) {
        const rows = await getScheduleRows();
        const idx = rows.findIndex((r) => r.id === msg.id);
        if (idx !== -1) {
          rows[idx] = emptyRow();
          await setScheduleRows(rows);
        }
        await removeAlarmForJobId(msg.id);
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message." });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true; // keep message channel open
});

chrome.alarms.onAlarm.addListener((alarm) => {
  handleAlarm(alarm);
});
