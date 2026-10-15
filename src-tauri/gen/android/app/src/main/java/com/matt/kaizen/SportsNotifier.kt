package com.matt.kaizen

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Sports notifications on Android: reminders before followed teams' games,
 * results, and favourite players' performances, each with a Mute button.
 *
 * Rust calls these over JNI (the app's class loader); the background worker
 * posts what its Rust round returns. Muting appends to `pending-mutes` in
 * the data folder, which Rust moves into the synced `sport_mutes` table the
 * next time the database is open, so it needs no unlock.
 */
object SportsNotifier {
  private const val CHANNEL = "sports"
  private const val PREFS = "kaizen.sports"
  private const val SCHEDULED = "scheduled"
  const val ACTION_POST = "com.matt.kaizen.SPORTS_POST"
  const val ACTION_MUTE = "com.matt.kaizen.SPORTS_MUTE"

  private fun channel(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = context.getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(CHANNEL) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL, "Sports", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Game reminders, results and player performances"
          })
      }
    }
  }

  fun notificationId(key: String): Int = key.hashCode() and 0x7fffffff

  private fun JSONObject.text(name: String): String? = if (isNull(name)) null else optString(name).ifEmpty { null }

  /** Shows a notification now. */
  @JvmStatic
  fun post(context: Context, key: String, title: String, body: String, muteId: String?, url: String?) {
    channel(context)
    val id = notificationId(key)
    val open = if (url != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(url))
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName)
    }
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_sports)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
    if (open != null) {
      builder.setContentIntent(PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    if (muteId != null) {
      val mute = Intent(context, SportsReceiver::class.java).apply {
        action = ACTION_MUTE
        putExtra("muteId", muteId)
        putExtra("title", title)
        putExtra("notificationId", id)
      }
      builder.addAction(0, "Mute", PendingIntent.getBroadcast(context, id, mute, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    try {
      NotificationManagerCompat.from(context).notify(id, builder.build())
    } catch (e: SecurityException) {
      // Notifications not allowed.
    }
  }

  /** Posts a JSON list of alerts: [{key, title, body, muteId, url}]. */
  @JvmStatic
  fun postAll(context: Context, json: String): String {
    val list = JSONArray(json)
    for (i in 0 until list.length()) {
      val a = list.getJSONObject(i)
      post(context, a.getString("key"), a.getString("title"), a.getString("body"), a.text("muteId"), a.text("url"))
    }
    return ""
  }

  private fun alarmIntent(context: Context, key: String, extras: Intent.() -> Unit = {}): PendingIntent {
    val intent = Intent(context, SportsReceiver::class.java).apply {
      action = ACTION_POST
      data = Uri.parse("kaizen-sports://$key")
      extras()
    }
    return PendingIntent.getBroadcast(context, notificationId(key), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  /** Replaces the scheduled game reminders with a JSON list: [{key, at, title, body, muteId, url}]. */
  @JvmStatic
  fun scheduleAll(context: Context, json: String): String {
    val alarms = context.getSystemService(AlarmManager::class.java)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    for (key in prefs.getStringSet(SCHEDULED, emptySet()) ?: emptySet()) {
      alarms.cancel(alarmIntent(context, key))
    }
    val keys = mutableSetOf<String>()
    val list = JSONArray(json)
    for (i in 0 until list.length()) {
      val a = list.getJSONObject(i)
      val key = a.getString("key")
      val at = a.getLong("at")
      if (at <= System.currentTimeMillis()) continue
      val pending = alarmIntent(context, key) {
        putExtra("key", key)
        putExtra("title", a.getString("title"))
        putExtra("body", a.getString("body"))
        putExtra("muteId", a.text("muteId") ?: "")
        putExtra("url", a.text("url") ?: "")
      }
      try {
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
      } catch (e: SecurityException) {
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
      }
      keys.add(key)
    }
    prefs.edit().putStringSet(SCHEDULED, keys).apply()
    return ""
  }

  /** Mutes waiting for Rust: one id and title per line. */
  fun pendingMutes(context: Context): File = File(context.dataDir, "pending-mutes")
}

class SportsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      SportsNotifier.ACTION_POST -> {
        val muteId = intent.getStringExtra("muteId")?.ifEmpty { null }
        // A game muted since it was scheduled stays quiet.
        if (muteId != null && SportsNotifier.pendingMutes(context).takeIf { it.exists() }?.readLines()?.any { it.startsWith("$muteId\t") } == true) return
        SportsNotifier.post(
          context,
          intent.getStringExtra("key") ?: return,
          intent.getStringExtra("title") ?: return,
          intent.getStringExtra("body") ?: "",
          muteId,
          intent.getStringExtra("url")?.ifEmpty { null },
        )
      }
      SportsNotifier.ACTION_MUTE -> {
        val muteId = intent.getStringExtra("muteId") ?: return
        val title = (intent.getStringExtra("title") ?: "").replace('\n', ' ').replace('\t', ' ')
        SportsNotifier.pendingMutes(context).appendText("$muteId\t$title\n")
        NotificationManagerCompat.from(context).cancel(intent.getIntExtra("notificationId", 0))
      }
    }
  }
}
