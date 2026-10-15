package com.matt.kaizen

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import kotlin.concurrent.thread

/**
 * Home-screen widget: today's tasks and habits. Tapping a task completes
 * it, tapping a habit ticks it; the work happens in Rust
 * (`nativeWidget`), which opens the database with the fingerprint-unlock
 * key. Without that key, taps open the app.
 */
class TodayWidget : AppWidgetProvider() {
  companion object {
    private const val TAG = "KaizenWidget"
    private const val ACTION_TAP = "com.matt.kaizen.WIDGET_TAP"
    private const val EXTRA_ACTION = "action"

    init {
      System.loadLibrary("kaizen_lib")
    }

    /** Applies `action` (`refresh`, `task:<id>`, `habit:<id>`) and returns the new snapshot. */
    @JvmStatic external fun nativeWidget(dataDir: String, action: String): String

    private fun snapshot(context: Context): JSONObject? = try {
      val file = File(context.dataDir, "widget.json")
      if (file.exists()) JSONObject(file.readText()) else null
    } catch (e: Exception) {
      null
    }

    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    private fun openApp(context: Context, request: Int, kind: String?): PendingIntent {
      val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (kind != null) intent.setAction(Native.ACTION_CAPTURE).putExtra(Native.EXTRA_KIND, kind)
      return PendingIntent.getActivity(context, request, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun color(hex: String?, fallback: Int): Int = try {
      if (hex.isNullOrEmpty()) fallback else Color.parseColor(hex)
    } catch (e: Exception) {
      fallback
    }

    fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val snap = snapshot(context)
      val muted = context.getColor(R.color.widget_muted)
      val danger = context.getColor(R.color.widget_danger)
      val accent = context.getColor(R.color.widget_accent)
      for (id in ids) {
        val views = RemoteViews(context.packageName, R.layout.widget_today)
        views.setOnClickPendingIntent(R.id.widget_title, openApp(context, 1, null))
        views.setOnClickPendingIntent(R.id.widget_add_task, openApp(context, 2, "task"))
        views.setOnClickPendingIntent(R.id.widget_add_idea, openApp(context, 3, "idea"))

        val today = LocalDate.now().toString()
        if (snap == null || snap.optString("date") != today && !snap.optBoolean("live")) {
          views.setTextViewText(R.id.widget_date, "Today")
          views.setTextViewText(R.id.widget_sub, if (snap == null) "Open Kaizen to fill this in" else "Open Kaizen to bring this up to date")
          views.setViewVisibility(R.id.widget_list, View.GONE)
          views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
          views.setTextViewText(R.id.widget_empty, "Tap to open Kaizen")
          views.setOnClickPendingIntent(R.id.widget_empty, openApp(context, 1, null))
          manager.updateAppWidget(id, views)
          continue
        }

        val tasks = snap.optJSONArray("tasks")
        val habits = snap.optJSONArray("habits")
        val more = snap.optInt("moreTasks")
        val taskCount = (tasks?.length() ?: 0) + more
        val habitsDone = (0 until (habits?.length() ?: 0)).count { habits!!.getJSONObject(it).optBoolean("done") }
        views.setTextViewText(R.id.widget_date, snap.optString("label", "Today"))
        val parts = mutableListOf<String>()
        if (taskCount > 0) parts.add("$taskCount ${if (taskCount == 1) "task" else "tasks"}")
        if ((habits?.length() ?: 0) > 0) parts.add("$habitsDone of ${habits!!.length()} habits")
        views.setTextViewText(R.id.widget_sub, if (parts.isEmpty()) "All clear" else parts.joinToString(" · "))

        if (Build.VERSION.SDK_INT >= 31) {
          val items = RemoteViews.RemoteCollectionItems.Builder().setViewTypeCount(2).setHasStableIds(true)
          var n = 0L
          fun header(text: String) {
            val v = RemoteViews(context.packageName, R.layout.widget_header)
            v.setTextViewText(R.id.header, text)
            items.addItem(n++, v)
          }
          fun row(title: String, meta: String, metaColor: Int, done: Boolean, tint: Int, action: String) {
            val v = RemoteViews(context.packageName, R.layout.widget_row)
            v.setTextViewText(R.id.row_title, title)
            v.setTextViewText(R.id.row_meta, meta)
            v.setTextColor(R.id.row_meta, metaColor)
            v.setImageViewResource(R.id.row_check, if (done) R.drawable.ic_widget_check else R.drawable.ic_widget_circle)
            v.setInt(R.id.row_check, "setColorFilter", tint)
            v.setFloat(R.id.row_title, "setAlpha", if (done) 0.5f else 1f)
            v.setOnClickFillInIntent(R.id.row, Intent().putExtra(EXTRA_ACTION, action))
            items.addItem(n++, v)
          }
          if (tasks != null && tasks.length() > 0) {
            header("Tasks")
            for (i in 0 until tasks.length()) {
              val t = tasks.getJSONObject(i)
              val overdue = t.optBoolean("overdue")
              row(t.optString("title"), t.optString("when"), if (overdue) danger else muted, false, if (overdue) danger else muted, "task:${t.optString("id")}")
            }
            if (more > 0) header("+ $more more in Kaizen")
          }
          if (habits != null && habits.length() > 0) {
            header("Habits")
            for (i in 0 until habits.length()) {
              val h = habits.getJSONObject(i)
              row(h.optString("name"), h.optString("progress", ""), muted, h.optBoolean("done"), color(h.optString("color"), accent), "habit:${h.optString("id")}")
            }
          }
          val empty = (tasks?.length() ?: 0) == 0 && (habits?.length() ?: 0) == 0
          views.setViewVisibility(R.id.widget_list, if (empty) View.GONE else View.VISIBLE)
          views.setViewVisibility(R.id.widget_empty, if (empty) View.VISIBLE else View.GONE)
          views.setTextViewText(R.id.widget_empty, "Nothing due today.")
          views.setRemoteAdapter(R.id.widget_list, items.build())
          val tap = Intent(context, TodayWidget::class.java).setAction(ACTION_TAP)
          val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
          views.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getBroadcast(context, 0, tap, flags))
        } else {
          views.setViewVisibility(R.id.widget_list, View.GONE)
          views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
          views.setTextViewText(R.id.widget_empty, "Tap to open Kaizen")
        }
        manager.updateAppWidget(id, views)
      }
    }

    /** Runs a Rust action off the main thread, then redraws. */
    private fun runAsync(context: Context, action: String, done: () -> Unit) {
      val app = context.applicationContext
      thread(name = "kaizen-widget") {
        try {
          nativeWidget(app.dataDir.absolutePath, action)
        } catch (e: Throwable) {
          Log.w(TAG, "widget action $action failed", e)
        }
        updateAll(app)
        done()
      }
    }
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    render(context, manager, ids)
    // A new day, or changes synced from the laptop.
    val pending = goAsync()
    runAsync(context, "refresh") { pending.finish() }
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action != ACTION_TAP) return
    val action = intent.getStringExtra(EXTRA_ACTION) ?: return
    if (snapshot(context)?.optBoolean("live") != true) {
      // No fingerprint unlock on this phone: let the app do it.
      context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      return
    }
    val pending = goAsync()
    runAsync(context, action) { pending.finish() }
  }
}
