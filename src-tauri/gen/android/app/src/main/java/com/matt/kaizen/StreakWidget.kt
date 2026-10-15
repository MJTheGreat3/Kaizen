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

/** One streak on the home screen; which one is picked when the widget is added. */
class StreakWidget : AppWidgetProvider() {
  companion object {
    private const val PREFS = "streak-widgets"

    fun choose(context: Context, widgetId: Int, streakId: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("w$widgetId", streakId).apply()
    }

    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, StreakWidget::class.java))
      for (id in ids) render(context, manager, id)
    }

    fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val views = RemoteViews(context.packageName, R.layout.widget_streak)
      views.setOnClickPendingIntent(R.id.streak_root, WidgetFeed.openApp(context, 10, "activity"))
      val id = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("w$widgetId", null)
      val s = id?.let { WidgetFeed.streak(context, it) }
      if (s == null) {
        views.setTextViewText(R.id.streak_name, "Streak")
        views.setTextViewText(R.id.streak_count, "–")
        views.setTextViewText(R.id.streak_unit, if (id == null) "pick one" else "open Kaizen")
        views.setViewVisibility(R.id.streak_best, View.GONE)
        manager.updateAppWidget(widgetId, views)
        return
      }
      val color = WidgetFeed.color(s.optString("color"), context.getColor(R.color.widget_accent))
      val current = s.optInt("current")
      val unit = s.optString("unit", "days")
      val doneNow = s.optBoolean("doneNow")
      views.setTextViewText(R.id.streak_name, s.optString("name"))
      views.setTextViewText(R.id.streak_count, current.toString())
      views.setTextViewText(R.id.streak_unit, if (current == 1) unit.removeSuffix("s") else unit)
      views.setInt(R.id.streak_flame, "setColorFilter", color)
      views.setFloat(R.id.streak_flame, "setAlpha", if (doneNow) 1f else 0.4f)
      views.setViewVisibility(R.id.streak_best, View.VISIBLE)
      views.setTextViewText(
        R.id.streak_best,
        (if (doneNow) "Done ${if (unit == "weeks") "this week" else "today"}" else if (unit == "weeks") "Not yet this week" else "Not yet today") +
          " · best ${s.optInt("best")}",
      )
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

/** Asked when a streak widget is added: which streak it shows. */
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
    val names = Array(all.length()) { i ->
      val s = all.getJSONObject(i)
      val unit = s.optString("unit", "days")
      "${s.optString("name")}  ·  ${s.optInt("current")} ${unit}"
    }
    AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
      .setTitle("Which streak?")
      .setItems(names) { _, which ->
        StreakWidget.choose(this, widgetId, all.getJSONObject(which).optString("id"))
        StreakWidget.render(this, AppWidgetManager.getInstance(this), widgetId)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
      }
      .setOnCancelListener { finish() }
      .show()
  }
}
