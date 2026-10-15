package com.matt.kaizen

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.view.View
import android.widget.RemoteViews

/** Who owes whom on balance, the biggest balances, and a bar to add an entry. */
class DebtWidget : AppWidgetProvider() {
  companion object {
    private val ROWS = intArrayOf(R.id.debts_p1, R.id.debts_p2, R.id.debts_p3)

    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, DebtWidget::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val d = WidgetFeed.read(context)?.optJSONObject("debts")
      val good = context.getColor(R.color.widget_good)
      val bad = context.getColor(R.color.widget_danger)
      val text = context.getColor(R.color.widget_text)
      for (id in ids) {
        val views = RemoteViews(context.packageName, R.layout.widget_debts)
        views.setOnClickPendingIntent(R.id.debts_head, WidgetFeed.openApp(context, 40, "debts"))
        views.setOnClickPendingIntent(R.id.debts_people, WidgetFeed.openApp(context, 40, "debts"))
        views.setOnClickPendingIntent(R.id.debts_add, WidgetFeed.openApp(context, 41, "debt"))
        if (d == null) {
          views.setTextViewText(R.id.debts_net, "Debts")
          views.setTextViewText(R.id.debts_sub, "Open Kaizen to fill this in")
          manager.updateAppWidget(id, views)
          continue
        }
        val net = d.optLong("net")
        views.setTextViewText(
          R.id.debts_net,
          when {
            net > 0 -> "You're owed ${d.optString("netText")}"
            net < 0 -> "You owe ${d.optString("netText")}"
            else -> "All square"
          },
        )
        views.setTextColor(R.id.debts_net, if (net > 0) good else if (net < 0) bad else text)
        views.setTextViewText(R.id.debts_sub, "${d.optString("owedToMe")} owed to you · ${d.optString("iOwe")} you owe")
        val people = d.optJSONArray("people")
        ROWS.forEachIndexed { i, row ->
          val p = people?.optJSONObject(i)
          if (p == null) {
            views.setViewVisibility(row, View.GONE)
          } else {
            val toMe = p.optBoolean("toMe")
            views.setViewVisibility(row, View.VISIBLE)
            views.setTextViewText(row, if (toMe) "${p.optString("name")} owes you ${p.optString("amount")}" else "You owe ${p.optString("name")} ${p.optString("amount")}")
          }
        }
        manager.updateAppWidget(id, views)
      }
    }
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = render(context, manager, ids)
}
