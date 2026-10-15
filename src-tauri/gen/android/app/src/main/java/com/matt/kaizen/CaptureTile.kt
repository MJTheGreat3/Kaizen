package com.matt.kaizen

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService

/** A Quick Settings tile that opens Kaizen's quick capture. */
class CaptureTile : TileService() {
  override fun onClick() {
    super.onClick()
    val intent = Intent(this, MainActivity::class.java)
      .setAction(Native.ACTION_CAPTURE)
      .putExtra(Native.EXTRA_KIND, "")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
