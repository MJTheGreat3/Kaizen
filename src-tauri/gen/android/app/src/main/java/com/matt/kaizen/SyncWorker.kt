package com.matt.kaizen

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Syncs in the background every ~15 minutes (the shortest period Android
 * allows), even when Kaizen is closed, then checks followed teams' games
 * and favourite players for results to announce. The Rust side does
 * nothing unless background sync is turned on in Settings -> Sync.
 */
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val dir = applicationContext.dataDir.absolutePath
    val code = nativeSync(dir)
    Log.i("KaizenSync", "background sync finished with code $code")
    // Results and player performances since the last round.
    try {
      SportsNotifier.postAll(applicationContext, nativeSports(dir))
    } catch (e: Exception) {
      Log.w("KaizenSync", "sports round failed", e)
    }
    // Failures are logged; the next periodic run tries again.
    return Result.success()
  }

  companion object {
    init {
      System.loadLibrary("kaizen_lib")
    }

    @JvmStatic external fun nativeSync(dataDir: String): Int

    @JvmStatic external fun nativeSports(dataDir: String): String

    fun schedule(context: Context) {
      val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .build()
      WorkManager.getInstance(context)
        .enqueueUniquePeriodicWork("kaizen-sync", ExistingPeriodicWorkPolicy.KEEP, request)
    }
  }
}
