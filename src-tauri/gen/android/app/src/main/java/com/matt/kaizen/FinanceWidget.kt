package com.matt.kaizen

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File
import java.text.NumberFormat
import java.time.LocalDate
import java.util.Locale

/**
 * Money at a glance, 4x1: what was spent today and this month (my share of
 * split bills), the total balance, and buttons that open Kaizen's add form
 * as an expense or as income.
 */
class FinanceWidget : AppWidgetProvider() {
  companion object {
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, FinanceWidget::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    private val rupees: NumberFormat = NumberFormat.getCurrencyInstance(Locale("en", "IN")).apply { maximumFractionDigits = 0 }

    private fun money(paise: Long) = rupees.format(paise / 100.0)

    /** The money summary, with the snapshot's date. */
    private fun summary(context: Context): Pair<JSONObject, String>? = try {
      val file = File(context.dataDir, TodayWidget.FILE)
      if (!file.exists()) null
      else JSONObject(file.readText()).let { snap -> snap.optJSONObject("money")?.let { it to snap.optString("date") } }
    } catch (e: Exception) {
      null
    }

    fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val found = summary(context)
      val m = found?.first
      // Today's figure only holds on the day it was written.
      val fresh = found?.second == LocalDate.now().toString()
      for (id in ids) {
        val views = RemoteViews(context.packageName, R.layout.widget_finance)
        views.setOnClickPendingIntent(R.id.finance_head, WidgetFeed.openApp(context, 50, "page:finance"))
        views.setOnClickPendingIntent(R.id.finance_expense, WidgetFeed.openApp(context, 51, "expense"))
        views.setOnClickPendingIntent(R.id.finance_income, WidgetFeed.openApp(context, 52, "income"))
        when {
          m == null -> {
            views.setTextViewText(R.id.finance_today, "Money")
            views.setTextViewText(R.id.finance_sub, "Open Kaizen to fill this in")
          }
          !m.optBoolean("hasAccounts") -> {
            views.setTextViewText(R.id.finance_today, "Money")
            views.setTextViewText(R.id.finance_sub, "Add an account in Kaizen first")
          }
          else -> {
            val today = if (fresh) m.optLong("spentToday") else 0L
            views.setTextViewText(R.id.finance_today, if (today > 0) "${money(today)} today" else "Nothing spent today")
            views.setTextViewText(R.id.finance_sub, "${money(m.optLong("spentMonth"))} this month · ${money(m.optLong("balance"))} left")
          }
        }
        manager.updateAppWidget(id, views)
      }
    }
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = render(context, manager, ids)
}
