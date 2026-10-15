package com.matt.kaizen

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** Reads `widget-app.json` (streaks and Up next, written by the app) and shared widget bits. */
object WidgetFeed {
  fun read(context: Context): JSONObject? = try {
    val file = File(context.dataDir, "widget-app.json")
    if (file.exists()) JSONObject(file.readText()) else null
  } catch (e: Exception) {
    null
  }

  fun streaks(context: Context): JSONArray = read(context)?.optJSONArray("streaks") ?: JSONArray()

  fun streak(context: Context, id: String): JSONObject? {
    val all = streaks(context)
    for (i in 0 until all.length()) if (all.getJSONObject(i).optString("id") == id) return all.getJSONObject(i)
    return null
  }

  fun color(hex: String?, fallback: Int): Int = try {
    if (hex.isNullOrEmpty()) fallback else Color.parseColor(hex)
  } catch (e: Exception) {
    fallback
  }

  /** Opens Kaizen, optionally at a shortcut's page or quick capture. */
  fun openApp(context: Context, request: Int, kind: String? = null): PendingIntent {
    val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (kind != null) intent.setAction(Native.ACTION_CAPTURE).putExtra(Native.EXTRA_KIND, kind)
    return PendingIntent.getActivity(context, request, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  /**
   * When an Up next item happens, as on Today: "Live", "in 3 h 20 min"
   * within twelve hours, otherwise "Thu 15 Oct, 7:30 pm"; dates without a
   * time read "Today" or "Sat 17 Oct".
   */
  fun whenText(at: Long, live: Boolean, allDay: Boolean, now: Long = System.currentTimeMillis()): String {
    if (live) return "Live"
    val day = SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(at)
    if (allDay) {
      val a = Calendar.getInstance().apply { timeInMillis = at }
      val b = Calendar.getInstance().apply { timeInMillis = now }
      val same = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
      return if (same) "Today" else day
    }
    val minutes = ((at - now) / 60_000).toInt()
    if (minutes <= 0) return "now"
    if (minutes <= 12 * 60) {
      val h = minutes / 60
      val m = minutes % 60
      return "in " + listOfNotNull(if (h > 0) "$h h" else null, if (m > 0 || h == 0) "$m min" else null).joinToString(" ")
    }
    return "$day, " + SimpleDateFormat("h:mm a", Locale.getDefault()).format(at).lowercase()
  }
}
