package com.matt.kaizen

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.view.View
import android.widget.RemoteViews

/** Up next, as on Today: games, contests and important dates. */
class UpNextWidget : AppWidgetProvider() {
  companion object {
    private const val MAX = 6

    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, UpNextWidget::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val now = System.currentTimeMillis()
      val list = WidgetFeed.read(context)?.optJSONArray("upNext")
      val items = (0 until (list?.length() ?: 0))
        .map { list!!.getJSONObject(it) }
        // Timed things drop off 3 hours after they start unless live; dates at the end of their day.
        .filter { it.optBoolean("live") || it.optLong("at") + (if (it.optBoolean("allDay")) 86_400_000L else 3 * 3_600_000L) > now }
        .take(MAX)
      val muted = context.getColor(R.color.widget_muted)
      val danger = context.getColor(R.color.widget_danger)
      for (id in ids) {
        val views = RemoteViews(context.packageName, R.layout.widget_upnext)
        views.setOnClickPendingIntent(R.id.upnext_title, WidgetFeed.openApp(context, 20))
        views.setOnClickPendingIntent(R.id.upnext_empty, WidgetFeed.openApp(context, 20))
        if (items.isEmpty() || Build.VERSION.SDK_INT < 31) {
          views.setViewVisibility(R.id.upnext_list, View.GONE)
          views.setViewVisibility(R.id.upnext_empty, View.VISIBLE)
          views.setTextViewText(R.id.upnext_empty, if (list == null) "Open Kaizen to fill this in" else "Nothing in the next two weeks.")
        } else {
          val builder = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(1)
          items.forEachIndexed { i, x ->
            val row = RemoteViews(context.packageName, R.layout.widget_upnext_row)
            val live = x.optBoolean("live")
            row.setTextViewText(R.id.upnext_row_title, x.optString("title"))
            row.setTextViewText(R.id.upnext_row_when, WidgetFeed.whenText(x.optLong("at"), live, x.optBoolean("allDay"), now))
            row.setTextColor(R.id.upnext_row_when, if (live) danger else muted)
            row.setInt(R.id.upnext_row_dot, "setColorFilter", WidgetFeed.color(x.optString("color"), muted))
            row.setOnClickFillInIntent(R.id.upnext_row, android.content.Intent())
            builder.addItem(i.toLong(), row)
          }
          views.setViewVisibility(R.id.upnext_list, View.VISIBLE)
          views.setViewVisibility(R.id.upnext_empty, View.GONE)
          views.setRemoteAdapter(R.id.upnext_list, builder.build())
          val open = android.content.Intent(context, MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
          views.setPendingIntentTemplate(
            R.id.upnext_list,
            android.app.PendingIntent.getActivity(context, 21, open, android.app.PendingIntent.FLAG_MUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT),
          )
        }
        manager.updateAppWidget(id, views)
      }
    }
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = render(context, manager, ids)
}
