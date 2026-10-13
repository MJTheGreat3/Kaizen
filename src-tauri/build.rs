fn main() {
    // Google Drive sync's OAuth client, baked in at build time (see sync/drive.rs).
    println!("cargo:rerun-if-env-changed=KAIZEN_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=KAIZEN_GOOGLE_CLIENT_SECRET");
    tauri_build::build()
}
