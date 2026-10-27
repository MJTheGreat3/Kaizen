package com.matt.kaizen

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.palette.graphics.Palette

/**
 * What is playing on the phone, read from Android's media sessions (which
 * needs Kaizen's notification access). Feeds the music widget and keeps it
 * moving while something plays.
 */
object MusicState {
  private const val TAG = "KaizenMusic"
  const val SPOTIFY = "com.spotify.music"
  private const val TICK_MS = 15_000L

  var controller: MediaController? = null
    private set
  var art: Bitmap? = null
    private set
  var bg: Int = 0xFF1D1B26.toInt()
    private set
  var accent: Int = 0xFFC94FD6.toInt()
    private set

  private var manager: MediaSessionManager? = null
  private var appContext: Context? = null
  private var artKey: String? = null
  /** What the widget last drew in full: redrawn only when this changes. */
  private var drawn: String? = null
  private val handler = Handler(Looper.getMainLooper())

  private val callback = object : MediaController.Callback() {
    override fun onMetadataChanged(metadata: MediaMetadata?) = changed()
    override fun onPlaybackStateChanged(state: PlaybackState?) = changed()
    override fun onSessionDestroyed() {
      controller = null
      changed()
    }
  }

  private val sessions = MediaSessionManager.OnActiveSessionsChangedListener { list -> pick(list) }

  private val tick = object : Runnable {
    override fun run() {
      val ctx = appContext ?: return
      if (playing) {
        // Only the ring moves on; redrawing the record would restart its turn.
        MusicWidget.updateFace(ctx)
        handler.postDelayed(this, TICK_MS)
      }
    }
  }

  fun hasAccess(context: Context) = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

  /** Starts following media sessions, if Kaizen may. Safe to call often. */
  @Synchronized
  fun ensure(context: Context) {
    if (manager != null || !hasAccess(context)) return
    try {
      val app = context.applicationContext
      val m = app.getSystemService(MediaSessionManager::class.java)
      val component = ComponentName(app, MediaListener::class.java)
      m.addOnActiveSessionsChangedListener(sessions, component, handler)
      manager = m
      appContext = app
      pick(m.getActiveSessions(component))
    } catch (e: SecurityException) {
      Log.w(TAG, "no access to media sessions", e)
    }
  }

  @Synchronized
  fun release() {
    manager?.removeOnActiveSessionsChangedListener(sessions)
    manager = null
    controller?.unregisterCallback(callback)
    controller = null
  }

  /** Spotify's session first, then whatever is playing, then the newest. */
  private fun pick(list: List<MediaController>?) {
    val all = list ?: emptyList()
    val next = all.firstOrNull { it.packageName == SPOTIFY }
      ?: all.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
      ?: all.firstOrNull()
    if (next?.sessionToken != controller?.sessionToken) {
      controller?.unregisterCallback(callback)
      controller = next
      next?.registerCallback(callback, handler)
    }
    changed()
  }

  private fun changed() {
    val ctx = appContext ?: return
    val meta = controller?.metadata
    val key = meta?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID) ?: meta?.getString(MediaMetadata.METADATA_KEY_TITLE)
    // Players often announce a song first and its cover a moment later, so
    // the cover is taken whenever it is new, not only when the song is.
    val cover = cover(ctx, meta)
    if (key != artKey || (cover != null && cover !== art)) {
      artKey = key
      art = cover
      if (cover != null) {
        try {
          val palette = Palette.from(cover).generate()
          bg = palette.getDarkMutedColor(palette.getDarkVibrantColor(0xFF1D1B26.toInt()))
          accent = palette.getVibrantColor(palette.getLightVibrantColor(palette.getDominantColor(0xFFC94FD6.toInt())))
        } catch (e: Exception) {
          Log.w(TAG, "cover colours failed", e)
        }
      } else {
        bg = 0xFF1D1B26.toInt()
        accent = 0xFFC94FD6.toInt()
      }
    }
    // Players report progress often; only a new song, cover or play state redraws the record.
    val state = "$key|${System.identityHashCode(art)}|$playing|${controller != null}"
    if (state != drawn) {
      drawn = state
      MusicWidget.updateAll(ctx)
    } else {
      MusicWidget.updateFace(ctx)
    }
    handler.removeCallbacks(tick)
    if (playing) handler.postDelayed(tick, TICK_MS)
  }

  /** The cover from the session: a bitmap, or loaded from its URI; software, so it can be drawn and read. */
  private fun cover(context: Context, meta: MediaMetadata?): Bitmap? {
    meta ?: return null
    val bitmap = meta.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
      ?: meta.getBitmap(MediaMetadata.METADATA_KEY_ART)
      ?: meta.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
      ?: listOf(MediaMetadata.METADATA_KEY_ALBUM_ART_URI, MediaMetadata.METADATA_KEY_ART_URI, MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI)
        .mapNotNull { meta.getString(it) }
        .firstNotNullOfOrNull { uri ->
          try {
            context.contentResolver.openInputStream(android.net.Uri.parse(uri))?.use { android.graphics.BitmapFactory.decodeStream(it) }
          } catch (e: Exception) {
            null
          }
        }
      ?: return null
    return if (bitmap.config == Bitmap.Config.HARDWARE) bitmap.copy(Bitmap.Config.ARGB_8888, false) else bitmap
  }

  val playing: Boolean
    get() = controller?.playbackState?.state == PlaybackState.STATE_PLAYING

  val title: String? get() = controller?.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)
  val artist: String? get() = controller?.metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST)
  val duration: Long get() = controller?.metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L

  /** Where the song is now. */
  val position: Long
    get() {
      val s = controller?.playbackState ?: return 0
      if (s.state != PlaybackState.STATE_PLAYING) return s.position
      return s.position + ((SystemClock.elapsedRealtime() - s.lastPositionUpdateTime) * s.playbackSpeed).toLong()
    }
}

/** Gives Kaizen access to media sessions; it does nothing with notifications. */
class MediaListener : NotificationListenerService() {
  override fun onListenerConnected() {
    MusicState.ensure(this)
  }

  override fun onListenerDisconnected() {
    MusicState.release()
  }
}
