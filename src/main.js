const invoke =
  window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke ?? null;

const widget = document.getElementById("widget");
const hmEl = document.getElementById("clock-hm");
const secondsEl = document.getElementById("clock-seconds");
const dateEl = document.getElementById("date");
const lunarDateEl = document.getElementById("lunar-date");
const lunarTagEl = document.getElementById("lunar-tag");
const hintEl = document.getElementById("hint");
const menuEl = document.getElementById("menu");
const toggleTopEl = document.getElementById("toggle-top");
const toggleSecondsEl = document.getElementById("toggle-seconds");
const refreshWeatherEl = document.getElementById("refresh-weather");
const quitEl = document.getElementById("quit");
const weatherLabelEl = document.getElementById("weather-label");
const weatherTempEl = document.getElementById("weather-temp");
const weatherHumidityEl = document.getElementById("weather-humidity");
const weatherAqiEl = document.getElementById("weather-aqi");
const weatherChipEl = document.getElementById("weather-chip");
const locatorEl = document.getElementById("locator");
const cityInputEl = document.getElementById("city-input");
const locatorResultsEl = document.getElementById("locator-results");
const locateAutoEl = document.getElementById("locate-auto");
const locateCancelEl = document.getElementById("locate-cancel");
const setCityEl = document.getElementById("set-city");

const STORAGE_KEYS = {
  alwaysOnTop: "metimes:always-on-top",
  showSeconds: "metimes:show-seconds",
  location: "metimes:location-v3",
};

const LOCATION_TTL = 6 * 60 * 60 * 1000;
const WEATHER_INTERVAL = 10 * 60 * 1000;
const WEATHER_RETRY = 2 * 60 * 1000;

const GEO_URL = "https://ipwho.is/?lang=zh-CN";
const GEO_FALLBACK_URL = "https://ipapi.co/json/";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const REVERSE_GEO_URL =
  "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat}" +
  "&longitude={lon}&localityLanguage=zh";
const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}" +
  "&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto";
const AIR_URL =
  "https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}" +
  "&longitude={lon}&current=us_aqi&timezone=auto";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

// Used only when every IP location service is unavailable.
const TIMEZONE_CITIES = {
  "Asia/Shanghai": ["上海", 31.2304, 121.4737],
  "Asia/Urumqi": ["乌鲁木齐", 43.8256, 87.6168],
  "Asia/Chongqing": ["重庆", 29.563, 106.5516],
  "Asia/Harbin": ["哈尔滨", 45.8038, 126.535],
  "Asia/Hong_Kong": ["香港", 22.3193, 114.1694],
  "Asia/Macau": ["澳门", 22.1987, 113.5439],
  "Asia/Taipei": ["台北", 25.033, 121.5654],
  "Asia/Tokyo": ["东京", 35.6762, 139.6503],
  "Asia/Seoul": ["首尔", 37.5665, 126.978],
  "Asia/Singapore": ["新加坡", 1.3521, 103.8198],
  "America/New_York": ["纽约", 40.7128, -74.006],
  "Europe/London": ["伦敦", 51.5074, -0.1278],
};

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
};

const pad = (value) => String(value).padStart(2, "0");

let lastDayKey = "";
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

function renderClock() {
  const now = new Date();
  hmEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  secondsEl.textContent = `:${pad(now.getSeconds())}`;

  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  if (dayKey !== lastDayKey) {
    lastDayKey = dayKey;
    renderCalendar(now);
  }

  // Re-align to the next whole second so the clock never drifts.
  window.setTimeout(renderClock, 1000 - (Date.now() % 1000));
}

