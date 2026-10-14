package com.matt.kaizen.audiofx

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.audiofx.AudioEffect
import android.media.audiofx.Equalizer
import android.media.audiofx.Visualizer
import android.util.Log
import androidx.core.content.ContextCompat
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * The visualiser and equaliser, kept for the whole process.
 *
 * Players such as Spotify announce their audio session with
 * [AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION]; effects attach to
 * that session, or to the whole output mix (session 0) until one is known.
 */
object AudioFx {
  private const val TAG = "KaizenAudioFx"
  const val SPOTIFY = "com.spotify.music"
  /** Bands the visualiser reports, spaced logarithmically from 40 Hz to 16 kHz. */
  const val BANDS = 48

  private var registered = false
  /** Open sessions by package, newest last. */
  private val sessions = LinkedHashMap<String, Int>()

  private var visualizer: Visualizer? = null
  private var visualizerSession = -1
  private var wantVisualizer = false
  @Volatile private var bands = FloatArray(BANDS)
  @Volatile private var frameAt = 0L

  private var equalizer: Equalizer? = null
  private var eqSession = -1
  private var eqEnabled = false
  private var eqGains = DoubleArray(0)
  private var eqError: String? = null

  /** The session effects attach to: Spotify's, another player's, or the output mix. */
  val session: Int
    @Synchronized get() = sessions[SPOTIFY] ?: sessions.values.lastOrNull() ?: 0

