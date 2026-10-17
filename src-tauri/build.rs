fn main() {
    // OAuth clients a build may bake in (see keys.rs); published builds don't.
    println!("cargo:rerun-if-env-changed=KAIZEN_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=KAIZEN_GOOGLE_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=KAIZEN_SPOTIFY_CLIENT_ID");
    tauri_build::build()
}
