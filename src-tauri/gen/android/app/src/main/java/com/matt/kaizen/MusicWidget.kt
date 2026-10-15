package com.matt.kaizen

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Icon
import android.os.Build
import android.provider.Settings
import android.view.View
import android.widget.RemoteViews
import androidx.core.graphics.ColorUtils

/**
 * A round music widget: the record with the cover on its label, turning
 * once a minute while music plays (the second hand of an analog clock),
 * with the progress ring and buttons in the cover's colour.
 * Tap the middle to play or pause, the left or right edge to go back or
 * forward 15 s, the corner buttons to skip.
 */
class MusicWidget : AppWidgetProvider() {
  companion object {
    private const val ACTION = "com.matt.kaizen.MUSIC"
    private const val EXTRA = "do"

    /** Redraws only the ring (progress), leaving the turning record alone. */
    fun updateFace(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, MusicWidget::class.java))
      val duration = MusicState.duration
      val progress = if (duration > 0) MusicState.position.toFloat() / duration else 0f
      for (id in ids) {
        val size = sizeOf(context, manager, id)
        val views = RemoteViews(context.packageName, R.layout.widget_music)
        views.setImageViewBitmap(R.id.music_face, face(MusicState.bg, MusicState.accent, progress, size))
        manager.partiallyUpdateAppWidget(id, views)
      }
    }

    private fun sizeOf(context: Context, manager: AppWidgetManager, id: Int): Int {
      val options = manager.getAppWidgetOptions(id)
      val dp = minOf(
        options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 160),
        options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 160),
      ).coerceAtLeast(80)
      return (dp * context.resources.displayMetrics.density).toInt().coerceIn(200, 900)
    }

    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, MusicWidget::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    private fun action(context: Context, what: String, request: Int): PendingIntent {
      val intent = Intent(context, MusicWidget::class.java).setAction(ACTION).putExtra(EXTRA, what)
      return PendingIntent.getBroadcast(context, request, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** The record: grooves, the cover on the label, the spindle hole. */
    fun disc(art: Bitmap?, hole: Int, size: Int): Bitmap {
      val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      val c = Canvas(out)
      val center = size / 2f
      // The record fills 68% of the face; the rest stays clear so it lines up with the face.
      c.translate(center * 0.32f, center * 0.32f)
      val r = center * 0.68f
      val paint = Paint(Paint.ANTI_ALIAS_FLAG)
      paint.color = 0xFF111114.toInt()
      c.drawCircle(r, r, r, paint)
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = 1.4f
      var g = r * 0.3f
      while (g < r - 2) {
        paint.color = if (((g / 3).toInt() % 2) == 0) 0xFF1E1E23.toInt() else 0xFF0B0B0D.toInt()
        c.drawCircle(r, r, g, paint)
        g += 3.2f
      }
      // A light streak across the vinyl.
      paint.strokeWidth = r * 0.5f
      paint.color = 0x14FFFFFF
      c.drawArc(RectF(r * 0.5f, r * 0.5f, r * 1.5f, r * 1.5f), -70f, 30f, false, paint)
      paint.style = Paint.Style.FILL
      // Fully opaque again: the highlight above left the paint faint.
      paint.color = Color.BLACK
      val label = r * 0.58f
      if (art != null) {
        val shader = BitmapShader(art, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
        val scale = (label * 2) / minOf(art.width, art.height)
        shader.setLocalMatrix(Matrix().apply {
          setScale(scale, scale)
          postTranslate(r - art.width * scale / 2, r - art.height * scale / 2)
        })
        paint.shader = shader
        c.drawCircle(r, r, label, paint)
        paint.shader = null
      } else {
        paint.color = 0xFF2A2A31.toInt()
        c.drawCircle(r, r, label, paint)
      }
      paint.color = hole
      c.drawCircle(r, r, r * 0.045f, paint)
      return out
    }

    /** The widget's face: background circle and the progress ring around the record. */
    fun face(bg: Int, accent: Int, progress: Float, size: Int): Bitmap {
      val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      val c = Canvas(out)
      val r = size / 2f
      val paint = Paint(Paint.ANTI_ALIAS_FLAG)
      paint.color = bg
      c.drawCircle(r, r, r, paint)
      // Record radius is 0.68r (the clock sits inset 16%).
      val ring = r * 0.715f
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = r * 0.03f
      paint.color = Color.argb(46, 255, 255, 255)
      val box = RectF(r - ring, r - ring, r + ring, r + ring)
      c.drawArc(box, 0f, 360f, false, paint)
      paint.color = accent
      c.drawArc(box, -90f, 360f * progress.coerceIn(0f, 1f), false, paint)
      return out
    }

    /** The open, previous and next buttons in the cover's colour, icons light or dark to stand out. */
    private fun tintButtons(views: RemoteViews, color: Int) {
      val icon = if (ColorUtils.calculateLuminance(color) > 0.55) 0xFF15131B.toInt() else Color.WHITE
      for (id in listOf(R.id.music_open, R.id.music_prev, R.id.music_next)) {
        if (Build.VERSION.SDK_INT >= 31) views.setColorStateList(id, "setBackgroundTintList", ColorStateList.valueOf(color))
        views.setInt(id, "setColorFilter", icon)
      }
    }

    fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      MusicState.ensure(context)
      val access = MusicState.hasAccess(context)
      val playing = MusicState.playing
      val hasTrack = MusicState.controller?.metadata != null
      val duration = MusicState.duration
      val progress = if (duration > 0) MusicState.position.toFloat() / duration else 0f
      for (id in ids) {
        // Drawn at the widget's own size: the clock never scales its hands up.
        val size = sizeOf(context, manager, id)
        val face = face(MusicState.bg, MusicState.accent, progress, size)
        val record = disc(MusicState.art.takeIf { hasTrack }, MusicState.bg, size)
        val views = RemoteViews(context.packageName, R.layout.widget_music)
        views.setImageViewBitmap(R.id.music_face, face)
        val turning = playing && Build.VERSION.SDK_INT >= 31
        if (turning) {
          // The record is the clock's second hand: one turn a minute.
          views.setIcon(R.id.music_clock, "setSecondHand", Icon.createWithBitmap(record))
          views.setIcon(R.id.music_clock, "setDial", Icon.createWithBitmap(Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)))
        } else {
          views.setImageViewBitmap(R.id.music_disc, record)
        }
        views.setViewVisibility(R.id.music_clock, if (turning) View.VISIBLE else View.GONE)
        views.setViewVisibility(R.id.music_disc, if (turning) View.GONE else View.VISIBLE)
        views.setViewVisibility(R.id.music_play, if (playing) View.GONE else View.VISIBLE)
        views.setContentDescription(R.id.music_center, listOfNotNull(MusicState.title, MusicState.artist).joinToString(", ").ifEmpty { "Music" })

        tintButtons(views, MusicState.accent)
        views.setOnClickPendingIntent(R.id.music_open, WidgetFeed.openApp(context, 36, "page:music"))
        if (!access) {
          val settings = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          val open = PendingIntent.getActivity(context, 30, settings, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
          for (v in listOf(R.id.music_center, R.id.music_back, R.id.music_forward, R.id.music_prev, R.id.music_next)) views.setOnClickPendingIntent(v, open)
        } else {
          views.setOnClickPendingIntent(R.id.music_center, action(context, "toggle", 31))
          views.setOnClickPendingIntent(R.id.music_back, action(context, "back", 32))
          views.setOnClickPendingIntent(R.id.music_forward, action(context, "forward", 33))
          views.setOnClickPendingIntent(R.id.music_prev, action(context, "prev", 34))
          views.setOnClickPendingIntent(R.id.music_next, action(context, "next", 35))
        }
        manager.updateAppWidget(id, views)
      }
    }
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = render(context, manager, ids)

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: android.os.Bundle) =
    render(context, manager, intArrayOf(id))

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action != ACTION) return
    MusicState.ensure(context)
    val controls = MusicState.controller?.transportControls
    if (controls == null) {
      // Nothing playing: start Spotify where it left off.
      Native.wakeSpotify(context, "background")
      return
    }
    when (intent.getStringExtra(EXTRA)) {
      "toggle" -> if (MusicState.playing) controls.pause() else controls.play()
      "back" -> controls.seekTo(maxOf(0, MusicState.position - 15_000))
      "forward" -> controls.seekTo(minOf(MusicState.duration, MusicState.position + 15_000))
      "prev" -> controls.skipToPrevious()
      "next" -> controls.skipToNext()
    }
  }
}
