const COMMANDS: &[&str] = &[
    "start",
    "pause",
    "resume",
    "stop",
    "drain_events",
    "access",
    "open_usage_settings",
    "open_dnd_settings",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
