const invoke =
  window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke ?? null;

const widget = document.getElementById("widget");
const hmEl = document.getElementById("clock-hm");
const secondsEl = document.getElementById("clock-seconds");
const dateEl = document.getElementById("date");
const lunarDateEl = document.getElementById("lunar-date");
const lunarTagEl = document.getElementById("lunar-tag");
const menuEl = document.getElementById("menu");
const toggleTopEl = document.getElementById("toggle-top");
const toggleSecondsEl = document.getElementById("toggle-seconds");
const refreshWeatherEl = document.getElementById("refresh-weather");
const quitEl = document.getElementById("quit");
const weatherLabelEl = document.getElementById("weather-label");
const weatherTempEl = document.getElementById("weather-temp");
const weatherTempRangeEl = document.getElementById("weather-temp-range");
const weatherHumidityEl = document.getElementById("weather-humidity");
const weatherHumidityRangeEl = document.getElementById("weather-humidity-range");
const weatherAqiEl = document.getElementById("weather-aqi");
const weatherAqiLevelEl = document.getElementById("aqi-level");
const weatherAqiRangeEl = document.getElementById("weather-aqi-range");
const weatherChipEl = document.getElementById("weather-chip");
const locatorEl = document.getElementById("locator");
const cityInputEl = document.getElementById("city-input");
const locatorResultsEl = document.getElementById("locator-results");
const locateAutoEl = document.getElementById("locate-auto");
const locateCancelEl = document.getElementById("locate-cancel");
const setCityEl = document.getElementById("set-city");
const toggleLockEl = document.getElementById("toggle-lock");
const setCountdownsEl = document.getElementById("set-countdowns");
const countdownPanelEl = document.getElementById("countdown-panel");
const countdownListEl = document.getElementById("countdown-list");
const countdownNameEl = document.getElementById("countdown-name");
const countdownDateEl = document.getElementById("countdown-date");
const countdownAddEl = document.getElementById("countdown-add");
const countdownManageListEl = document.getElementById("countdown-manage-list");
const countdownCloseEl = document.getElementById("countdown-close");

const STORAGE_KEYS = {
  alwaysOnTop: "metimes:always-on-top",
  showSeconds: "metimes:show-seconds",
  lockPosition: "metimes:lock-position",
  clockOffset: "metimes:clock-offset",
  location: "metimes:location-v5",
  countdowns: "metimes:countdowns",
};

const LOCATION_TTL = 6 * 60 * 60 * 1000;
const WEATHER_INTERVAL = 10 * 60 * 1000;
const WEATHER_RETRY = 2 * 60 * 1000;

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}" +
  "&current=temperature_2m,relative_humidity_2m,weather_code" +
  "&daily=temperature_2m_max,temperature_2m_min,relative_humidity_2m_max,relative_humidity_2m_min" +
  "&forecast_days=1&timezone=auto";
const AIR_URL =
  "https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}" +
  "&longitude={lon}&current=us_aqi&hourly=us_aqi&forecast_days=1&timezone=auto";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const WEATHER_TEXT = {
  0: "晴",
  1: "晴间多云",
  2: "多云",
  3: "阴",
  45: "雾",
  48: "雾凇",
  51: "毛毛雨",
  53: "毛毛雨",
  55: "毛毛雨",
  56: "冻雨",
  57: "冻雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "雪粒",
  80: "阵雨",
  81: "阵雨",
  82: "强阵雨",
  85: "阵雪",
  86: "阵雪",
  95: "雷阵雨",
  96: "雷暴冰雹",
  99: "雷暴冰雹",
};

const prefs = {
  alwaysOnTop: readBool(STORAGE_KEYS.alwaysOnTop, true),
  showSeconds: readBool(STORAGE_KEYS.showSeconds, true),
  lockPosition: readBool(STORAGE_KEYS.lockPosition, false),
};

const pad = (value) => String(value).padStart(2, "0");

let lastDayKey = "";
let clockOffset = Number(localStorage.getItem(STORAGE_KEYS.clockOffset)) || 0;
let weatherTimer = null;
let refreshing = false;
let refreshAgain = false;
let citySearchTimer = null;
let citySearchToken = 0;

function readBool(key, fallback) {
  const stored = localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
}

function writeBool(key, value) {
  localStorage.setItem(key, String(value));
}

function readCountdowns() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.countdowns) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((entry) => entry && entry.name && /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
      : [];
  } catch {
    return [];
  }
}

