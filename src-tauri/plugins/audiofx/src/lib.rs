//! Kaizen's audio effects on Android: a visualiser fed by what is playing
//! (Spotify's audio session, or the whole output) and an equaliser applied
//! to it. Everything is Kotlin (`android/`); on other platforms the plugin
//! does nothing.

use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("audiofx")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("com.matt.kaizen.audiofx", "AudioFxPlugin")?;
            Ok(())
        })
        .build()
}