  @Synchronized
  fun init(context: Context) {
    if (registered) return
    registered = true
    val filter = IntentFilter().apply {
      addAction(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION)
      addAction(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION)
    }
    ContextCompat.registerReceiver(
      context.applicationContext,
      object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
          val id = intent.getIntExtra(AudioEffect.EXTRA_AUDIO_SESSION, -1)
          val pkg = intent.getStringExtra(AudioEffect.EXTRA_PACKAGE_NAME) ?: "unknown"
          if (id <= 0) return
          Log.i(TAG, "${intent.action} $pkg $id")
          synchronized(AudioFx) {
            sessions.remove(pkg)
            if (intent.action == AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION) sessions[pkg] = id
          }
          reattach()
        }
      },
      filter,
      ContextCompat.RECEIVER_EXPORTED,
    )
  }

  /** Moves effects onto the current session after it changed. */
  @Synchronized
  private fun reattach() {
    if (wantVisualizer && visualizerSession != session) startVisualizer()
    if (eqEnabled && eqSession != session) applyEq()
  }

  // ------------------------------------------------------------------ visualiser

  @Synchronized
  fun startVisualizer(): String? {
    wantVisualizer = true
    stopVisualizerOnly()
    val target = session
    return try {
      val v = Visualizer(target)
      v.captureSize = Visualizer.getCaptureSizeRange()[1].coerceAtMost(1024)
      v.scalingMode = Visualizer.SCALING_MODE_NORMALIZED
      v.setDataCaptureListener(
        object : Visualizer.OnDataCaptureListener {
          override fun onWaveFormDataCapture(v: Visualizer, data: ByteArray, rate: Int) {}
          override fun onFftDataCapture(v: Visualizer, fft: ByteArray, rate: Int) {
            bands = toBands(fft, rate / 1000)
            frameAt = System.currentTimeMillis()
          }
        },
        Visualizer.getMaxCaptureRate(),
        false,
        true,
      )
      v.enabled = true
      visualizer = v
      visualizerSession = target
      null
    } catch (e: Exception) {
      Log.w(TAG, "visualizer on session $target failed", e)
      e.message ?: e.javaClass.simpleName
    }
  }

  private fun stopVisualizerOnly() {
    visualizer?.let {
      try {
        it.enabled = false
        it.release()
      } catch (_: Exception) {}
    }
    visualizer = null
    visualizerSession = -1
  }

  @Synchronized
  fun stopVisualizer() {
    wantVisualizer = false
    stopVisualizerOnly()
  }

  /** Latest bands (0..1) and how old they are. */
  fun frame(): Pair<FloatArray, Long> = bands to (System.currentTimeMillis() - frameAt)

  /**
   * FFT bytes (`[re0, re(n/2), re1, im1, …]`) to [BANDS] levels between 0
   * and 1: the loudest bin in each log-spaced band, in decibels.
   */
  fun toBands(fft: ByteArray, sampleRate: Int): FloatArray {
    val bins = fft.size / 2
    val hzPerBin = sampleRate / 2.0 / bins
    val out = FloatArray(BANDS)
    val lo = 40.0
    val hi = min(16000.0, sampleRate / 2.0)
    for (b in 0 until BANDS) {
      val f0 = lo * (hi / lo).pow(b.toDouble() / BANDS)
      val f1 = lo * (hi / lo).pow((b + 1).toDouble() / BANDS)
      val i0 = max(1, (f0 / hzPerBin).toInt())
      val i1 = max(i0 + 1, (f1 / hzPerBin).toInt())
      var peak = 0.0
      for (i in i0 until min(i1, bins)) {
        val re = fft[2 * i].toDouble()
        val im = fft[2 * i + 1].toDouble()
        peak = max(peak, hypot(re, im))
      }
      // 8-bit FFT: magnitudes up to ~181; 0 dB to 45 dB mapped to 0..1.
      val db = if (peak > 0) 20 * ln(peak) / ln(10.0) else 0.0
      out[b] = ((db / 45.0).coerceIn(0.0, 1.0)).toFloat()
    }
    return out
  }

  // ------------------------------------------------------------------ equaliser

  data class EqInfo(val centers: IntArray, val min: Double, val max: Double, val error: String?)

  /** The device equaliser's bands (centre Hz) and gain range (dB). */
  @Synchronized
  fun eqInfo(): EqInfo {
    val eq = equalizer ?: try {
      Equalizer(0, 0).also { probe ->
        val info = describe(probe)
        probe.release()
        return info
      }
    } catch (e: Exception) {
      return EqInfo(IntArray(0), -12.0, 12.0, e.message ?: e.javaClass.simpleName)
    }
    return describe(eq)
  }

  private fun describe(eq: Equalizer): EqInfo {
    val range = eq.bandLevelRange
    val centers = IntArray(eq.numberOfBands.toInt()) { eq.getCenterFreq(it.toShort()) / 1000 }
    return EqInfo(centers, range[0] / 100.0, range[1] / 100.0, eqError)
  }

  /** Turns the equaliser on with `gains` (dB, one per device band) or off. */
  @Synchronized
  fun setEq(enabled: Boolean, gains: DoubleArray): String? {
    eqEnabled = enabled
    eqGains = gains
    return applyEq()
  }

  @Synchronized
  private fun applyEq(): String? {
    if (!eqEnabled) {
      equalizer?.let {
        try {
          it.enabled = false
          it.release()
        } catch (_: Exception) {}
      }
      equalizer = null
      eqSession = -1
      eqError = null
      return null
    }
    val target = session
    return try {
      if (equalizer == null || eqSession != target) {
        equalizer?.release()
        equalizer = Equalizer(1000, target)
        eqSession = target
      }
      val eq = equalizer!!
      val range = eq.bandLevelRange
      for (b in 0 until eq.numberOfBands) {
        val mb = ((eqGains.getOrElse(b) { 0.0 }) * 100).toInt().coerceIn(range[0].toInt(), range[1].toInt())
        eq.setBandLevel(b.toShort(), mb.toShort())
      }
      eq.enabled = true
      eqError = null
      null
    } catch (e: Exception) {
      Log.w(TAG, "equaliser on session $target failed", e)
      eqError = e.message ?: e.javaClass.simpleName
      eqError
    }
  }

  val eqOn: Boolean
    @Synchronized get() = eqEnabled
}
