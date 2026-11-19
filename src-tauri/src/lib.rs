use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, WebviewWindow};

#[derive(Deserialize)]
struct IpWhoResponse {
    success: Option<bool>,
    city: Option<String>,
    region: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

#[derive(Deserialize)]
struct IpApiResponse {
    error: Option<bool>,
    city: Option<String>,
    region: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

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

fn to_location(city: Option<String>, region: Option<String>, lat: Option<f64>, lon: Option<f64>) -> Option<DirectLocation> {
    let latitude = lat?;
    let longitude = lon?;
    if !latitude.is_finite() || !longitude.is_finite() {
        return None;
    }
    let city = city
        .filter(|value| !value.trim().is_empty())
        .or(region)
        .unwrap_or_else(|| "当前位置".to_string());
    Some(DirectLocation {
        city,
        latitude,
        longitude,
    })
}

/// Resolves the location with a direct connection, bypassing the system HTTP proxy.
#[tauri::command]
async fn locate_direct() -> Result<Option<DirectLocation>, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(8))
        .user_agent("Metimes/0.1")
        .build()
        .map_err(|err| err.to_string())?;

    if let Some(location) = locate_by_cn_database(&client).await {
        return Ok(Some(location));
    }

    if let Ok(response) = client
        .get("https://ipwho.is/?lang=zh-CN")
        .send()
        .await
    {
        if let Ok(data) = response.json::<IpWhoResponse>().await {
            if data.success != Some(false) {
                if let Some(location) = to_location(data.city, data.region, data.latitude, data.longitude) {
                    return Ok(Some(location));
                }
            }
        }
    }

    if let Ok(response) = client.get("https://ipapi.co/json/").send().await {
        if let Ok(data) = response.json::<IpApiResponse>().await {
            if data.error != Some(true) {
                if let Some(location) = to_location(data.city, data.region, data.latitude, data.longitude) {
                    return Ok(Some(location));
                }
            }
        }
    }

    Ok(None)
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
        .invoke_handler(tauri::generate_handler![
            locate_system,
            locate_direct,
            start_drag,
            set_always_on_top,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running metimes");
}
