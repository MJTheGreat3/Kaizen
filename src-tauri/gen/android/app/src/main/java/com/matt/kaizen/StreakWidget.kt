package com.matt.kaizen

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * The chosen streaks as a carousel moving on every few seconds; tapping a
 * card opens its page in Kaizen. Which streaks, and how fast, is picked
 * when the widget is added (long-press it to change).
 */
class StreakWidget : AppWidgetProvider() {
  companion object {
    private const val PREFS = "streak-widgets"

    /** Choices for moving on, in seconds. */
    val INTERVALS = intArrayOf(4, 6, 10, 20, 60)

    fun choose(context: Context, widgetId: Int, ids: List<String>, seconds: Int) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("w$widgetId", ids.joinToString("\n"))
        .putInt("i$widgetId", seconds)
        .apply()
    }

    /** A layout per pace: a widget cannot change a flipper's timing remotely. */
    private fun layout(seconds: Int) = when (seconds) {
      4 -> R.layout.widget_streak_4
      10 -> R.layout.widget_streak_10
      20 -> R.layout.widget_streak_20
      60 -> R.layout.widget_streak_60
      else -> R.layout.widget_streak_6
    }

    fun interval(context: Context, widgetId: Int): Int =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("i$widgetId", 6).takeIf { it in INTERVALS } ?: 6

    /** The page in Kaizen a streak belongs to. */
    private fun page(id: String): String = when {
      id.startsWith("habit:") || id == "type:habits" -> "habits"
      id == "type:gym" -> "fitness"
      id == "type:cp" || id == "type:github" -> "practice"
      id == "type:focus" -> "focus"
      id == "type:sports" -> "sports"
      id == "type:tasks" || id == "type:reading" -> "lists"
      id == "type:classes" -> "calendar"
      else -> "activity"
    }

    fun chosen(context: Context, widgetId: Int): List<String> =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("w$widgetId", null)
        ?.split("\n")?.filter { it.isNotEmpty() } ?: emptyList()

    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, StreakWidget::class.java))
      for (id in ids) render(context, manager, id)
    }

    private fun card(context: Context, s: JSONObject, page: String): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.widget_streak_item)
      val color = WidgetFeed.color(s.optString("color"), context.getColor(R.color.widget_accent))
      val current = s.optInt("current")
      val unit = s.optString("unit", "days")
      val doneNow = s.optBoolean("doneNow")
      v.setTextViewText(R.id.streak_name, s.optString("name"))
      v.setTextViewText(R.id.streak_count, current.toString())
      v.setTextViewText(R.id.streak_unit, if (current == 1) unit.removeSuffix("s") else unit)
      v.setInt(R.id.streak_flame, "setColorFilter", color)
      v.setFloat(R.id.streak_flame, "setAlpha", if (doneNow) 1f else 0.4f)
      val now = if (unit == "weeks") "this week" else "today"
      v.setTextViewText(R.id.streak_best, (if (doneNow) "Done $now" else "Not yet $now") + " · best ${s.optInt("best")}")
      v.setTextViewText(R.id.streak_page, page)
      val id = s.optString("id")
      v.setOnClickPendingIntent(R.id.streak_item, WidgetFeed.openApp(context, 100 + (id.hashCode() and 0xffff), "page:${page(id)}"))
      return v
    }

    fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val streaks = chosen(context, widgetId).mapNotNull { WidgetFeed.streak(context, it) }
      val views = RemoteViews(context.packageName, layout(interval(context, widgetId)))
      if (streaks.isEmpty()) {
        views.setViewVisibility(R.id.streak_flipper, View.GONE)
        views.setViewVisibility(R.id.streak_empty, View.VISIBLE)
        views.setTextViewText(R.id.streak_empty, if (WidgetFeed.read(context) == null) "Open Kaizen to fill this in" else "Long-press to pick streaks")
        views.setOnClickPendingIntent(R.id.streak_empty, WidgetFeed.openApp(context, 10, "page:activity"))
        manager.updateAppWidget(widgetId, views)
        return
      }
      views.setViewVisibility(R.id.streak_flipper, View.VISIBLE)
      views.setViewVisibility(R.id.streak_empty, View.GONE)
      views.removeAllViews(R.id.streak_flipper)
      streaks.forEachIndexed { i, s -> views.addView(R.id.streak_flipper, card(context, s, if (streaks.size > 1) "${i + 1} of ${streaks.size}" else "")) }
      manager.updateAppWidget(widgetId, views)
    }
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) render(context, manager, id)
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    for (id in ids) prefs.remove("w$id")
    prefs.apply()
  }
}

/** Asked when a streak widget is added (or long-pressed): which streaks it cycles through. */
class StreakConfigActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return finish()

    val all = WidgetFeed.streaks(this)
    if (all.length() == 0) {
      AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
        .setTitle("No streaks yet")
        .setMessage("Open Kaizen once (unlocked) so the widget can see your streaks, then add it again.")
        .setPositiveButton("OK") { _, _ -> finish() }
        .setOnCancelListener { finish() }
        .show()
      return
    }
    val ids = List(all.length()) { all.getJSONObject(it).optString("id") }
    val names = Array(all.length()) { i ->
      val s = all.getJSONObject(i)
      "${s.optString("name")}  ·  ${s.optInt("current")} ${s.optString("unit", "days")}"
    }
    val before = StreakWidget.chosen(this, widgetId)
    // Nothing chosen yet: start with "Any activity" ticked.
    val checked = BooleanArray(ids.size) { if (before.isEmpty()) it == 0 else ids[it] in before }
    AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
      .setTitle("Streaks to show")
      .setMultiChoiceItems(names, checked) { _, which, on -> checked[which] = on }
      .setPositiveButton("Next") { _, _ ->
        val picked = ids.filterIndexed { i, _ -> checked[i] }.ifEmpty { listOf(ids[0]) }
        if (picked.size == 1) save(widgetId, picked, StreakWidget.interval(this, widgetId)) else askInterval(widgetId, picked)
      }
      .setNegativeButton("Cancel") { _, _ -> finish() }
      .setOnCancelListener { finish() }
      .show()
  }

  /** How often the carousel moves on by itself. */
  private fun askInterval(widgetId: Int, picked: List<String>) {
    val options = StreakWidget.INTERVALS
    val labels = options.map { if (it < 60) "Every $it seconds" else "Every minute" }.toTypedArray()
    var choice = options.indexOf(StreakWidget.interval(this, widgetId)).coerceAtLeast(0)
    AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
      .setTitle("Move to the next streak")
      .setSingleChoiceItems(labels, choice) { _, which -> choice = which }
      .setPositiveButton("Done") { _, _ -> save(widgetId, picked, options[choice]) }
      .setNegativeButton("Cancel") { _, _ -> finish() }
      .setOnCancelListener { finish() }
      .show()
  }

  private fun save(widgetId: Int, picked: List<String>, seconds: Int) {
    StreakWidget.choose(this, widgetId, picked, seconds)
    StreakWidget.render(this, AppWidgetManager.getInstance(this), widgetId)
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
    finish()
  }
}
