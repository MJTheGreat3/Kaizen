package com.matt.kaizen

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
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
 * Home-screen widget: four lists that each scroll on their own (tasks due
 * today or overdue, today's habits, undated tasks, active goals). Tapping a
 * task completes it, tapping a habit ticks it, a goal opens Goals; the work happens in Rust
 * (`nativeWidget`), which opens the database with the fingerprint-unlock
 * key. Without that key, taps open the app.
 */
class TodayWidget : AppWidgetProvider() {
  companion object {
    private const val TAG = "KaizenWidget"
    const val FILE = "widget.json"
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

    /** The four lists: their ids, title and empty text views. */
    private class Pane(val list: Int, val title: Int, val empty: Int)

    private val DUE = Pane(R.id.list_due, R.id.pane_due_title, R.id.empty_due)
    private val HABITS = Pane(R.id.list_habits, R.id.pane_habits_title, R.id.empty_habits)
    private val SOMEDAY = Pane(R.id.list_someday, R.id.pane_someday_title, R.id.empty_someday)
    private val GOALS = Pane(R.id.list_goals, R.id.pane_goals_title, R.id.empty_goals)

    private fun fill(views: RemoteViews, pane: Pane, title: String, items: RemoteViews.RemoteCollectionItems, count: Int) {
      views.setTextViewText(pane.title, if (count > 0) "$title · $count" else title)
      views.setViewVisibility(pane.list, if (count > 0) View.VISIBLE else View.GONE)
      views.setViewVisibility(pane.empty, if (count > 0) View.GONE else View.VISIBLE)
      views.setRemoteAdapter(pane.list, items)
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
        views.setOnClickPendingIntent(R.id.widget_add_board, openApp(context, 4, "board"))

        val today = LocalDate.now().toString()
        val stale = snap == null || snap.optString("date") != today && !snap.optBoolean("live")
        if (stale || Build.VERSION.SDK_INT < 31) {
          views.setTextViewText(R.id.widget_date, "Today")
          views.setTextViewText(
            R.id.widget_sub,
            when {
              snap == null -> "Open Kaizen to fill this in"
              stale -> "Open Kaizen to bring this up to date"
              else -> snap.optString("label", "")
            },
          )
          views.setViewVisibility(R.id.widget_grid, View.GONE)
          views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
          views.setOnClickPendingIntent(R.id.widget_empty, openApp(context, 1, null))
          manager.updateAppWidget(id, views)
          continue
        }
        snap!!
        views.setViewVisibility(R.id.widget_grid, View.VISIBLE)
        views.setViewVisibility(R.id.widget_empty, View.GONE)

        val tasks = snap.optJSONArray("tasks")
        val someday = snap.optJSONArray("someday")
        val habits = snap.optJSONArray("habits")
        val goals = WidgetFeed.read(context)?.optJSONArray("goals")
        val more = snap.optInt("moreTasks")
        val dueCount = (tasks?.length() ?: 0) + more
        val habitCount = habits?.length() ?: 0
        val habitsDone = (0 until habitCount).count { habits!!.getJSONObject(it).optBoolean("done") }
        views.setTextViewText(R.id.widget_date, snap.optString("label", "Today"))
        val parts = mutableListOf<String>()
        if (dueCount > 0) parts.add("$dueCount due")
        if (habitCount > 0) parts.add("$habitsDone of $habitCount habits")
        views.setTextViewText(R.id.widget_sub, if (parts.isEmpty()) "All clear" else parts.joinToString(" · "))

        fun row(title: String, meta: String, metaColor: Int, done: Boolean, tint: Int, action: String): RemoteViews {
          val v = RemoteViews(context.packageName, R.layout.widget_row_compact)
          v.setTextViewText(R.id.row_title, title)
          v.setTextViewText(R.id.row_meta, meta)
          v.setTextColor(R.id.row_meta, metaColor)
          v.setImageViewResource(R.id.row_check, if (done) R.drawable.ic_widget_check else R.drawable.ic_widget_circle)
          v.setInt(R.id.row_check, "setColorFilter", tint)
          v.setFloat(R.id.row_title, "setAlpha", if (done) 0.5f else 1f)
          v.setOnClickFillInIntent(R.id.row, Intent().putExtra(EXTRA_ACTION, action))
          return v
        }
        fun tasksOf(list: org.json.JSONArray?, extra: Int): RemoteViews.RemoteCollectionItems {
          val items = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true)
          for (i in 0 until (list?.length() ?: 0)) {
            val t = list!!.getJSONObject(i)
            val overdue = t.optBoolean("overdue")
            val tint = if (overdue) danger else muted
            items.addItem(i.toLong(), row(t.optString("title"), t.optString("when"), tint, false, tint, "task:${t.optString("id")}"))
          }
          if (extra > 0) {
            val v = RemoteViews(context.packageName, R.layout.widget_row_compact)
            v.setTextViewText(R.id.row_title, "+ $extra more in Kaizen")
            v.setTextColor(R.id.row_title, muted)
            v.setViewVisibility(R.id.row_check, View.GONE)
            v.setOnClickFillInIntent(R.id.row, Intent().putExtra(EXTRA_ACTION, "open"))
            items.addItem(-1L, v)
          }
          return items.setViewTypeCount(1).build()
        }

        fill(views, DUE, "Due today", tasksOf(tasks, more), dueCount)
        fill(views, SOMEDAY, "Someday", tasksOf(someday, 0), someday?.length() ?: 0)

        val habitItems = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1)
        for (i in 0 until habitCount) {
          val h = habits!!.getJSONObject(i)
          val progress = if (h.isNull("progress")) "" else h.optString("progress")
          habitItems.addItem(i.toLong(), row(h.optString("name"), progress, muted, h.optBoolean("done"), color(h.optString("color"), accent), "habit:${h.optString("id")}"))
        }
        fill(views, HABITS, "Habits", habitItems.build(), habitCount)
        if (habitCount > 0) views.setTextViewText(HABITS.title, "Habits · $habitsDone/$habitCount")

        val goalItems = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1)
        for (i in 0 until (goals?.length() ?: 0)) {
          val g = goals!!.getJSONObject(i)
          val v = RemoteViews(context.packageName, R.layout.widget_goal_row)
          val percent = g.optInt("percent")
          v.setTextViewText(R.id.goal_title, g.optString("title"))
          v.setTextViewText(R.id.goal_percent, "$percent%")
          v.setProgressBar(R.id.goal_bar, 100, percent, false)
          v.setColorStateList(R.id.goal_bar, "setProgressTintList", ColorStateList.valueOf(color(g.optString("color"), accent)))
          val note = g.optString("note")
          v.setTextViewText(R.id.goal_note, note)
          v.setViewVisibility(R.id.goal_note, if (note.isEmpty()) View.GONE else View.VISIBLE)
          v.setOnClickFillInIntent(R.id.goal, Intent().putExtra(Native.EXTRA_KIND, "page:goals"))
          goalItems.addItem(i.toLong(), v)
        }
        fill(views, GOALS, "Goals", goalItems.build(), goals?.length() ?: 0)

        // Ticks go to this widget; goals open the Goals page.
        val tap = Intent(context, TodayWidget::class.java).setAction(ACTION_TAP)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        val ticks = PendingIntent.getBroadcast(context, 0, tap, flags)
        for (pane in listOf(DUE, SOMEDAY, HABITS)) views.setPendingIntentTemplate(pane.list, ticks)
        val page = Intent(context, MainActivity::class.java).setAction(Native.ACTION_CAPTURE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        views.setPendingIntentTemplate(GOALS.list, PendingIntent.getActivity(context, 5, page, flags))
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
    if (action == "open" || snapshot(context)?.optBoolean("live") != true) {
      // "+ N more", or no fingerprint unlock on this phone: let the app do it.
      context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      return
    }
    val pending = goAsync()
    runAsync(context, action) { pending.finish() }
  }
}
