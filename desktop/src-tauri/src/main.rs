//! The Appalachian Bitcoin desktop app.
//!
//! The window starts the bundled engine (the same Python engine the Docker install
//! runs), waits until it answers, then shows the ledger from it. The engine listens only
//! on this computer. When the app quits, the engine's input closes and it stops cleanly.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// One fixed port, so the interface's saved layouts (kept per address) survive restarts.
const PREFERRED_PORT: u16 = 47821;
const STARTUP_LIMIT: Duration = Duration::from_secs(90);

struct Engine(Mutex<Option<Child>>);

/// Set once the engine answers. From then on the window stays on the ledger.
static LEDGER_PORT: OnceLock<u16> = OnceLock::new();

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch brings the open window forward instead of starting a second engine.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Appalachian Bitcoin")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .background_color(tauri::window::Color(7, 14, 19, 255))
                .on_navigation(allow_navigation)
                .on_download(|_webview, event| {
                    // Backups and exports go to Downloads, as in a browser.
                    matches!(event, DownloadEvent::Requested { .. } | DownloadEvent::Finished { .. })
                })
                .build()?;
            let handle = app.handle().clone();
            thread::spawn(move || start_engine(handle, window));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the app could not start");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_engine(app);
        }
    });
}

fn start_engine(app: AppHandle, window: WebviewWindow) {
    match launch(&app) {
        Ok(port) => {
            let _ = LEDGER_PORT.set(port);
            let url = Url::parse(&format!("http://127.0.0.1:{port}/")).expect("valid address");
            let _ = window.navigate(url);
        }
        Err(problem) => {
            let script = format!(
                "window.showProblem({}, {})",
                js_string("The ledger could not start. Quit the app and open it again. If this keeps happening, send us the file below."),
                js_string(&problem)
            );
            let _ = window.eval(script);
        }
    }
}

/// Keep the window on the ledger. A back keystroke or swipe must not return to the
/// loading screen, and links to other sites open in the person's own browser.
fn allow_navigation(url: &Url) -> bool {
    let Some(&port) = LEDGER_PORT.get() else {
        return true; // still on the loading screen
    };
    let ledger = url.host_str() == Some("127.0.0.1") && url.port() == Some(port);
    if !ledger && matches!(url.scheme(), "http" | "https") {
        open_in_browser(url.as_str());
    }
    ledger
}

fn open_in_browser(address: &str) {
    #[cfg(target_os = "macos")]
    let _ = Command::new("/usr/bin/open").arg(address).spawn();
    #[cfg(windows)]
    let _ = Command::new("explorer").arg(address).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = Command::new("xdg-open").arg(address).spawn();
}

fn launch(app: &AppHandle) -> Result<u16, String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data).map_err(|e| format!("{}: {e}", data.display()))?;
    let log_path = data.join("engine.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("{}: {e}", log_path.display()))?;
    let engine = engine_path(app)?;
    let port = pick_port();

    let child = Command::new(&engine)
        .arg("--port")
        .arg(port.to_string())
        .arg("--data-dir")
        .arg(&data)
        .stdin(Stdio::piped())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .spawn()
        .map_err(|e| format!("{}: {e}", engine.display()))?;
    let state = app.state::<Engine>();
    *state.0.lock().unwrap() = Some(child);

    let started = Instant::now();
    loop {
        if healthy(port) {
            return Ok(port);
        }
        if let Some(child) = state.0.lock().unwrap().as_mut() {
            if let Ok(Some(_status)) = child.try_wait() {
                return Err(log_path.display().to_string());
            }
        }
        if started.elapsed() > STARTUP_LIMIT {
            return Err(log_path.display().to_string());
        }
        thread::sleep(Duration::from_millis(150));
    }
}

fn engine_path(app: &AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "ledger-engine.exe" } else { "ledger-engine" };
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let path = resources.join("engine").join(name);
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("missing {}", path.display()))
    }
}

fn pick_port() -> u16 {
    if TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).is_ok() {
        return PREFERRED_PORT;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(PREFERRED_PORT)
}

fn healthy(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut reply = String::new();
    let _ = stream.read_to_string(&mut reply);
    reply.starts_with("HTTP/1.1 200") && reply.contains("\"ok\"")
}

/// Close the engine's input so it finishes writing and stops; force it only if it hangs.
fn stop_engine(app: &AppHandle) {
    let Some(mut child) = app.state::<Engine>().0.lock().unwrap().take() else {
        return;
    };
    drop(child.stdin.take());
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn js_string(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '<' => out.push_str("\\u003c"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
