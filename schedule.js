const STORAGE_KEYS = {
  WEBHOOKS: "webhooks",
  SCHEDULE_ROWS: "scheduleRows"
};

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function clampInt(v, min, max) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
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

async function getRows() {
  const { scheduleRows } = await chrome.storage.sync.get([STORAGE_KEYS.SCHEDULE_ROWS]);
  return normalizeScheduleRows(scheduleRows);
}

async function setRows(rows) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SCHEDULE_ROWS]: rows });
}

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeWebhookOptions(hooks, selected) {
  return hooks
    .map((h, i) => {
      const name = h.name ? h.name : `Webhook ${i + 1}`;
      const mark = h.url ? " ✓" : "";
      const sel = i === selected ? "selected" : "";
      return `<option value="${i}" ${sel}>${name}${mark}</option>`;
    })
    .join("");
}

function renderRow(i, row, hooks) {
  const locked = row.status === "scheduled";
  const kindBadge = row.kind === "reminder" ? "Auto (Reminder)" : "";

  const h = clampInt(Math.floor((row.delaySeconds || 0) / 3600), 0, 999);
  const m = clampInt(Math.floor(((row.delaySeconds || 0) % 3600) / 60), 0, 59);
  const s = clampInt((row.delaySeconds || 0) % 60, 0, 59);

  const remainingSec =
    locked && row.sendAt ? Math.max(0, row.sendAt - Math.floor(Date.now() / 1000)) : 0;

  const remainingLabel =
    locked ? `Scheduled · ${remainingSec}s remaining` : "Not scheduled";

  const html = `
    <div class="row ${locked ? "locked" : ""}" data-index="${i}">
      <div>
        <input class="text" placeholder="Message…" value="${escapeHtml(row.text)}" ${locked ? "disabled" : ""} />
        <div class="badge">${kindBadge ? `${kindBadge} · ` : ""}${remainingLabel}</div>
      </div>

      <div class="time">
        <input class="hh" type="number" min="0" max="999" value="${h}" ${locked || row.kind === "reminder" ? "disabled" : ""} />
        <input class="mm" type="number" min="0" max="59" value="${m}" ${locked || row.kind === "reminder" ? "disabled" : ""} />
        <input class="ss" type="number" min="0" max="59" value="${s}" ${locked || row.kind === "reminder" ? "disabled" : ""} />
      </div>

      <select class="hook" ${locked ? "disabled" : ""}>
        ${makeWebhookOptions(hooks, clampInt(row.webhookIndex, 0, 4))}
      </select>

      <div class="actions">
        ${
          locked
            ? `<button class="secondary cancel">Cancel</button>`
            : `<button class="schedule">Schedule</button>`
        }
      </div>
    </div>
  `;
  return html;
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function render() {
  const hooks = await getWebhooks();
  const rows = await getRows();

  grid.innerHTML = rows.map((r, i) => renderRow(i, r, hooks)).join("");

  // Attach handlers
  grid.querySelectorAll(".row").forEach((rowEl) => {
    const index = clampInt(rowEl.getAttribute("data-index"), 0, 9);

    const scheduleBtn = rowEl.querySelector("button.schedule");
    const cancelBtn = rowEl.querySelector("button.cancel");

    if (scheduleBtn) {
      scheduleBtn.addEventListener("click", async () => {
        const text = (rowEl.querySelector("input.text").value || "").trim();
        const hh = clampInt(rowEl.querySelector("input.hh").value, 0, 999);
        const mm = clampInt(rowEl.querySelector("input.mm").value, 0, 59);
        const ss = clampInt(rowEl.querySelector("input.ss").value, 0, 59);
        const hookIndex = clampInt(rowEl.querySelector("select.hook").value, 0, 4);

        const delaySeconds = hh * 3600 + mm * 60 + ss;

        if (!text) {
          setStatus("Row message is empty.");
          return;
        }
        if (delaySeconds < 10) {
          setStatus("Delay must be at least 10 seconds.");
          return;
        }

        const allRows = await getRows();
        const nowSec = Math.floor(Date.now() / 1000);
        const id = uuid();

        allRows[index] = {
          id,
          text,
          delaySeconds,
          webhookIndex: hookIndex,
          kind: "scheduled",
          status: "scheduled",
          createdAt: nowSec,
          sendAt: nowSec + delaySeconds
        };

        await setRows(allRows);

        await chrome.runtime.sendMessage({
          type: "CREATE_JOB",
          job: allRows[index]
        });

        setStatus("Scheduled.");
        await render();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", async () => {
        const allRows = await getRows();
        const id = allRows[index]?.id;
        if (!id) return;

        await chrome.runtime.sendMessage({ type: "CANCEL_JOB", id });
        setStatus("Canceled.");
        await render();
      });
    }
  });
}

// Auto-refresh so reminder rows inserted by popup appear and countdown updates
let timer = null;
async function start() {
  await render();
  timer = setInterval(render, 1200);
}

window.addEventListener("beforeunload", () => {
  if (timer) clearInterval(timer);
});

start();
