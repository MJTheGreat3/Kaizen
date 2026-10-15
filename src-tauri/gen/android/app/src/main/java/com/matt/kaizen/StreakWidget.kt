package com.matt.kaizen

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * The chosen streaks as a carousel: it moves to the next one every few
 * seconds and on a tap. Which streaks is picked when the widget is added
 * (long-press it to change them).
 */
class StreakWidget : AppWidgetProvider() {
  companion object {
    private const val PREFS = "streak-widgets"
    private const val ACTION_NEXT = "com.matt.kaizen.STREAK_NEXT"

    fun choose(context: Context, widgetId: Int, ids: List<String>) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("w$widgetId", ids.joinToString("\n")).apply()
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
      v.setOnClickFillInIntent(R.id.streak_item, Intent())
      return v
    }

    fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val views = RemoteViews(context.packageName, R.layout.widget_streak)
      val streaks = chosen(context, widgetId).mapNotNull { WidgetFeed.streak(context, it) }
      if (streaks.isEmpty() || Build.VERSION.SDK_INT < 31) {
        views.setViewVisibility(R.id.streak_flipper, View.GONE)
        views.setViewVisibility(R.id.streak_empty, View.VISIBLE)
        views.setTextViewText(R.id.streak_empty, if (WidgetFeed.read(context) == null) "Open Kaizen to fill this in" else "Long-press to pick streaks")
        views.setOnClickPendingIntent(R.id.streak_empty, WidgetFeed.openApp(context, 10, "activity"))
        manager.updateAppWidget(widgetId, views)
        return
      }
      val items = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1)
      streaks.forEachIndexed { i, s -> items.addItem(i.toLong(), card(context, s, if (streaks.size > 1) "${i + 1} of ${streaks.size}" else "")) }
      views.setViewVisibility(R.id.streak_flipper, View.VISIBLE)
      views.setViewVisibility(R.id.streak_empty, View.GONE)
      views.setRemoteAdapter(R.id.streak_flipper, items.build())
      // A tap moves to the next streak.
      val next = Intent(context, StreakWidget::class.java).setAction(ACTION_NEXT).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      views.setPendingIntentTemplate(
        R.id.streak_flipper,
        PendingIntent.getBroadcast(context, widgetId, next, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
      )
      manager.updateAppWidget(widgetId, views)
    }
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) render(context, manager, id)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action != ACTION_NEXT) return
    val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
    val views = RemoteViews(context.packageName, R.layout.widget_streak)
    views.showNext(R.id.streak_flipper)
    AppWidgetManager.getInstance(context).partiallyUpdateAppWidget(id, views)
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
      .setPositiveButton("Done") { _, _ ->
        val picked = ids.filterIndexed { i, _ -> checked[i] }.ifEmpty { listOf(ids[0]) }
        StreakWidget.choose(this, widgetId, picked)
        StreakWidget.render(this, AppWidgetManager.getInstance(this), widgetId)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
      }
      .setNegativeButton("Cancel") { _, _ -> finish() }
      .setOnCancelListener { finish() }
      .show()
  }
}
