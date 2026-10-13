package com.matt.kaizen.focus

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class StartArgs {
  var sessionId: String = ""
  var title: String = "Focus session"
  var endsAt: Long = 0
  var strict: Boolean = false
  var dnd: Boolean = false
  var graceSeconds: Int = 10
}

@InvokeArg
class PauseArgs {
  var remainingMs: Long = 0
}

@InvokeArg
class ResumeArgs {
  var endsAt: Long = 0
}

/** Commands behind `plugin:focus|…`; the work happens in [FocusService]. */
@TauriPlugin
class FocusPlugin(private val activity: Activity) : Plugin(activity) {
  private val context: Context get() = activity.applicationContext
  private val state by lazy { FocusState(context) }

  @Command
  fun start(invoke: Invoke) {
    val args = invoke.parseArgs(StartArgs::class.java)
    state.clearEvents()
    state.sessionId = args.sessionId
    state.title = args.title
    state.endsAt = args.endsAt
    state.pausedRemaining = -1
    state.strict = args.strict
    state.dnd = args.dnd
    state.graceSeconds = args.graceSeconds
    state.active = true
    FocusService.send(context, FocusService.ACTION_START)
    invoke.resolve()
  }

  @Command
  fun pause(invoke: Invoke) {
    val args = invoke.parseArgs(PauseArgs::class.java)
    if (state.active) {
      state.pausedRemaining = args.remainingMs
      FocusService.send(context, FocusService.ACTION_UPDATE)
    }
    invoke.resolve()
  }

  @Command
  fun resume(invoke: Invoke) {
    val args = invoke.parseArgs(ResumeArgs::class.java)
    if (state.active) {
      state.endsAt = args.endsAt
      state.pausedRemaining = -1
      FocusService.send(context, FocusService.ACTION_UPDATE)
    }
    invoke.resolve()
  }

  @Command
  fun stop(invoke: Invoke) {
    if (state.active) FocusService.send(context, FocusService.ACTION_STOP)
    state.active = false
    invoke.resolve()
  }

  @Command
  fun drainEvents(invoke: Invoke) {
    val result = JSObject()
    result.put("events", state.drainEvents())
    invoke.resolve(result)
  }

  @Command
  fun access(invoke: Invoke) {
    val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val result = JSObject()
    result.put("usage", FocusService.hasUsageAccess(context))
    result.put("dnd", Build.VERSION.SDK_INT < 23 || notifications.isNotificationPolicyAccessGranted)
    invoke.resolve(result)
  }

  @Command
  fun openUsageSettings(invoke: Invoke) {
    val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
    // Android 10+ can jump straight to Kaizen's entry.
    if (Build.VERSION.SDK_INT >= 29) intent.data = Uri.parse("package:${context.packageName}")
    launch(intent, Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
    invoke.resolve()
  }

  @Command
  fun openDndSettings(invoke: Invoke) {
    launch(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS), null)
    invoke.resolve()
  }

  private fun launch(intent: Intent, fallback: Intent?) {
    try {
      activity.startActivity(intent)
    } catch (e: Exception) {
      if (fallback != null) activity.startActivity(fallback)
    }
  }
}