function saveCountdowns() {
  localStorage.setItem(STORAGE_KEYS.countdowns, JSON.stringify(countdowns));
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function lunarHolidayDate(lunarYear, month, day) {
  const solar = Lunar.fromYmd(lunarYear, month, day).getSolar();
  return new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay());
}

function qingmingDate(year) {
  for (let day = 1; day <= 15; day += 1) {
    const date = new Date(year, 3, day);
    if (Lunar.fromDate(date).getJieQi() === "清明") return date;
  }
  return new Date(year, 3, 5);
}

function holidayDate(definition, year) {
  switch (definition.kind) {
    case "solar":
      return new Date(year, definition.month - 1, definition.day);
    case "lunar":
      return lunarHolidayDate(year, definition.month, definition.day);
    case "chuxi":
      return new Date(lunarHolidayDate(year, 1, 1).getTime() - 86400000);
    case "qingming":
      return qingmingDate(year);
    default:
      return null;
  }
}

function nextHoliday(definition, today) {
  const year = today.getFullYear();
  return [year, year + 1]
    .map((target) => holidayDate(definition, target))
    .find((date) => date && startOfDay(date) >= today) ?? null;
}

function countdownDays(target, today) {
  return Math.round((startOfDay(target) - today) / 86400000);
}

function renderCountdowns() {
  const today = startOfDay(new Date());
  const items = [];

  for (const definition of AUTO_HOLIDAYS) {
    const date = nextHoliday(definition, today);
    if (date) items.push({ name: definition.name, date });
  }

  for (const entry of countdowns) {
    const date = parseISODate(entry.date);
    if (date && startOfDay(date) >= today) items.push({ name: entry.name, date });
  }

  items.sort((a, b) => a.date - b.date);

  countdownListEl.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "countdown-empty";
    empty.textContent = "暂无倒计时";
    countdownListEl.append(empty);
    return;
  }

  for (const item of items.slice(0, 5)) {
    const row = document.createElement("li");
    row.className = "countdown-item";

    const name = document.createElement("span");
    name.className = "countdown-name";
    name.textContent = item.name;

    const days = document.createElement("span");
    days.className = "countdown-days";
    const remaining = countdownDays(item.date, today);
    days.textContent = remaining === 0 ? "今天" : remaining === 1 ? "明天" : `${remaining}天`;

    row.append(name, days);
    countdownListEl.append(row);
  }
}

function renderCountdownManage() {
  countdownManageListEl.innerHTML = "";
  const sorted = [...countdowns].sort((a, b) => a.date.localeCompare(b.date));

  if (!sorted.length) {
    const empty = document.createElement("div");
    empty.className = "locator-empty";
    empty.textContent = "还没有手动倒计时";
    countdownManageListEl.append(empty);
    return;
  }

  for (const entry of sorted) {
    const row = document.createElement("div");
    row.className = "countdown-manage-row";

    const name = document.createElement("span");
    name.className = "countdown-manage-name";
    name.textContent = entry.name;

    const date = document.createElement("span");
    date.className = "countdown-manage-date";
    date.textContent = entry.date;

    const remove = document.createElement("button");
    remove.className = "countdown-del";
    remove.dataset.id = entry.id;
    remove.textContent = "删除";

    row.append(name, date, remove);
    countdownManageListEl.append(row);
  }
}

function openCountdownPanel() {
  hideMenu();
  hideLocator();
  countdownPanelEl.hidden = false;
  countdownDateEl.min = formatISODate(new Date());
  renderCountdownManage();
  countdownNameEl.focus();
}

function hideCountdownPanel() {
  countdownPanelEl.hidden = true;
}

function addCountdown() {
  const name = countdownNameEl.value.trim();
  const date = parseISODate(countdownDateEl.value);
  const today = startOfDay(new Date());
  if (!name || !date || startOfDay(date) < today) return;

  countdowns.push({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.slice(0, 24),
    date: countdownDateEl.value,
  });
  saveCountdowns();
  countdownNameEl.value = "";
  countdownDateEl.value = "";
  renderCountdownManage();
  renderCountdowns();
  countdownNameEl.focus();
}

function removeCountdown(id) {
  countdowns = countdowns.filter((entry) => entry.id !== id);
  saveCountdowns();
  renderCountdownManage();
  renderCountdowns();
}

const AUTO_HOLIDAYS = [
  { name: "元旦", kind: "solar", month: 1, day: 1 },
  { name: "春节", kind: "lunar", month: 1, day: 1 },
  { name: "元宵节", kind: "lunar", month: 1, day: 15 },
  { name: "清明节", kind: "qingming" },
  { name: "劳动节", kind: "solar", month: 5, day: 1 },
  { name: "端午节", kind: "lunar", month: 5, day: 5 },
  { name: "中秋节", kind: "lunar", month: 8, day: 15 },
  { name: "国庆节", kind: "solar", month: 10, day: 1 },
  { name: "除夕", kind: "chuxi" },
];

