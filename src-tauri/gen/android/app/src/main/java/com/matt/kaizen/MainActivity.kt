package com.matt.kaizen

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    SyncWorker.schedule(applicationContext)
    if (savedInstanceState == null) Native.accept(applicationContext, intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    Native.accept(applicationContext, intent)
  }
}
