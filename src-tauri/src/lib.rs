use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_autostart::MacosLauncher;

#[derive(Serialize)]
struct DirectLocation {
    city: String,
    latitude: f64,
    longitude: f64,
}

#[derive(Deserialize)]
struct IpIpResponse {
    ret: Option<String>,
    data: Option<IpIpData>,
}

#[derive(Deserialize)]
struct IpIpData {
    location: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct GeocodeResponse {
    results: Option<Vec<GeocodeResult>>,
}

#[derive(Deserialize)]
struct GeocodeResult {
    latitude: Option<f64>,
    longitude: Option<f64>,
}

/// Uses a domestic IP database for the city name, then geocodes it to coordinates.
async fn locate_by_cn_database(client: &reqwest::Client) -> Option<DirectLocation> {
    let response = client.get("https://myip.ipip.net/json").send().await.ok()?;
    let payload = response.json::<IpIpResponse>().await.ok()?;
    if payload.ret.as_deref() != Some("ok") {
        return None;
    }

    let entries = payload.data?.location?;
    let city = entries
        .iter()
        .skip(1)
        .take(2)
        .filter(|entry| !entry.trim().is_empty())
        .last()?
        .clone();

    let geocode = client
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[
            ("name", city.as_str()),
            ("count", "1"),
            ("language", "zh"),
            ("format", "json"),
        ])
        .send()
        .await
        .ok()?
        .json::<GeocodeResponse>()
        .await
        .ok()?;

    let first = geocode.results?.into_iter().next()?;
    Some(DirectLocation {
        city,
        latitude: first.latitude?,
        longitude: first.longitude?,
    })
}

#[derive(Serialize)]
struct SystemLocation {
    latitude: f64,
    longitude: f64,
}

/// Reads the OS location (Wi-Fi/GPS based), which is far more accurate than an IP lookup.
#[cfg(target_os = "windows")]
async fn read_system_location() -> Option<SystemLocation> {
    use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator, PositionAccuracy};

    let operation = Geolocator::RequestAccessAsync().ok()?;
    let access = operation.await.ok()?;
    if access != GeolocationAccessStatus::Allowed {
        return None;
    }

    let geolocator = Geolocator::new().ok()?;
    let _ = geolocator.SetDesiredAccuracy(PositionAccuracy::Default);
    let operation = geolocator.GetGeopositionAsync().ok()?;
    let position = operation.await.ok()?;
    let basic = position.Coordinate().ok()?.Point().ok()?.Position().ok()?;

    Some(SystemLocation {
        latitude: basic.Latitude,
        longitude: basic.Longitude,
    })
}

#[cfg(not(target_os = "windows"))]
async fn read_system_location() -> Option<SystemLocation> {
    None
}

#[tauri::command]
async fn locate_system() -> Option<SystemLocation> {
    match tokio::time::timeout(Duration::from_secs(10), read_system_location()).await {
        Ok(location) => location,
        Err(_) => None,
    }
}

const NTP_SERVERS: [&str; 3] = ["ntp.aliyun.com", "cn.pool.ntp.org", "time.windows.com"];
const NTP_UNIX_OFFSET_SECS: u64 = 2_208_988_800;

fn now_ms() -> i128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i128)
        .unwrap_or_default()
}

fn query_ntp(server: &str) -> Option<i64> {
    let addrs: Vec<SocketAddr> = (server, 123u16).to_socket_addrs().ok()?.collect();
    let addr = *addrs.iter().find(|addr| addr.is_ipv4()).or_else(|| addrs.first())?;

    let bind = if addr.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" };
    let socket = UdpSocket::bind(bind).ok()?;
    socket.set_read_timeout(Some(Duration::from_millis(1500))).ok()?;
    socket.connect(addr).ok()?;

    let mut packet = [0u8; 48];
    packet[0] = 0x23; // LI = 0, version = 4, mode = 3 (client)

    let sent_at = now_ms();
    socket.send(&packet).ok()?;

    let mut response = [0u8; 48];
    let size = socket.recv(&mut response).ok()?;
    let received_at = now_ms();
    if size < 48 || response[1] == 0 {
        return None;
    }

    let seconds = u32::from_be_bytes([response[40], response[41], response[42], response[43]]) as u64;
    let fraction = u32::from_be_bytes([response[44], response[45], response[46], response[47]]) as f64
        / 4_294_967_296.0;
    if seconds == 0 {
        return None;
    }

    let server_ms =
        (seconds.saturating_sub(NTP_UNIX_OFFSET_SECS) as f64 * 1000.0 + fraction * 1000.0) as i128;
    let offset = server_ms - (sent_at + received_at) / 2;
    if offset.abs() > 86_400_000 {
        return None;
    }
    Some(offset as i64)
}

fn sntp_offset() -> Option<i64> {
    NTP_SERVERS.iter().find_map(|server| query_ntp(server))
}

async fn http_offset() -> Option<i64> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(6))
        .build()
        .ok()?;
    let response = client.head("https://www.baidu.com").send().await.ok()?;
    let header = response.headers().get(reqwest::header::DATE)?.to_str().ok()?;
    let server = httpdate::parse_http_date(header).ok()?;
    let server_ms = server.duration_since(UNIX_EPOCH).ok()?.as_millis() as i128;
    Some((server_ms - now_ms()) as i64)
}

/// Returns the correction between the local clock and a time server, in milliseconds.
#[tauri::command]
async fn ntp_offset() -> Result<i64, String> {
    let blocking = tauri::async_runtime::spawn_blocking(sntp_offset);
    if let Ok(Ok(Some(offset))) = tokio::time::timeout(Duration::from_secs(6), blocking).await {
        return Ok(offset);
    }

    http_offset().await.ok_or_else(|| "校时失败".to_string())
}

/// Resolves the location with a direct connection, bypassing the system HTTP proxy.
#[tauri::command]
async fn locate_direct() -> Result<Option<DirectLocation>, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(8))
        .user_agent("Metimes/1.0")
        .build()
        .map_err(|err| err.to_string())?;

    Ok(locate_by_cn_database(&client).await)
}

/// Lets the OS take over the current mouse press so the whole window can be dragged.
#[tauri::command]
fn start_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|err| err.to_string())
}

/// Toggles the always-on-top flag of the widget window.
#[tauri::command]
fn set_always_on_top(window: WebviewWindow, enabled: bool) -> Result<bool, String> {
    window
        .set_always_on_top(enabled)
        .map_err(|err| err.to_string())?;
    Ok(enabled)
}

/// Closes the widget, removing it from the desktop.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![
            locate_system,
            locate_direct,
            ntp_offset,
            start_drag,
            set_always_on_top,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running metimes");
}
