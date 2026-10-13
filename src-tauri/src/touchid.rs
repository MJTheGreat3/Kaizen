//! Touch ID on macOS, gating the quick-unlock key in the keychain. Falls
//! back to the Mac's login password when Touch ID is unavailable or fails.

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::{NSError, NSString};
use objc2_local_authentication::{LAContext, LAPolicy};

/// True when this Mac has Touch ID set up.
pub fn available() -> bool {
    let context = unsafe { LAContext::new() };
    unsafe { context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics) }
        .is_ok()
}

/// Shows the system prompt (Touch ID, or the login password) and blocks
/// until it is answered. Must not be called on the main thread.
pub fn prompt(reason: &str) -> bool {
    let context = unsafe { LAContext::new() };
    let (tx, rx) = std::sync::mpsc::channel();
    let reply = RcBlock::new(move |ok: Bool, _error: *mut NSError| {
        let _ = tx.send(ok.as_bool());
    });
    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthentication,
            &NSString::from_str(reason),
            &reply,
        )
    };
    rx.recv().unwrap_or(false)
}
