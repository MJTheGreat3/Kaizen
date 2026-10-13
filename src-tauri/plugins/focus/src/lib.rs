//! Kaizen's focus service on Android. Every command is implemented in
//! Kotlin (`android/`), and Tauri routes `plugin:focus|…` calls straight to
//! it; on other platforms the plugin does nothing.

use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("focus")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("com.matt.kaizen.focus", "FocusPlugin")?;
            Ok(())
        })
        .build()
}
