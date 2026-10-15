package com.matt.kaizen

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Small native helpers the Rust side calls (`android::call`), each
 * `(Context, String) -> String`.
 */
object Native {
  private const val SPOTIFY = "com.spotify.music"

  /** Things handed to Kaizen (shares, shortcuts, the tile) waiting for the app to take them. */
  private val intake = mutableListOf<JSONObject>()

  /**
   * Wakes Spotify. Quietly first ("background"): a play button press, which
   * starts Spotify's player without opening it. "foreground" opens the app.
   * Returns "no" when Spotify is not installed.
   */
  @JvmStatic
  fun wakeSpotify(context: Context, mode: String): String {
    val launch = context.packageManager.getLaunchIntentForPackage(SPOTIFY) ?: return "no"
    if (mode == "foreground") {
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(launch)
      return "opened"
    }
    for (action in listOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP)) {
      val press = Intent(Intent.ACTION_MEDIA_BUTTON)
        .setPackage(SPOTIFY)
        .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(action, KeyEvent.KEYCODE_MEDIA_PLAY))
      context.sendBroadcast(press)
    }
    return "pressed"
  }

  /** Brings Kaizen back in front (after opening Spotify to wake it). */
  @JvmStatic
  fun returnToApp(context: Context, unused: String): String {
    val intent = Intent(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    context.startActivity(intent)
    return ""
  }

  /** Redraws the home-screen widgets from the snapshot the app just wrote. */
  @JvmStatic
  fun updateWidgets(context: Context, unused: String): String {
    TodayWidget.updateAll(context)
    StreakWidget.updateAll(context)
    UpNextWidget.updateAll(context)
    DebtWidget.updateAll(context)
    return ""
  }

  /** Everything handed to Kaizen since the last call, as a JSON list. */
  @JvmStatic
  @Synchronized
  fun takeIntake(context: Context, unused: String): String {
    val out = JSONArray(intake)
    intake.clear()
    return out.toString()
  }

  @Synchronized
  private fun add(item: JSONObject) {
    intake.add(item)
  }

  /**
   * Reads what an intent hands over: a share (text, link or image), or a
   * quick-capture request from a shortcut, the tile or a widget. Returns
   * whether it was one.
   */
  fun accept(context: Context, intent: Intent?): Boolean {
    intent ?: return false
    when (intent.action) {
      Intent.ACTION_SEND -> {
        val item = JSONObject().put("source", "share")
        intent.getStringExtra(Intent.EXTRA_SUBJECT)?.let { item.put("subject", it) }
        intent.getStringExtra(Intent.EXTRA_TEXT)?.let { item.put("text", it) }
        val type = intent.type ?: ""
        if (type.startsWith("image/")) {
          @Suppress("DEPRECATION")
          val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
          if (uri != null) readImage(context, uri)?.let { item.put("image", it).put("mime", type) }
        }
        add(item)
      }
      ACTION_CAPTURE -> add(JSONObject().put("source", "capture").put("kind", intent.getStringExtra(EXTRA_KIND) ?: ""))
      else -> return false
    }
    // Handled once: a restart must not deliver it again.
    intent.action = Intent.ACTION_MAIN
    return true
  }

  /** A shared image as base64, scaled down when large (the app shrinks it further). */
  private fun readImage(context: Context, uri: Uri): String? = try {
    context.contentResolver.openInputStream(uri)?.use { input ->
      val bytes = input.readBytes()
      if (bytes.size <= 6_000_000) Base64.encodeToString(bytes, Base64.NO_WRAP)
      else {
        val bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        val scale = 2400f / maxOf(bitmap.width, bitmap.height)
        val small = android.graphics.Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true)
        val out = ByteArrayOutputStream()
        small.compress(android.graphics.Bitmap.CompressFormat.JPEG, 88, out)
        Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
      }
    }
  } catch (e: Exception) {
    null
  }

  const val ACTION_CAPTURE = "com.matt.kaizen.CAPTURE"
  const val EXTRA_KIND = "kind"
}
