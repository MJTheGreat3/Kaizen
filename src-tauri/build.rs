fn main() {
    // OAuth clients a build may bake in (see keys.rs); published builds don't.
    println!("cargo:rerun-if-env-changed=KAIZEN_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=KAIZEN_GOOGLE_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=KAIZEN_SPOTIFY_CLIENT_ID");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        widget_center();
    }
    tauri_build::build()
}

/// Builds macos/WidgetCenter.swift (asks WidgetKit to redraw the desktop
/// widgets) into a static library and links it with the Swift runtime.
fn widget_center() {
    use std::process::Command;
    let source = "macos/WidgetCenter.swift";
    println!("cargo:rerun-if-changed={source}");
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("x86_64") => "x86_64",
        _ => "arm64",
    };
    let status = Command::new("xcrun")
        .args([
            "swiftc",
            "-emit-library",
            "-static",
            "-parse-as-library",
            "-O",
        ])
        .args(["-module-name", "KaizenWidgetCenter"])
        .args(["-target", &format!("{arch}-apple-macos11.0")])
        .arg("-o")
        .arg(out.join("libkaizen_widget_center.a"))
        .arg(source)
        .status()
        .expect("swiftc (Xcode) is needed to build for macOS");
    assert!(status.success(), "building {source} failed");
    let toolchain = Command::new("xcrun")
        .args(["--find", "swiftc"])
        .output()
        .expect("xcrun");
    let swiftc = std::path::PathBuf::from(String::from_utf8_lossy(&toolchain.stdout).trim());
    let swift_lib = swiftc
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("lib/swift/macosx");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-search=native={}", swift_lib.display());
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    println!("cargo:rustc-link-lib=static=kaizen_widget_center");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rustc-link-arg=-Wl,-weak_framework,WidgetKit");
}
