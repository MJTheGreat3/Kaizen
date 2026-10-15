//! Calls into the app's Kotlin code from Rust, through the Android context
//! Tauri sets up.

use jni::objects::{JClass, JObject, JString, JValue};

use crate::error::{Error, Result};

fn jni_err(e: jni::errors::Error) -> Error {
    Error::Invalid(format!("Android call failed: {e}"))
}

/// Calls a static `(Context, String) -> String` method of an app class
/// (`com.matt.kaizen.<class>`), returning what it returns.
pub fn call(class: &str, method: &str, arg: &str) -> Result<String> {
    let ctx = ndk_context::android_context();
    // SAFETY: Tauri initialised the context with a live JavaVM and a global
    // reference to the application context, both valid for the process.
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(jni_err)?;
    let mut env = vm.attach_current_thread().map_err(jni_err)?;
    let context = unsafe { JObject::from_raw(ctx.context().cast()) };
    // Threads Rust started only see the system class loader; the app's
    // classes come from the context's.
    let loader = env
        .call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
        .and_then(|v| v.l())
        .map_err(jni_err)?;
    let name = env
        .new_string(format!("com.matt.kaizen.{class}"))
        .map_err(jni_err)?;
    let class = env
        .call_method(
            &loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&name)],
        )
        .and_then(|v| v.l())
        .map_err(jni_err)?;
    let class = JClass::from(class);
    let arg = env.new_string(arg).map_err(jni_err)?;
    let out = env
        .call_static_method(
            &class,
            method,
            "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::Object(&context), JValue::Object(&arg)],
        )
        .and_then(|v| v.l())
        .map_err(jni_err)?;
    if out.is_null() {
        return Ok(String::new());
    }
    let out = JString::from(out);
    let text: String = env.get_string(&out).map_err(jni_err)?.into();
    Ok(text)
}

/// Calls `SportsNotifier.<method>(context, json)`.
pub fn sports_notifier(method: &str, json: &str) -> Result<()> {
    call("SportsNotifier", method, json).map(|_| ())
}
