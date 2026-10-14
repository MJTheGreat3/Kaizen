package com.matt.kaizen.audiofx

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps Kaizen's process, and with it the equaliser, alive while the
 * equaliser is on, with a quiet notification naming the preset.
 */
class EqService : Service() {
  companion object {
    private const val CHANNEL = "equaliser"
    private const val ID = 4301
    const val EXTRA_PRESET = "preset"

    fun start(context: Context, preset: String) {
      val intent = Intent(context, EqService::class.java).putExtra(EXTRA_PRESET, preset)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, EqService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    AudioFx.init(this)
    val notifications = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && notifications.getNotificationChannel(CHANNEL) == null) {
      val channel = NotificationChannel(CHANNEL, "Equaliser", NotificationManager.IMPORTANCE_MIN)
      channel.setShowBadge(false)
      notifications.createNotificationChannel(channel)
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val preset = intent?.getStringExtra(EXTRA_PRESET) ?: "Custom"
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.drawable.ic_eq)
      .setContentTitle("Equaliser on")
      .setContentText(preset)
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setContentIntent(open)
      .build()
    ServiceCompat.startForeground(
      this,
      ID,
      notification,
      if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
    )
    return START_STICKY
  }
}
