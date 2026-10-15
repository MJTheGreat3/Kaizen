//! The laptop app keeps running when its window is closed, with an icon in
//! the menu bar, so reminders still fire and quick capture works from any
//! app through a global shortcut ([`CAPTURE_SHORTCUT`]).

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const CAPTURE_SHORTCUT: &str = "CommandOrControl+Shift+Space";

/// Shows and focuses the main window.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Opens the window with quick capture on top.
fn capture(app: &AppHandle) {
    show(app);
    let _ = app.emit("capture://open", "");
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let handle = app.handle();
    let open = MenuItem::with_id(handle, "open", "Open Kaizen", true, None::<&str>)?;
    let quick = MenuItem::with_id(
        handle,
        "capture",
        "Quick capture",
        true,
        Some(CAPTURE_SHORTCUT),
    )?;
    let quit = MenuItem::with_id(
        handle,
        "quit",
        "Quit Kaizen",
        true,
        Some("CommandOrControl+Q"),
    )?;
    let menu = Menu::with_items(
        handle,
        &[
            &open,
            &quick,
            &PredefinedMenuItem::separator(handle)?,
            &quit,
        ],
    )?;
    let mut tray = TrayIconBuilder::with_id("kaizen")
        .tooltip("Kaizen")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "capture" => capture(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone()).icon_as_template(false);
    }
    tray.build(app)?;

    handle.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    capture(app);
                }
            })
            .build(),
    )?;
    if let Err(e) = handle.global_shortcut().register(CAPTURE_SHORTCUT) {
        tracing::warn!(error = %e, "could not register the quick capture shortcut");
    }

    // Closing the window hides it; Quit (menu bar or ⌘Q) ends the app.
    if let Some(window) = app.get_webview_window("main") {
        let w = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = w.hide();
            }
        });
    }
    Ok(())
}