function renderCalendar(now) {
  dateEl.textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ` +
    `星期${WEEKDAYS[now.getDay()]}`;

  if (typeof Solar === "undefined") {
    lunarDateEl.textContent = "农历不可用";
    return;
  }

  const solar = Solar.fromDate(now);
  const lunar = solar.getLunar();
  lunarDateEl.textContent =
    `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()} · ` +
    `${lunar.getYearInGanZhi()}${lunar.getYearShengXiao()}年`;
  const festivals = [...solar.getFestivals(), ...lunar.getFestivals()];
  lunarTagEl.textContent = lunar.getJieQi() || festivals[0] || "";
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
      const city = (await reverseGeocodeZh(system.latitude, system.longitude)) || "当前位置";
      return {
        city,
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
        city: direct.city,
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

async function locate() {
  const system = await locateSystem();
  if (system) {
    localStorage.setItem(STORAGE_KEYS.location, JSON.stringify(system));
    return system;
  }

  const direct = await locateDirect();
  if (direct) {
    localStorage.setItem(STORAGE_KEYS.location, JSON.stringify(direct));
    return direct;
  }

  const providers = [locateByIpwho, locateByIpapi];
  for (const provider of providers) {
    try {
      const location = await provider();
      if (location) {
        localStorage.setItem(STORAGE_KEYS.location, JSON.stringify(location));
        return location;
      }
    } catch (error) {
      console.warn("定位服务不可用", error);
    }
  }

  const fallback = timezoneLocation();
  if (fallback) return fallback;
  throw new Error("定位失败");
}

function buildLocation(city, latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { city: city || "当前位置", latitude: lat, longitude: lon, ts: Date.now() };
}

async function locateByIpwho() {
  const data = await getJson(GEO_URL, 8000);
  if (!data || data.success === false) return null;
  return buildLocation(data.city || data.region, data.latitude, data.longitude);
}

async function reverseGeocodeZh(latitude, longitude) {
  try {
    const zh = await getJson(
      REVERSE_GEO_URL.replace("{lat}", latitude).replace("{lon}", longitude),
      10000,
    );
    return zh.city || zh.locality || "";
  } catch (error) {
    console.warn("地名翻译失败", error);
    return "";
  }
}

async function locateByIpapi() {
  const data = await getJson(GEO_FALLBACK_URL, 10000);
  if (!data || data.error) return null;
  const location = buildLocation(data.city || data.region, data.latitude, data.longitude);
  if (!location) return null;

  const city = await reverseGeocodeZh(location.latitude, location.longitude);
  if (city) location.city = city;
  return location;
}

function timezoneLocation() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const entry = TIMEZONE_CITIES[timezone];
  if (!entry) return null;
  return { city: entry[0], latitude: entry[1], longitude: entry[2], ts: Date.now() };
}

function weatherText(code) {
  return WEATHER_TEXT[code] ?? "未知";
}

function setAqi(value) {
  weatherAqiEl.className = "chip-value";
  if (!Number.isFinite(value)) {
    weatherAqiEl.textContent = "--";
    return;
  }
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
  weatherAqiEl.textContent = `${Math.round(value)} ${level}`;
  weatherAqiEl.classList.add(color);
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
    weatherLabelEl.textContent = `${location.city} · ${weatherText(current.weather_code)}`;
    weatherTempEl.textContent = `${Math.round(temperature)}°`;
    weatherHumidityEl.textContent = `${Math.round(humidity)}%`;
  } catch (error) {
    console.error("天气获取失败", error);
    weatherLabelEl.textContent = `${location.city} · 天气获取失败`;
    weatherTempEl.textContent = "--°";
    weatherHumidityEl.textContent = "--%";
  }
}

async function updateAir(location) {
  try {
    const data = await getJson(
      AIR_URL.replace("{lat}", location.latitude).replace("{lon}", location.longitude),
      20000,
    );
    setAqi(Number(data.current?.us_aqi));
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
    weatherLabelEl.textContent = `${location.city} · 更新中`;
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
    meta.textContent = [item.admin1, item.country].filter(Boolean).join(" · ");
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

widget.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (locatorEl.hidden) {
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
  }
});

window.addEventListener("blur", hideMenu);

toggleTopEl.addEventListener("click", toggleAlwaysOnTop);
toggleSecondsEl.addEventListener("click", toggleSeconds);
refreshWeatherEl.addEventListener("click", () => refreshWeather());
setCityEl.addEventListener("click", openLocator);
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

applyPrefs();
renderClock();
applyAlwaysOnTop();
refreshWeather();

window.setTimeout(() => hintEl.classList.add("hidden"), 4500);
