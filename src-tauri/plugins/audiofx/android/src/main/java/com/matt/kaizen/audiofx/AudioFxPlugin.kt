package com.matt.kaizen.audiofx

import android.Manifest
import android.app.Activity
import android.webkit.WebView
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class EqArgs {
  var enabled: Boolean = false
  var gains: DoubleArray = DoubleArray(0)
  var preset: String = "Custom"
}

/** Commands behind `plugin:audiofx|…`; the effects live in [AudioFx]. */
@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "record")])
class AudioFxPlugin(private val activity: Activity) : Plugin(activity) {
  override fun load(webView: WebView) {
    AudioFx.init(activity.applicationContext)
  }

  /** Permission, the session effects use, and the equaliser's bands. */
  @Command
  fun state(invoke: Invoke) {
    val info = AudioFx.eqInfo()
    val result = JSObject()
    result.put("record", getPermissionState("record") == PermissionState.GRANTED)
    result.put("session", AudioFx.session)
    result.put("spotifySession", AudioFx.session != 0)
    val centers = JSArray()
    info.centers.forEach { centers.put(it) }
    result.put("eqBands", centers)
    result.put("eqMin", info.min)
    result.put("eqMax", info.max)
    result.put("eqOn", AudioFx.eqOn)
    result.put("eqError", info.error)
    invoke.resolve(result)
  }

  @Command
  fun visualizerStart(invoke: Invoke) {
    if (getPermissionState("record") != PermissionState.GRANTED) {
      invoke.reject("Microphone permission is needed to read what is playing")
      return
    }
    val error = AudioFx.startVisualizer()
    if (error != null) invoke.reject(error) else invoke.resolve()
  }

  @Command
  fun visualizerStop(invoke: Invoke) {
    AudioFx.stopVisualizer()
    invoke.resolve()
  }

  @Command
  fun visualizerFrame(invoke: Invoke) {
    val (bands, age) = AudioFx.frame()
    val list = JSArray()
    bands.forEach { list.put(it.toDouble()) }
    val result = JSObject()
    result.put("bands", list)
    result.put("age", age)
    invoke.resolve(result)
  }

  @Command
  fun eqSet(invoke: Invoke) {
    val args = invoke.parseArgs(EqArgs::class.java)
    val error = AudioFx.setEq(args.enabled, args.gains)
    val context = activity.applicationContext
    if (args.enabled && error == null) EqService.start(context, args.preset) else EqService.stop(context)
    if (error != null) invoke.reject(error) else invoke.resolve()
  }
}
