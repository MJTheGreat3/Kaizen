const COMMANDS: &[&str] = &[
    "state",
    "check_permissions",
    "request_permissions",
    "visualizer_start",
    "visualizer_stop",
    "visualizer_frame",
    "eq_set",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
