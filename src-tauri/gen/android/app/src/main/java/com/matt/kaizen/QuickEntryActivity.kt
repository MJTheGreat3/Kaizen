package com.matt.kaizen

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * A small entry box over the home screen, opened from a widget: type a
 * task or a debt and it is saved straight away (by Rust, with the
 * fingerprint-unlock key), without opening Kaizen.
 */
class QuickEntryActivity : Activity() {
  companion object {
    const val EXTRA_KIND = "kind"

    init {
      System.loadLibrary("kaizen_lib")
    }

    @JvmStatic external fun nativeEntry(dataDir: String, kind: String, text: String): String

    fun intent(context: Context, kind: String): Intent =
      Intent(context, QuickEntryActivity::class.java)
        .putExtra(EXTRA_KIND, kind)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val kind = intent.getStringExtra(EXTRA_KIND) ?: "task"
    val debt = kind == "debt"
    val density = resources.displayMetrics.density
    val input = EditText(this).apply {
      hint = if (debt) "Rahul owes 250 for pizza" else "Submit assignment friday 5pm #college"
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      imeOptions = EditorInfo.IME_ACTION_DONE
      isSingleLine = true
    }
    val box = FrameLayout(this).apply {
      val pad = (20 * density).toInt()
      setPadding(pad, (8 * density).toInt(), pad, 0)
      addView(input)
    }
    val dialog = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
      .setTitle(if (debt) "Add to Debts" else "New task")
      .setView(box)
      .setPositiveButton("Add", null)
      .setNegativeButton("Cancel") { _, _ -> finish() }
      .setOnCancelListener { finish() }
      .create()
    dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)

    fun save() {
      val text = input.text.toString().trim()
      if (text.isEmpty()) return
      input.isEnabled = false
      val app = applicationContext
      thread(name = "kaizen-entry") {
        val result = try {
          JSONObject(nativeEntry(app.dataDir.absolutePath, kind, text))
        } catch (e: Throwable) {
          JSONObject().put("ok", false).put("message", "Could not save")
        }
        runOnUiThread {
          if (result.optBoolean("ok")) {
            Native.updateWidgets(app, "")
            Toast.makeText(app, result.optString("message"), Toast.LENGTH_SHORT).show()
            dialog.dismiss()
            finish()
          } else {
            input.isEnabled = true
            input.error = result.optString("message")
          }
        }
      }
    }

    input.setOnEditorActionListener { _, action, _ ->
      if (action == EditorInfo.IME_ACTION_DONE) save()
      true
    }
    dialog.setOnShowListener {
      dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { save() }
      input.requestFocus()
    }
    dialog.show()
  }
}
