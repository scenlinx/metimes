const invoke =
  window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke ?? null;

const widget = document.getElementById("widget");
const hmEl = document.getElementById("clock-hm");
const secondsEl = document.getElementById("clock-seconds");
const dateEl = document.getElementById("date");
const hintEl = document.getElementById("hint");
const menuEl = document.getElementById("menu");
const toggleTopEl = document.getElementById("toggle-top");
const toggleSecondsEl = document.getElementById("toggle-seconds");
const quitEl = document.getElementById("quit");

const STORAGE_KEYS = {
  alwaysOnTop: "metimes:always-on-top",
  showSeconds: "metimes:show-seconds",
};

const prefs = {
  alwaysOnTop: readBool(STORAGE_KEYS.alwaysOnTop, true),
  showSeconds: readBool(STORAGE_KEYS.showSeconds, true),
};

const pad = (value) => String(value).padStart(2, "0");
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

function readBool(key, fallback) {
  const stored = localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
}

function writeBool(key, value) {
  localStorage.setItem(key, String(value));
}

function renderClock() {
  const now = new Date();
  hmEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  secondsEl.textContent = `:${pad(now.getSeconds())}`;
  dateEl.textContent = dateFormatter.format(now);

  // Re-align to the next whole second so the clock never drifts.
  window.setTimeout(renderClock, 1000 - (Date.now() % 1000));
}

function applyPrefs() {
  secondsEl.classList.toggle("hidden", !prefs.showSeconds);
  toggleSecondsEl.setAttribute("aria-checked", String(prefs.showSeconds));
  toggleTopEl.setAttribute("aria-checked", String(prefs.alwaysOnTop));
}

async function applyAlwaysOnTop() {
  if (!invoke) return;
  try {
    await invoke("set_always_on_top", { enabled: prefs.alwaysOnTop });
  } catch (error) {
    console.error("无法设置置顶状态", error);
  }
}

function hideMenu() {
  menuEl.hidden = true;
}

function showMenu(x, y) {
  menuEl.hidden = false;
  const { width, height } = menuEl.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - width - 6);
  const top = Math.min(y, window.innerHeight - height - 6);
  menuEl.style.left = `${Math.max(6, left)}px`;
  menuEl.style.top = `${Math.max(6, top)}px`;
}

async function startDrag(event) {
  if (event.button !== 0) return;
  if (event.target.closest(".menu")) return;
  if (!invoke) return;
  try {
    await invoke("start_drag");
  } catch (error) {
    console.error("拖动失败", error);
  }
}

async function toggleAlwaysOnTop() {
  prefs.alwaysOnTop = !prefs.alwaysOnTop;
  writeBool(STORAGE_KEYS.alwaysOnTop, prefs.alwaysOnTop);
  applyPrefs();
  await applyAlwaysOnTop();
}

function toggleSeconds() {
  prefs.showSeconds = !prefs.showSeconds;
  writeBool(STORAGE_KEYS.showSeconds, prefs.showSeconds);
  applyPrefs();
}

widget.addEventListener("pointerdown", startDrag);

widget.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  showMenu(event.clientX, event.clientY);
});

document.addEventListener("pointerdown", (event) => {
  if (!menuEl.hidden && !event.target.closest(".menu")) {
    hideMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideMenu();
});

window.addEventListener("blur", hideMenu);

toggleTopEl.addEventListener("click", toggleAlwaysOnTop);
toggleSecondsEl.addEventListener("click", toggleSeconds);
quitEl.addEventListener("click", () => {
  if (invoke) {
    invoke("quit_app");
  }
});

applyPrefs();
renderClock();
applyAlwaysOnTop();

window.setTimeout(() => hintEl.classList.add("hidden"), 4500);
