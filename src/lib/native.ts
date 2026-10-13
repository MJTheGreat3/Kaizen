/**
 * Small wrappers over platform plugins so callers never deal with plugins
 * that are not registered on the current platform.
 */
import { log } from "./log";

/** True when the device has enrolled biometrics (Android only). */
export async function biometricAvailable(): Promise<boolean> {
  try {
    const { checkStatus } = await import("@tauri-apps/plugin-biometric");
    const status = await checkStatus();
    return status.isAvailable;
  } catch {
    return false;
  }
}

/** Shows the system biometric prompt. Resolves true on success. */
export async function biometricPrompt(reason: string): Promise<boolean> {
  try {
    const { authenticate } = await import("@tauri-apps/plugin-biometric");
    await authenticate(reason, {
      allowDeviceCredential: true,
      title: "Unlock Kaizen",
      cancelTitle: "Use passphrase",
    });
    return true;
  } catch (e) {
    log.info(`biometric prompt not completed: ${String(e)}`);
    return false;
  }
}

/** Folder picker (desktop). Returns null when cancelled or unsupported. */
export async function pickFolder(title: string): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({ directory: true, multiple: false, title });
    return typeof result === "string" ? result : null;
  } catch (e) {
    log.warn(`folder picker failed: ${String(e)}`);
    return null;
  }
}
