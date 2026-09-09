package expo.modules.focustrace

import android.os.Build
import android.view.View
import android.view.ViewTreeObserver
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android-side observers for the one question JavaScript cannot answer: what
 * takes the focus away from a field.
 *
 * ## Why this exists at all
 *
 * Eight recorded attempts lose focus 36–58 ms after gaining it, with no
 * `blurTextInput` command from JavaScript anywhere in the log. Everything
 * reachable from JS has been exhausted: the commands are wrapped, the mount
 * counters are stable, the window never resizes, and turning off
 * `scrollsChildToFocus` changed nothing. What is missing is the Java call
 * stack at the moment the focus moves, and that exists only here.
 *
 * ## What this covers, and — just as important — what it does not
 *
 * It installs three observers, and each answers a different question:
 *
 *  * **`OnGlobalFocusChangeListener`** — which view lost focus, which gained
 *    it, and the stack **of the notification**. That last word is the
 *    limitation and it must not be glossed over: Android delivers this
 *    callback from `ViewRootImpl`'s handling, so the stack shows the path
 *    that *announced* the change. When the change was posted rather than
 *    made inline, the original caller is no longer on it. It narrows the
 *    field; it is not guaranteed to name the culprit.
 *  * **`OnWindowFocusChangeListener`** — whether the whole window lost focus,
 *    which is a different event from a view losing it and would explain the
 *    same symptom for an entirely different reason.
 *  * **`OnAttachStateChangeListener`** on whatever currently holds focus —
 *    whether that view is being detached and re-attached. Stable native tags
 *    never excluded that, and this is what would show it.
 *
 * **Not covered, and no listener can cover it:** updates to `inputType`,
 * `keyListener` or `focusable` on `ReactEditText`. Those are property writes
 * with no observer to hang off; catching them needs a subclass or a hook into
 * React Native's view manager, which is a larger change than this and is not
 * attempted here. If the stacks point that way, that is the next step.
 *
 * ## Timing and delivery
 *
 * Every record carries the **native** timestamp taken inside the callback —
 * `SystemClock.uptimeMillis()`, monotonic and unaffected by the clock — plus
 * the wall clock for lining up against the JS log.
 *
 * Delivery is a pull, not a push, and deliberately: events are buffered here
 * from the moment the observers start, and JavaScript takes them when it is
 * ready. Nothing that happens before the JS side subscribes is lost, which a
 * fire-and-forget event emitter could not promise.
 *
 * ## What is never recorded
 *
 * No text. A view is described by its class name and its integer id, and the
 * stack frames are class, method and line. Field contents, phone numbers,
 * passwords, OTP codes and tokens cannot appear in any of them.
 */
class FocusTraceModule : Module() {
  private data class Record(
    val uptime: Long,
    val wall: Long,
    val kind: String,
    val from: String,
    val to: String,
    val stack: String,
  )

  /** Bounded so a long session cannot grow without limit. */
  private val capacity = 400
  private val records = ArrayDeque<Record>()

  private var focusListener: ViewTreeObserver.OnGlobalFocusChangeListener? = null
  private var windowFocusListener: ViewTreeObserver.OnWindowFocusChangeListener? = null
  private var attachListener: View.OnAttachStateChangeListener? = null
  private var watchedForAttach: View? = null

  override fun definition() = ModuleDefinition {
    Name("TuTakFocusTrace")

    Function("start") { start() }
    Function("stop") { stop() }

    /** Hands over everything buffered and empties the buffer. */
    Function("drain") {
      synchronized(records) {
        val out = records.map {
          mapOf(
            "uptime" to it.uptime,
            "wall" to it.wall,
            "kind" to it.kind,
            "from" to it.from,
            "to" to it.to,
            "stack" to it.stack,
          )
        }
        records.clear()
        out
      }
    }

    OnDestroy { stop() }
  }

  private fun decorView(): View? =
    appContext.activityProvider?.currentActivity?.window?.decorView

  private fun start() {
    val decor = decorView() ?: return
    if (focusListener != null) return

    val observer = decor.viewTreeObserver

    focusListener = ViewTreeObserver.OnGlobalFocusChangeListener { oldFocus, newFocus ->
      record("focus", describe(oldFocus), describe(newFocus))
      watchAttach(newFocus)
    }.also(observer::addOnGlobalFocusChangeListener)

    // API 28 and up only; on anything older this signal is simply absent and
    // its absence is stated rather than faked.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      windowFocusListener = ViewTreeObserver.OnWindowFocusChangeListener { hasFocus ->
        record("window", if (hasFocus) "unfocused" else "focused", if (hasFocus) "focused" else "unfocused")
      }.also(observer::addOnWindowFocusChangeListener)
    }

    watchAttach(decor.findFocus())
    record("start", "-", describe(decor.findFocus()))
  }

  private fun stop() {
    val observer = decorView()?.viewTreeObserver
    focusListener?.let { observer?.removeOnGlobalFocusChangeListener(it) }
    focusListener = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      windowFocusListener?.let { observer?.removeOnWindowFocusChangeListener(it) }
    }
    windowFocusListener = null
    unwatchAttach()
  }

  /**
   * Follows whichever view holds focus, so a detach can be attributed to it.
   *
   * Only one view is watched at a time — the one that matters — because a
   * listener on every view in the tree would cost more than it tells.
   */
  private fun watchAttach(view: View?) {
    if (view === watchedForAttach) return
    unwatchAttach()
    if (view == null) return

    val listener = object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(v: View) = record("attach", "-", describe(v))
      override fun onViewDetachedFromWindow(v: View) = record("detach", describe(v), "-")
    }
    view.addOnAttachStateChangeListener(listener)
    attachListener = listener
    watchedForAttach = view
  }

  private fun unwatchAttach() {
    val view = watchedForAttach
    val listener = attachListener
    if (view != null && listener != null) view.removeOnAttachStateChangeListener(listener)
    attachListener = null
    watchedForAttach = null
  }

  /** Class and id only. Never text: see the note at the top of this file. */
  private fun describe(view: View?): String {
    if (view == null) return "none"
    val id = try {
      if (view.id == View.NO_ID) "NO_ID" else view.id.toString()
    } catch (_: Throwable) {
      "?"
    }
    return "${view.javaClass.simpleName}#$id"
  }

  /**
   * The frames worth keeping, as one line.
   *
   * Android's own plumbing and this file are dropped, because they are on
   * every stack and say nothing; what is left is the first frames that differ
   * between one focus change and another. Bounded, because a diagnostic line
   * has to fit somewhere a person will read it.
   */
  private fun safeStack(): String =
    Throwable().stackTrace
      .asSequence()
      .drop(1)
      .filterNot { it.className.startsWith("expo.modules.focustrace") }
      .filterNot { it.className.startsWith("java.lang.Thread") }
      .take(12)
      .joinToString(" < ") { "${it.className.substringAfterLast('.')}.${it.methodName}:${it.lineNumber}" }

  private fun record(kind: String, from: String, to: String) {
    val entry = Record(
      uptime = android.os.SystemClock.uptimeMillis(),
      wall = System.currentTimeMillis(),
      kind = kind,
      from = from,
      to = to,
      stack = safeStack(),
    )
    synchronized(records) {
      if (records.size >= capacity) records.removeFirst()
      records.addLast(entry)
    }
  }
}