let countdowns = readCountdowns();

async function syncClock() {
  if (!invoke) return;
  try {
    const offset = await invoke("ntp_offset");
    if (Number.isFinite(offset)) {
      clockOffset = offset;
      localStorage.setItem(STORAGE_KEYS.clockOffset, String(offset));
    }
  } catch (error) {
    console.error("校时失败", error);
  }
}

function renderClock() {
  const now = new Date(Date.now() + clockOffset);
  hmEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  secondsEl.textContent = `:${pad(now.getSeconds())}`;

  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  if (dayKey !== lastDayKey) {
    lastDayKey = dayKey;
    renderCalendar(now);
    renderCountdowns();
  }

  // Re-align to the next whole second so the clock never drifts.
  const drift = (Date.now() + clockOffset) % 1000;
  window.setTimeout(renderClock, 1000 - drift);
}

function weekOfYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = startOfDay(date) - start + (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60000;
  return Math.floor(diff / 86400000);
}

function renderCalendar(now) {
  dateEl.textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ` +
    `星期${WEEKDAYS[now.getDay()]} 第${weekOfYear(now)}周 第${dayOfYear(now)}天`;

  if (typeof Solar === "undefined") {
    lunarDateEl.textContent = "农历不可用";
    return;
  }

  const solar = Solar.fromDate(now);
  const lunar = solar.getLunar();
  lunarDateEl.textContent =
    `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}日 ` +
    `${lunar.getYearInGanZhi()}${lunar.getYearShengXiao()}年 ` +
    `${lunar.getMonthInGanZhi()}月 ${lunar.getDayInGanZhi()}日`;
  const festivals = [...solar.getFestivals(), ...lunar.getFestivals()];
  lunarTagEl.textContent = lunar.getJieQi() || festivals[0] || "";
}

function applyPrefs() {
  secondsEl.classList.toggle("hidden", !prefs.showSeconds);
  toggleSecondsEl.setAttribute("aria-checked", String(prefs.showSeconds));
  toggleTopEl.setAttribute("aria-checked", String(prefs.alwaysOnTop));
  toggleLockEl.setAttribute("aria-checked", String(prefs.lockPosition));
  widget.classList.toggle("locked", prefs.lockPosition);
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
  if (prefs.lockPosition) return;
  if (event.target.closest(".menu, .chip-action, .locator")) return;
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

function toggleLock() {
  prefs.lockPosition = !prefs.lockPosition;
  writeBool(STORAGE_KEYS.lockPosition, prefs.lockPosition);
  applyPrefs();
}

function toggleSeconds() {
  prefs.showSeconds = !prefs.showSeconds;
  writeBool(STORAGE_KEYS.showSeconds, prefs.showSeconds);
  applyPrefs();
}

async function getJson(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

function readLocation() {
  try {
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEYS.location));
    if (cached && (cached.manual || Date.now() - cached.ts < LOCATION_TTL)) {
      return cached;
    }
  } catch {
    // ignore malformed cache
  }
  return null;
}

async function locateSystem() {
  if (!invoke) return null;
  try {
    const system = await invoke("locate_system");
    if (system && Number.isFinite(system.latitude) && Number.isFinite(system.longitude)) {
      return {
        city: "当前位置",
        latitude: system.latitude,
        longitude: system.longitude,
        ts: Date.now(),
        system: true,
      };
    }
  } catch (error) {
    console.warn("系统定位不可用", error);
  }
  return null;
}

async function locateDirect() {
  if (!invoke) return null;
  try {
    const direct = await invoke("locate_direct");
    if (direct && Number.isFinite(direct.latitude) && Number.isFinite(direct.longitude)) {
      return {
        city: direct.city || "当前位置",
        latitude: direct.latitude,
        longitude: direct.longitude,
        ts: Date.now(),
        direct: true,
      };
    }
  } catch (error) {
    console.warn("直连定位不可用", error);
  }
  return null;
}

// 先走国内 IP 库定位：一次请求即拿到中文城市名 + 坐标；系统定位只提供坐标，作为兜底
async function locate() {
  const direct = await locateDirect();
  if (direct) {
    localStorage.setItem(STORAGE_KEYS.location, JSON.stringify(direct));
    return direct;
  }

  const system = await locateSystem();
  if (system) {
    localStorage.setItem(STORAGE_KEYS.location, JSON.stringify(system));
    return system;
  }

  throw new Error("定位失败");
}

function weatherText(code) {
  return WEATHER_TEXT[code] ?? "未知";
}

function dailyRange(min, max, unit) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "";
  return `(${Math.round(min)}${unit}~${Math.round(max)}${unit})`;
}

function setAqi(value, min, max) {
  weatherAqiEl.textContent = "--";
  weatherAqiLevelEl.textContent = "";
  weatherAqiLevelEl.className = "aqi-level";
  weatherAqiRangeEl.textContent = dailyRange(min, max, "");
  if (!Number.isFinite(value)) return;
  let level = "优";
  let color = "aqi-good";
  if (value > 300) {
    level = "严重";
    color = "aqi-severe";
  } else if (value > 200) {
    level = "重度";
    color = "aqi-heavy";
  } else if (value > 150) {
    level = "中度";
    color = "aqi-mid";
  } else if (value > 100) {
    level = "轻度";
    color = "aqi-light";
  } else if (value > 50) {
    level = "良";
    color = "aqi-fair";
  }
  weatherAqiEl.textContent = String(Math.round(value));
  weatherAqiLevelEl.textContent = level;
  weatherAqiLevelEl.classList.add(color);
}

async function updateWeather(location) {
  try {
    const data = await getJson(
      WEATHER_URL.replace("{lat}", location.latitude).replace("{lon}", location.longitude),
    );
    const current = data.current ?? {};
    const temperature = Number(current.temperature_2m);
    const humidity = Number(current.relative_humidity_2m);
    if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) {
      throw new Error("天气数据异常");
    }
    weatherLabelEl.textContent = `${location.city} ${weatherText(current.weather_code)}`;
    weatherTempEl.textContent = `${Math.round(temperature)}°`;
    weatherHumidityEl.textContent = `${Math.round(humidity)}%`;
    const daily = data.daily ?? {};
    weatherTempRangeEl.textContent = dailyRange(
      Number(daily.temperature_2m_min?.[0]),
      Number(daily.temperature_2m_max?.[0]),
      "°",
    );
    weatherHumidityRangeEl.textContent = dailyRange(
      Number(daily.relative_humidity_2m_min?.[0]),
      Number(daily.relative_humidity_2m_max?.[0]),
      "%",
    );
  } catch (error) {
    console.error("天气获取失败", error);
    weatherLabelEl.textContent = `${location.city} 天气获取失败`;
    weatherTempEl.textContent = "--°";
    weatherHumidityEl.textContent = "--%";
    weatherTempRangeEl.textContent = "";
    weatherHumidityRangeEl.textContent = "";
  }
}

async function updateAir(location) {
  try {
    const data = await getJson(
      AIR_URL.replace("{lat}", location.latitude).replace("{lon}", location.longitude),
      20000,
    );
    const hourly = (data.hourly?.us_aqi ?? []).map(Number).filter(Number.isFinite);
    setAqi(
      Number(data.current?.us_aqi),
      hourly.length ? Math.min(...hourly) : NaN,
      hourly.length ? Math.max(...hourly) : NaN,
    );
  } catch (error) {
    console.error("空气质量获取失败", error);
    setAqi(NaN);
  }
}

function scheduleWeatherRefresh(delay) {
  window.clearTimeout(weatherTimer);
  weatherTimer = window.setTimeout(() => refreshWeather(), delay);
}

async function refreshWeather() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  let ok = true;
  try {
    let location = readLocation();
    if (!location) {
      weatherLabelEl.textContent = "定位中…";
      location = await locate();
    }
    weatherLabelEl.textContent = `${location.city} 更新中`;
    await Promise.allSettled([updateWeather(location), updateAir(location)]);
    if (weatherLabelEl.textContent.includes("获取失败")) ok = false;
  } catch (error) {
    console.error("定位失败", error);
    ok = false;
    weatherLabelEl.textContent = "定位失败";
    weatherTempEl.textContent = "--°";
    weatherHumidityEl.textContent = "--%";
    setAqi(NaN);
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      refreshWeather();
      return;
    }
    scheduleWeatherRefresh(ok ? WEATHER_INTERVAL : WEATHER_RETRY);
  }
}

function openLocator() {
  hideMenu();
  hideCountdownPanel();
  locatorEl.hidden = false;
  cityInputEl.value = "";
  locatorResultsEl.innerHTML = '<div class="locator-empty">输入城市名搜索</div>';
  cityInputEl.focus();
}

function hideLocator() {
  if (locatorEl.hidden) return;
  locatorEl.hidden = true;
  window.clearTimeout(citySearchTimer);
  citySearchToken += 1;
}

async function searchCity(query) {
  const keyword = query.trim();
  if (!keyword) {
    locatorResultsEl.innerHTML = '<div class="locator-empty">输入城市名搜索</div>';
    return;
  }

  const token = ++citySearchToken;
  locatorResultsEl.innerHTML = '<div class="locator-empty">搜索中…</div>';
  try {
    const data = await getJson(
      `${GEOCODE_URL}?name=${encodeURIComponent(keyword)}&count=6&language=zh&format=json`,
      9000,
    );
    if (token !== citySearchToken || locatorEl.hidden) return;
    renderCityResults(data.results ?? []);
  } catch (error) {
    console.error("城市搜索失败", error);
    if (token !== citySearchToken) return;
    locatorResultsEl.innerHTML = '<div class="locator-empty">搜索失败，请稍后重试</div>';
  }
}

function renderCityResults(results) {
  if (!results.length) {
    locatorResultsEl.innerHTML = '<div class="locator-empty">未找到匹配的城市</div>';
    return;
  }

  locatorResultsEl.innerHTML = "";
  for (const item of results) {
    const button = document.createElement("button");
    button.className = "locator-result";
    button.dataset.city = item.name;
    button.dataset.lat = String(item.latitude);
    button.dataset.lon = String(item.longitude);

    const name = document.createElement("span");
    name.textContent = item.name;
    const meta = document.createElement("small");
    meta.textContent = [item.admin1, item.country].filter(Boolean).join(" ");
    button.append(name, meta);
    locatorResultsEl.appendChild(button);
  }
}

function selectCity(city, latitude, longitude) {
  localStorage.setItem(
    STORAGE_KEYS.location,
    JSON.stringify({ city, latitude, longitude, manual: true, ts: Date.now() }),
  );
  hideLocator();
  refreshWeather();
}

widget.addEventListener("pointerdown", startDrag);

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (!event.target.closest(".menu") && locatorEl.hidden && countdownPanelEl.hidden) {
    showMenu(event.clientX, event.clientY);
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!menuEl.hidden && !event.target.closest(".menu")) {
    hideMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideMenu();
    hideLocator();
    hideCountdownPanel();
  }
});

window.addEventListener("blur", hideMenu);

toggleTopEl.addEventListener("click", toggleAlwaysOnTop);
toggleSecondsEl.addEventListener("click", toggleSeconds);
toggleLockEl.addEventListener("click", toggleLock);
refreshWeatherEl.addEventListener("click", () => refreshWeather());
setCityEl.addEventListener("click", openLocator);
setCountdownsEl.addEventListener("click", openCountdownPanel);
countdownAddEl.addEventListener("click", addCountdown);
countdownCloseEl.addEventListener("click", hideCountdownPanel);
countdownNameEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addCountdown();
});
countdownDateEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addCountdown();
});
countdownManageListEl.addEventListener("click", (event) => {
  const button = event.target.closest(".countdown-del");
  if (button) removeCountdown(button.dataset.id);
});
weatherChipEl.addEventListener("click", openLocator);
locateCancelEl.addEventListener("click", hideLocator);
locateAutoEl.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEYS.location);
  hideLocator();
  refreshWeather();
});

cityInputEl.addEventListener("input", () => {
  window.clearTimeout(citySearchTimer);
  citySearchTimer = window.setTimeout(() => searchCity(cityInputEl.value), 350);
});

cityInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    window.clearTimeout(citySearchTimer);
    searchCity(cityInputEl.value);
  }
});

locatorResultsEl.addEventListener("click", (event) => {
  const item = event.target.closest(".locator-result");
  if (!item) return;
  const latitude = Number(item.dataset.lat);
  const longitude = Number(item.dataset.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  selectCity(item.dataset.city, latitude, longitude);
});

quitEl.addEventListener("click", () => {
  if (invoke) {
    invoke("quit_app");
  }
});

// 旧版本把"当前位置"当作城市名缓存 6 小时，升级后清掉一次，让新逻辑重新取到具体城市
try {
  const cached = JSON.parse(localStorage.getItem(STORAGE_KEYS.location));
  if (cached && !cached.manual && cached.city === "当前位置") {
    localStorage.removeItem(STORAGE_KEYS.location);
  }
} catch {
  localStorage.removeItem(STORAGE_KEYS.location);
}

applyPrefs();
renderCountdowns();
renderClock();
syncClock();
applyAlwaysOnTop();
refreshWeather();
window.setInterval(() => syncClock(), 30 * 60 * 1000);
