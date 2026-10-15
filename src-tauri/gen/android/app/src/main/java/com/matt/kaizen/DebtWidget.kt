package com.matt.kaizen

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.util.SizeF
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File
import java.text.NumberFormat
import java.util.Locale

/**
 * Debts at a glance. 4x1: the balance and an Add button. 4x2: what you are
 * owed and what you owe in large figures, and a bar to add an entry. Adding
 * opens a small entry box over the home screen, not the app.
 */
class DebtWidget : AppWidgetProvider() {
  companion object {
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, DebtWidget::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    private val rupees: NumberFormat = NumberFormat.getCurrencyInstance(Locale("en", "IN")).apply { maximumFractionDigits = 0 }

    private fun money(paise: Long) = rupees.format(paise / 100.0)

    private fun summary(context: Context): JSONObject? = try {
      val file = File(context.dataDir, TodayWidget.FILE)
      if (file.exists()) JSONObject(file.readText()).optJSONObject("debts") else null
    } catch (e: Exception) {
      null
    }

    private fun build(context: Context, layout: Int, d: JSONObject?): RemoteViews {
      val views = RemoteViews(context.packageName, layout)
      val add = PendingIntent.getActivity(context, 41, QuickEntryActivity.intent(context, "debt"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      views.setOnClickPendingIntent(R.id.debts_head, WidgetFeed.openApp(context, 40, "page:debts"))
      views.setOnClickPendingIntent(R.id.debts_add, add)
      val owed = d?.optLong("owedToMe") ?: 0
      val owing = d?.optLong("iOwe") ?: 0
      val net = owed - owing
      if (layout == R.layout.widget_debts) {
        views.setTextViewText(R.id.debts_owed, money(owed))
        views.setTextViewText(R.id.debts_owing, money(owing))
      } else {
        val good = context.getColor(R.color.widget_good)
        val bad = context.getColor(R.color.widget_danger)
        views.setTextViewText(
          R.id.debts_net,
          when {
            d == null -> "Debts"
            net > 0 -> "You're owed ${money(net)}"
            net < 0 -> "You owe ${money(-net)}"
            else -> "All square"
          },
        )
        views.setTextColor(R.id.debts_net, if (net > 0) good else if (net < 0) bad else context.getColor(R.color.widget_text))
        views.setTextViewText(R.id.debts_sub, if (d == null) "Open Kaizen to fill this in" else "${money(owed)} to you · ${money(owing)} you owe")
      }
      return views
    }

    fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val d = summary(context)
      for (id in ids) {
        val views = if (Build.VERSION.SDK_INT >= 31) {
          // The launcher picks the layout for the widget's size.
          RemoteViews(mapOf(SizeF(180f, 40f) to build(context, R.layout.widget_debts_small, d), SizeF(180f, 120f) to build(context, R.layout.widget_debts, d)))
        } else {
          build(context, R.layout.widget_debts_small, d)
        }
        manager.updateAppWidget(id, views)
      }
    }
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = render(context, manager, ids)
}
