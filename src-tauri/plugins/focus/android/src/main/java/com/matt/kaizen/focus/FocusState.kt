package com.matt.kaizen.focus

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * The running session as the service sees it, plus the events it recorded
 * for the app (pause/resume/give up from the notification, withered,
 * completed). Kept in SharedPreferences so it survives the app's process
 * being killed while the service runs.
 */
class FocusState(context: Context) {
  private val prefs: SharedPreferences =
    context.getSharedPreferences("kaizen_focus", Context.MODE_PRIVATE)

  var active: Boolean
    get() = prefs.getBoolean("active", false)
    set(v) = prefs.edit().putBoolean("active", v).apply()

  var sessionId: String
    get() = prefs.getString("sessionId", "") ?: ""
    set(v) = prefs.edit().putString("sessionId", v).apply()

  var title: String
    get() = prefs.getString("title", "Focus session") ?: "Focus session"
    set(v) = prefs.edit().putString("title", v).apply()

  var endsAt: Long
    get() = prefs.getLong("endsAt", 0)
    set(v) = prefs.edit().putLong("endsAt", v).apply()

  /** Time left while paused; -1 while running. */
  var pausedRemaining: Long
    get() = prefs.getLong("pausedRemaining", -1)
    set(v) = prefs.edit().putLong("pausedRemaining", v).apply()

  var strict: Boolean
    get() = prefs.getBoolean("strict", false)
    set(v) = prefs.edit().putBoolean("strict", v).apply()

  var dnd: Boolean
    get() = prefs.getBoolean("dnd", false)
    set(v) = prefs.edit().putBoolean("dnd", v).apply()

  var graceSeconds: Int
    get() = prefs.getInt("grace", 10)
    set(v) = prefs.edit().putInt("grace", v).apply()

  /** Do Not Disturb setting to restore afterwards; -1 if untouched. */
  var previousFilter: Int
    get() = prefs.getInt("previousFilter", -1)
    set(v) = prefs.edit().putInt("previousFilter", v).apply()

  val paused: Boolean
    get() = pausedRemaining >= 0

  @Synchronized
  fun addEvent(type: String, at: Long = System.currentTimeMillis()) {
    val events = JSONArray(prefs.getString("events", "[]"))
    events.put(JSONObject().put("type", type).put("at", at).put("sessionId", sessionId))
    prefs.edit().putString("events", events.toString()).apply()
  }

  @Synchronized
  fun drainEvents(): JSONArray {
    val events = JSONArray(prefs.getString("events", "[]"))
    prefs.edit().putString("events", "[]").apply()
    return events
  }

  @Synchronized
  fun clearEvents() {
    prefs.edit().putString("events", "[]").apply()
  }
}
