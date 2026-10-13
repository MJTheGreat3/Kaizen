package com.matt.kaizen.focus

import android.app.AppOpsManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Process
import android.telecom.TelecomManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Runs while a focus session is active: an ongoing countdown notification
 * with Pause / Give up, strict mode (another app in front for longer than
 * the grace period withers the tree) and Do Not Disturb. Works with the app
 * closed; what happens is recorded in [FocusState] for the app to apply.
 */
class FocusService : Service() {
  companion object {
    const val ACTION_START = "com.matt.kaizen.focus.START"
    const val ACTION_UPDATE = "com.matt.kaizen.focus.UPDATE"
    const val ACTION_STOP = "com.matt.kaizen.focus.STOP"
    const val ACTION_TOGGLE_PAUSE = "com.matt.kaizen.focus.TOGGLE_PAUSE"
    const val ACTION_GIVE_UP = "com.matt.kaizen.focus.GIVE_UP"

    private const val CHANNEL_ONGOING = "focus"
    private const val CHANNEL_ALERTS = "focus-alerts"
    private const val ID_ONGOING = 4201
    private const val ID_ALERT = 4202
    private const val TICK_MS = 1000L

    fun hasUsageAccess(context: Context): Boolean {
      val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = if (Build.VERSION.SDK_INT >= 29) {
        ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
      } else {
        @Suppress("DEPRECATION")
        ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
      }
      return mode == AppOpsManager.MODE_ALLOWED
    }

    fun send(context: Context, action: String) {
      val intent = Intent(context, FocusService::class.java).setAction(action)
      if (action == ACTION_START && Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
      else context.startService(intent)
    }
  }

  private lateinit var state: FocusState
  private val handler = Handler(Looper.getMainLooper())
  private var foregroundPackage: String? = null
  private var lastQuery = 0L
  private var awaySince: Long? = null
  private var allowed: Set<String> = emptySet()
  private val notifications by lazy { getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager }

  private val tick = object : Runnable {
    override fun run() {
      if (check()) handler.postDelayed(this, TICK_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    state = FocusState(this)
    createChannels()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> begin()
      ACTION_UPDATE -> refreshNotification()
      ACTION_TOGGLE_PAUSE -> togglePauseFromNotification()
      ACTION_GIVE_UP -> {
        state.addEvent("give_up")
        finish(null)
      }
      ACTION_STOP -> finish(null)
      else -> if (state.active) begin() else stopSelf()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    super.onDestroy()
  }

  // -------------------------------------------------------------------------

  private fun begin() {
    if (!state.active) {
      stopSelf()
      return
    }
    ServiceCompat.startForeground(
      this,
      ID_ONGOING,
      ongoing(),
      if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
    )
    allowed = allowedPackages()
    foregroundPackage = packageName
    lastQuery = System.currentTimeMillis()
    awaySince = null
    if (state.dnd) enableDnd()
    handler.removeCallbacks(tick)
    handler.post(tick)
  }

  /** One tick. Returns false once the session is over. */
  private fun check(): Boolean {
    if (!state.active) return false
    val now = System.currentTimeMillis()
    if (state.paused) {
      awaySince = null
      return true
    }
    if (now >= state.endsAt) {
      state.addEvent("completed", state.endsAt)
      finish(getString(R.string.focus_done_title) to getString(R.string.focus_done_body))
      return false
    }
    if (state.strict && hasUsageAccess(this)) {
      updateForeground(now)
      val current = foregroundPackage
      val away = current != null && current !in allowed
      if (away) {
        val since = awaySince ?: now.also {
          awaySince = it
          alert(getString(R.string.focus_away_title), getString(R.string.focus_away_body, state.graceSeconds), true)
        }
        if (now - since >= state.graceSeconds * 1000L) {
          state.addEvent("withered", now)
          finish(getString(R.string.focus_withered_title) to getString(R.string.focus_withered_body))
          return false
        }
      } else if (awaySince != null) {
        awaySince = null
        notifications.cancel(ID_ALERT)
      }
    }
    return true
  }

  /** Follows which app is in front from the usage events since the last tick. */
  private fun updateForeground(now: Long) {
    val usage = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = usage.queryEvents(lastQuery - 2000, now)
    val event = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      val resumed = if (Build.VERSION.SDK_INT >= 29) UsageEvents.Event.ACTIVITY_RESUMED else @Suppress("DEPRECATION") UsageEvents.Event.MOVE_TO_FOREGROUND
      if (event.eventType == resumed && event.timeStamp >= lastQuery - 2000) foregroundPackage = event.packageName
    }
    lastQuery = now
  }

  /** Kaizen, the home screen, the phone app and system UI never count as leaving. */
  private fun allowedPackages(): Set<String> {
    val set = mutableSetOf(packageName, "com.android.systemui", "com.android.server.telecom", "com.android.permissioncontroller")
    val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName?.let { set.add(it) }
    if (Build.VERSION.SDK_INT >= 23) {
      (getSystemService(Context.TELECOM_SERVICE) as? TelecomManager)?.defaultDialerPackage?.let { set.add(it) }
    }
    return set
  }

  private fun togglePauseFromNotification() {
    val now = System.currentTimeMillis()
    if (state.paused) {
      state.endsAt = now + state.pausedRemaining
      state.pausedRemaining = -1
      state.addEvent("resume", now)
    } else {
      state.pausedRemaining = maxOf(0, state.endsAt - now)
      state.addEvent("pause", now)
    }
    refreshNotification()
  }

  private fun finish(message: Pair<String, String>?) {
    handler.removeCallbacks(tick)
    restoreDnd()
    state.active = false
    notifications.cancel(ID_ALERT)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    if (message != null) alert(message.first, message.second, false)
    stopSelf()
  }

  // -------------------------------------------------------------------------
  // Do Not Disturb

  private fun enableDnd() {
    if (Build.VERSION.SDK_INT < 23 || !notifications.isNotificationPolicyAccessGranted) return
    if (state.previousFilter < 0) state.previousFilter = notifications.currentInterruptionFilter
    notifications.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
  }

  private fun restoreDnd() {
    if (Build.VERSION.SDK_INT < 23 || state.previousFilter < 0) return
    if (notifications.isNotificationPolicyAccessGranted) notifications.setInterruptionFilter(state.previousFilter)
    state.previousFilter = -1
  }

  // -------------------------------------------------------------------------
  // Notifications

  private fun createChannels() {
    if (Build.VERSION.SDK_INT < 26) return
    notifications.createNotificationChannel(
      NotificationChannel(CHANNEL_ONGOING, getString(R.string.focus_channel_ongoing), NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
      },
    )
    notifications.createNotificationChannel(
      NotificationChannel(CHANNEL_ALERTS, getString(R.string.focus_channel_alerts), NotificationManager.IMPORTANCE_HIGH).apply {
        // Strict-mode warnings must get through Do Not Disturb.
        setBypassDnd(true)
        enableVibration(true)
      },
    )
  }

  private fun openApp(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun serviceIntent(action: String, code: Int): PendingIntent =
    PendingIntent.getService(
      this,
      code,
      Intent(this, FocusService::class.java).setAction(action),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  private fun ongoing(): android.app.Notification {
    val builder = NotificationCompat.Builder(this, CHANNEL_ONGOING)
      .setSmallIcon(R.drawable.ic_focus_tree)
      .setContentTitle(state.title)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setContentIntent(openApp())
      .addAction(0, getString(if (state.paused) R.string.focus_resume else R.string.focus_pause), serviceIntent(ACTION_TOGGLE_PAUSE, 1))
      .addAction(0, getString(R.string.focus_give_up), serviceIntent(ACTION_GIVE_UP, 2))
    if (state.paused) {
      val minutes = (state.pausedRemaining / 60000).toInt()
      val seconds = ((state.pausedRemaining / 1000) % 60).toInt()
      builder.setContentText(getString(R.string.focus_paused_text, minutes, seconds)).setShowWhen(false)
    } else {
      builder
        .setContentText(getString(if (state.strict) R.string.focus_running_strict else R.string.focus_running))
        .setWhen(state.endsAt)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
    }
    return builder.build()
  }

  private fun refreshNotification() {
    if (state.active) notifications.notify(ID_ONGOING, ongoing())
  }

  private fun alert(title: String, body: String, urgent: Boolean) {
    val notification = NotificationCompat.Builder(this, CHANNEL_ALERTS)
      .setSmallIcon(R.drawable.ic_focus_tree)
      .setContentTitle(title)
      .setContentText(body)
      .setAutoCancel(true)
      .setPriority(if (urgent) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
      .setCategory(if (urgent) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_STATUS)
      .setContentIntent(openApp())
      .build()
    notifications.notify(ID_ALERT, notification)
  }
}
