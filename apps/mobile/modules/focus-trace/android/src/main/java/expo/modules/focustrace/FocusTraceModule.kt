package expo.modules.focustrace

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import expo.modules.kotlin.Promise
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
 * Build 40 answered it in one line: `SurfaceMountingManager.removeViewAt`
 * detaching the focused `ReactEditText`. This revision is what that answer
 * asked for — the parts of the instrument that could have lied, made honest.
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
 *  * **`OnAttachStateChangeListener`** on the views around a focus change —
 *    whether one is being detached and re-attached. Stable native tags never
 *    excluded that, and this is what shows it.
 *
 * **Not covered, and no listener can cover it:** updates to `inputType`,
 * `keyListener` or `focusable` on `ReactEditText`. Those are property writes
 * with no observer to hang off; catching them needs a subclass or a hook into
 * React Native's view manager, which is a larger change than this and is not
 * attempted here.
 *
 * ## Three things this revision fixes, each of which could have produced a
 * false negative
 *
 *  * **The view that is detached is the one *losing* focus, not the one
 *    gaining it.** The previous revision followed only `newFocus`, so whether
 *    a detach was seen at all depended on the order Android happens to run
 *    `removeViewInternal` in. Both sides of every focus change are now
 *    watched, plus a few most-recent views, so a detach cannot fall between
 *    the two.
 *  * **Listeners must be removed from the observer they were added to.**
 *    `View.getViewTreeObserver()` returns a *different* object once the old
 *    one is no longer alive, so `stop()` fetching a fresh one could leave the
 *    listeners installed on a dead observer and report success. The observer
 *    and the decor view are stored at `start()` and removal goes to those.
 *  * **`start()` reports what actually happened.** It used to return nothing
 *    and to return early in silence when there was no decor view or when it
 *    had already been started. Now every observer's installation is reported
 *    individually, so "armed" is a measurement rather than an assumption.
 *
 * ## Timing and delivery
 *
 * Every record carries the **native** timestamp taken inside the callback —
 * `SystemClock.uptimeMillis()`, monotonic and unaffected by the clock — plus
 * the wall clock, which is the only thing that lines a native record up
 * against a JavaScript one. Both are handed over; neither is derived from the
 * other.
 *
 * Delivery is a pull, not a push, and deliberately: events are buffered here
 * from the moment the observers start, and JavaScript takes them when it is
 * ready. Nothing that happens before the JS side subscribes is lost, which a
 * fire-and-forget event emitter could not promise. The buffer is bounded, so
 * it *can* overflow — and when it does, `drain` says by how many rather than
 * letting a gap pass for silence.
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

  /**
   * How many records the bound above has thrown away.
   *
   * A dropped record and a quiet moment look identical in the log, and one of
   * them means the instrument failed. Reported on every drain and reset only
   * when it has been handed over.
   */
  private var dropped = 0L

  /**
   * The observer the listeners were actually installed on, and the view it
   * came from.
   *
   * Not re-fetched at `stop()`: `getViewTreeObserver()` hands back a new
   * object once the old one is dead, and removing from that one silently
   * leaves these installed.
   */
  private var installedObserver: ViewTreeObserver? = null
  private var installedDecor: View? = null

  private var focusListener: ViewTreeObserver.OnGlobalFocusChangeListener? = null
  private var windowFocusListener: ViewTreeObserver.OnWindowFocusChangeListener? = null

  /**
   * Views currently watched for attach and detach.
   *
   * A map rather than a single view, because both sides of a focus change
   * matter and the losing side is the one that gets detached. Ordered and
   * bounded: the oldest is dropped once the limit is passed, so this cannot
   * accumulate a listener per view ever focused.
   */
  private val attachWatched = LinkedHashMap<View, View.OnAttachStateChangeListener>()
  private val attachWatchLimit = 4

  override fun definition() = ModuleDefinition {
    Name("TuTakFocusTrace")

    /** Installs the observers and reports, per observer, whether it took. */
    Function("start") { start() }

    Function("stop") { stop() }

    /**
     * Hands over everything buffered, empties the buffer, and says how many
     * records were lost to the bound since the last call.
     */
    Function("drain") {
      synchronized(records) {
        // Doubles at the boundary, not Longs: every value here is well under
        // 2^53 so nothing is lost, and it keeps the crossing to types the
        // bridge converts without question — a conversion that failed here
        // would surface as an empty trace, which is the one failure this
        // module exists to make impossible.
        val out = records.map {
          mapOf(
            "uptime" to it.uptime.toDouble(),
            "wall" to it.wall.toDouble(),
            "kind" to it.kind,
            "from" to it.from,
            "to" to it.to,
            "stack" to it.stack,
          )
        }
        val lost = dropped
        records.clear()
        dropped = 0
        mapOf("records" to out, "dropped" to lost.toDouble())
      }
    }

    /**
     * Where a view actually sits in the native tree, by React tag.
     *
     * This exists for one question that nothing in JavaScript can answer:
     * whether `collapsable={false}` was applied. Fabric mounts a flattened
     * node's children into an ancestor, so a field box with `kids=0` is
     * flattened and one with `kids=2` is not — which is the difference under
     * test, read directly rather than inferred from whether the fault
     * happened.
     *
     * On the UI thread, because it walks the view tree.
     */
    AsyncFunction("inspect") { tag: Int, promise: Promise ->
      Handler(Looper.getMainLooper()).post {
        try {
          val view = findByTag(decorView(), tag)
          if (view == null) {
            promise.resolve(mapOf("found" to false, "tag" to tag))
          } else {
            val parent = view.parent as? View
            val kids = if (view is ViewGroup) view.childCount else 0
            val kidTags =
              if (view is ViewGroup) (0 until view.childCount).map { describe(view.getChildAt(it)) }
              else emptyList()
            promise.resolve(
              mapOf(
                "found" to true,
                "tag" to tag,
                "cls" to view.javaClass.simpleName,
                "parent" to describe(parent),
                "kids" to kids,
                "kidsDescribed" to kidTags,
              )
            )
          }
        } catch (err: Throwable) {
          promise.resolve(mapOf("found" to false, "tag" to tag, "error" to (err.message ?: "?")))
        }
      }
    }

    OnDestroy { stop() }
  }

  private fun decorView(): View? =
    appContext.activityProvider?.currentActivity?.window?.decorView

  /**
   * Installs what can be installed and reports each part separately.
   *
   * Every field of the returned map is a measurement, not an intention: a
   * `false` means that observer is genuinely not running, and the JS side
   * prints it rather than saying "armed" over the top of it.
   */
  private fun start(): Map<String, Any> {
    val decor = decorView()
      ?: return mapOf(
        "ok" to false,
        "focus" to false,
        "window" to false,
        "attach" to 0,
        "alive" to false,
        "sdk" to Build.VERSION.SDK_INT,
        "reason" to "no decor view",
      )

    if (focusListener != null) {
      return mapOf(
        "ok" to true,
        "focus" to true,
        "window" to (windowFocusListener != null),
        "attach" to attachWatched.size,
        "alive" to (installedObserver?.isAlive ?: false),
        "sdk" to Build.VERSION.SDK_INT,
        "reason" to "already started",
      )
    }

    val observer = decor.viewTreeObserver
    val alive = observer.isAlive
    var focusOk = false
    var windowOk = false
    var reason = ""

    try {
      val listener = ViewTreeObserver.OnGlobalFocusChangeListener { oldFocus, newFocus ->
        record("focus", describe(oldFocus), describe(newFocus))
        // Both sides. The detached view is the one *losing* focus, and which
        // of the two Android reports first is not something to depend on.
        watchAttach(oldFocus)
        watchAttach(newFocus)
      }
      observer.addOnGlobalFocusChangeListener(listener)
      focusListener = listener
      focusOk = true
    } catch (err: Throwable) {
      reason = "focus listener: ${err.message ?: "?"}"
    }

    // API 28 and up only; on anything older this signal is simply absent and
    // its absence is reported rather than faked.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        val listener = ViewTreeObserver.OnWindowFocusChangeListener { hasFocus ->
          record(
            "window",
            if (hasFocus) "unfocused" else "focused",
            if (hasFocus) "focused" else "unfocused",
          )
        }
        observer.addOnWindowFocusChangeListener(listener)
        windowFocusListener = listener
        windowOk = true
      } catch (err: Throwable) {
        reason = "${reason}${if (reason.isEmpty()) "" else "; "}window listener: ${err.message ?: "?"}"
      }
    } else {
      reason = "${reason}${if (reason.isEmpty()) "" else "; "}window listener needs API 28"
    }

    if (focusOk || windowOk) {
      installedObserver = observer
      installedDecor = decor
    }

    watchAttach(decor.findFocus())
    record("start", "-", describe(decor.findFocus()))

    return mapOf(
      "ok" to focusOk,
      "focus" to focusOk,
      "window" to windowOk,
      "attach" to attachWatched.size,
      "alive" to alive,
      "sdk" to Build.VERSION.SDK_INT,
      "reason" to reason,
    )
  }

  private fun stop() {
    // The stored observer, never a freshly fetched one — see the field.
    val observer = installedObserver
    if (observer != null && observer.isAlive) {
      focusListener?.let { observer.removeOnGlobalFocusChangeListener(it) }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        windowFocusListener?.let { observer.removeOnWindowFocusChangeListener(it) }
      }
    }
    focusListener = null
    windowFocusListener = null
    installedObserver = null
    installedDecor = null
    unwatchAll()
  }

  /** Starts watching one view for attach/detach, if it is not already watched. */
  private fun watchAttach(view: View?) {
    if (view == null || attachWatched.containsKey(view)) return

    val listener = object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(v: View) = record("attach", "-", describe(v))
      override fun onViewDetachedFromWindow(v: View) = record("detach", describe(v), "-")
    }
    view.addOnAttachStateChangeListener(listener)
    attachWatched[view] = listener

    while (attachWatched.size > attachWatchLimit) {
      val eldest = attachWatched.keys.firstOrNull() ?: break
      attachWatched.remove(eldest)?.let { eldest.removeOnAttachStateChangeListener(it) }
    }
  }

  private fun unwatchAll() {
    for ((view, listener) in attachWatched) view.removeOnAttachStateChangeListener(listener)
    attachWatched.clear()
  }

  private fun findByTag(root: View?, tag: Int): View? {
    if (root == null) return null
    if (root.id == tag) return root
    if (root is ViewGroup) {
      for (i in 0 until root.childCount) {
        val hit = findByTag(root.getChildAt(i), tag)
        if (hit != null) return hit
      }
    }
    return null
  }

  /**
   * Class and id only. Never text: see the note at the top of this file.
   *
   * The id is React's own tag — `ViewManager.createView` sets it as the
   * view's id — which is what makes these lines readable against the
   * JavaScript log's `t=` values.
   */
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
      if (records.size >= capacity) {
        records.removeFirst()
        dropped++
      }
      records.addLast(entry)
    }
  }
}
