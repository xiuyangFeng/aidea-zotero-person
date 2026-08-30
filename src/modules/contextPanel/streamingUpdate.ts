/**
 * Streaming Update Module
 *
 * Provides incremental DOM updates during LLM streaming responses.
 * Instead of re-rendering the entire chat history on each token,
 * only the last assistant bubble is patched in place.
 */

import {
  escapeHtml,
  renderBlock,
  renderMarkdown,
  splitIntoBlocks,
  type TextBlock,
} from "../../utils/markdown";
import { sanitizeText } from "./textUtils";
import {
  stripStreamingSuggestedQuestions,
  stripSuggestedQuestions,
} from "../../utils/suggestedQuestions";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default throttle interval (ms) for streaming patch updates. */
const DEFAULT_PATCH_INTERVAL_MS = 30;

/** Frame fallback (ms) when requestAnimationFrame is unavailable. */
const FRAME_FALLBACK_INTERVAL_MS = 16;

/** Default auto-scroll threshold (px from bottom). */
const DEFAULT_AUTO_SCROLL_THRESHOLD = 64;

/** Maximum number of finalized-message markdown renders kept cached. */
const MARKDOWN_RENDER_CACHE_LIMIT = 200;

// ---------------------------------------------------------------------------
// DOM Lookup
// ---------------------------------------------------------------------------

/**
 * Find the last assistant bubble inside the chatBox.
 * This is the bubble that `refreshChat` created for the streaming message
 * (which starts as a skeleton).
 *
 * Returns `null` if no assistant bubble exists.
 */
export function findLastAssistantBubble(
  chatBox: HTMLDivElement | null,
): HTMLDivElement | null {
  if (!chatBox) return null;
  const wrappers = chatBox.querySelectorAll(".llm-message-wrapper.assistant");
  if (!wrappers.length) return null;
  const lastWrapper = wrappers[wrappers.length - 1];
  return lastWrapper.querySelector(
    ".llm-bubble.assistant",
  ) as HTMLDivElement | null;
}

/**
 * Find the assistant bubble for a specific persisted message node.
 *
 * Streaming requests can keep running while the user switches conversation
 * variants. Looking up the bubble by id on every patch prevents deltas from
 * being applied to whichever assistant happens to be visible last.
 */
export function findAssistantBubbleByMessageId(
  chatBox: HTMLDivElement | null,
  messageId: number | undefined,
): HTMLDivElement | null {
  if (!chatBox || !Number.isFinite(messageId)) return null;
  const wrappers = Array.from(
    chatBox.querySelectorAll(".llm-message-wrapper.assistant"),
  ) as Element[];
  for (const wrapper of wrappers) {
    if (
      typeof HTMLElement !== "undefined" &&
      wrapper instanceof HTMLElement &&
      wrapper.dataset.messageId === String(messageId)
    ) {
      return wrapper.querySelector(
        ".llm-bubble.assistant",
      ) as HTMLDivElement | null;
    }
    const attr = wrapper.getAttribute("data-message-id");
    if (attr === String(messageId)) {
      return wrapper.querySelector(
        ".llm-bubble.assistant",
      ) as HTMLDivElement | null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Incremental streaming renderer
// ---------------------------------------------------------------------------

/**
 * Per-content-container render state for incremental streaming.
 *
 * During streaming, text only grows at the end, so every complete block
 * except the trailing one is immutable. We keep the stable prefix blocks in
 * the DOM untouched and re-render only the trailing (unstable) block on each
 * patch. `tailNodeCount` tracks how many trailing child nodes belong to that
 * unstable block so the next patch can replace exactly those nodes.
 */
interface StreamingRenderState {
  blockRaws: string[];
  tailNodeCount: number;
}

const streamingRenderStates = new WeakMap<Element, StreamingRenderState>();

/** Render a single markdown block with the same fallback as `renderMarkdown`. */
function renderBlockSafe(block: TextBlock): string {
  try {
    return renderBlock(block);
  } catch (err) {
    console.warn("Markdown block render error:", err);
    return `<div class="render-fallback">${escapeHtml(block.raw)}</div>`;
  }
}

/**
 * Incrementally render streaming markdown into `contentEl`.
 *
 * The first call clears `contentEl` and builds the block structure from
 * scratch; later calls only append newly-stabilized blocks and re-render the
 * trailing block. A full `renderMarkdown` pass happens once at finalize, so
 * any block-boundary edge case is corrected when the message completes.
 */
function renderStreamingContentIncremental(
  contentEl: HTMLDivElement,
  safeText: string,
): void {
  let state = streamingRenderStates.get(contentEl);
  if (!state) {
    contentEl.textContent = "";
    state = { blockRaws: [], tailNodeCount: 0 };
    streamingRenderStates.set(contentEl, state);
  }

  const blocks = splitIntoBlocks(safeText);
  if (!blocks.length) return;
  const stableCount = blocks.length - 1;

  // Longest still-valid prefix of already-rendered stable blocks. Append-only
  // streaming normally keeps every stable block identical, but a partially
  // streamed list item (e.g. a bare "- " line) can transiently split into its
  // own paragraph block and later merge backwards — dropping the stable count.
  // Only blocks from the first mismatch need re-rendering.
  let matchCount = 0;
  const maxMatch = Math.min(state.blockRaws.length, stableCount);
  while (
    matchCount < maxMatch &&
    state.blockRaws[matchCount] === blocks[matchCount].raw
  ) {
    matchCount++;
  }

  // Drop DOM nodes for everything after the still-valid stable prefix:
  // trailing tail nodes first, then any stable blocks that merged/changed.
  while (contentEl.childNodes.length > matchCount) {
    const last = contentEl.lastChild;
    if (!last) break;
    contentEl.removeChild(last);
  }
  state.tailNodeCount = 0;
  state.blockRaws.length = matchCount;

  // Append blocks that just became stable (everything before the last one).
  for (let i = state.blockRaws.length; i < stableCount; i++) {
    const html = renderBlockSafe(blocks[i]);
    contentEl.insertAdjacentHTML("beforeend", html);
    state.blockRaws.push(blocks[i].raw);
  }

  // Render the trailing unstable block, tracking how many nodes it produced
  // so the next patch can replace exactly those.
  const baseCount = contentEl.childNodes.length;
  contentEl.insertAdjacentHTML(
    "beforeend",
    renderBlockSafe(blocks[blocks.length - 1]),
  );
  state.tailNodeCount = contentEl.childNodes.length - baseCount;
}

/**
 * Find or create the stable content container inside a streaming bubble so
 * the model name element and other structural children are not clobbered.
 */
function ensureStreamingContentEl(
  bubble: HTMLDivElement,
): HTMLDivElement | null {
  const existing = bubble.querySelector(
    "[data-streaming-content]",
  ) as HTMLDivElement | null;
  if (existing) return existing;
  const doc = bubble.ownerDocument;
  if (!doc) return null;
  const contentEl = doc.createElement("div") as HTMLDivElement;
  contentEl.setAttribute("data-streaming-content", "true");
  bubble.appendChild(contentEl);
  return contentEl;
}

/**
 * Incrementally update a streaming assistant bubble's content.
 *
 * On the first call (when the skeleton is still visible), the skeleton is
 * removed and a content container (`[data-streaming-content]`) is created.
 *
 * On subsequent calls, only newly-stabilized markdown blocks and the trailing
 * block are re-rendered — completed paragraphs, code blocks, tables, and
 * KaTeX math earlier in the message are left untouched in the DOM.
 *
 * If the bubble has been removed from the DOM (e.g. the user switched panels),
 * this function is a no-op.
 */
export function patchStreamingBubble(
  bubble: HTMLDivElement | null,
  text: string,
): void {
  if (!bubble || !bubble.parentNode) return;

  // An empty streaming response is initially rendered as a skeleton. Treat
  // that skeleton as an authoritative streaming marker too, so the first
  // delta can recover even if the CSS state class was briefly out of sync.
  // Finalized bubbles have neither marker and must ignore late queued patches.
  const skeleton = bubble.querySelector(".llm-streaming-skeleton");
  if (!bubble.classList.contains("streaming") && !skeleton) return;
  bubble.classList.add("streaming");

  // The follow-up question block is stripped while it streams, not after, so
  // the marker and its questions never flash into the bubble and reflow the
  // answer above them when they are removed.
  const safeText = stripStreamingSuggestedQuestions(sanitizeText(text));
  if (!safeText) return;

  // Remove skeleton on first real content
  if (skeleton) {
    skeleton.remove();
  }

  const contentEl = ensureStreamingContentEl(bubble);
  if (!contentEl) return;

  try {
    renderStreamingContentIncremental(contentEl, safeText);
  } catch {
    // Incremental path failed — fall back to a full render, then plain text.
    streamingRenderStates.delete(contentEl);
    try {
      contentEl.innerHTML = renderMarkdown(safeText);
    } catch {
      contentEl.textContent = safeText;
    }
  }
}

/**
 * Clean up a streaming bubble after the stream completes.
 *
 * - Removes the `streaming` CSS class (hides cursor animation)
 * - Removes any leftover skeleton
 * - When `finalText` is provided, replaces the incrementally-rendered content
 *   with the exact full `renderMarkdown` output and seeds the finalized
 *   render cache so the following `refreshChat` does not re-render this
 *   message's markdown/KaTeX.
 *
 * The cache is seeded with the *stripped* body, which is what `refreshChat`
 * renders too; seeding it with the raw answer would miss on every message that
 * proposes follow-up questions.
 */
export function finalizeStreamingBubble(
  bubble: HTMLDivElement | null,
  finalText?: string,
  cacheKey?: string | null,
): void {
  if (!bubble) return;
  bubble.classList.remove("streaming");
  const skeleton = bubble.querySelector(".llm-streaming-skeleton");
  if (skeleton) skeleton.remove();

  if (finalText == null) return;
  const contentEl = bubble.querySelector(
    "[data-streaming-content]",
  ) as HTMLDivElement | null;
  if (!contentEl) return;
  streamingRenderStates.delete(contentEl);

  const safeText = stripSuggestedQuestions(sanitizeText(finalText));
  if (!safeText) return;
  try {
    const html = renderMarkdown(safeText);
    if (cacheKey) putMarkdownRenderCache(cacheKey, safeText, html);
    contentEl.innerHTML = html;
  } catch {
    contentEl.textContent = safeText;
  }
}

// ---------------------------------------------------------------------------
// Finalized markdown render cache
// ---------------------------------------------------------------------------

const markdownRenderCache = new Map<string, { text: string; html: string }>();

function putMarkdownRenderCache(
  cacheKey: string,
  text: string,
  html: string,
): void {
  const existing = markdownRenderCache.get(cacheKey);
  if (existing) markdownRenderCache.delete(cacheKey);
  markdownRenderCache.set(cacheKey, { text, html });
  if (markdownRenderCache.size > MARKDOWN_RENDER_CACHE_LIMIT) {
    const oldest = markdownRenderCache.keys().next().value;
    if (oldest !== undefined) markdownRenderCache.delete(oldest);
  }
}

/**
 * Render an assistant message's markdown, reusing the cached HTML when the
 * text is unchanged. `refreshChat` rebuilds every bubble after each response;
 * the cache skips the expensive markdown+KaTeX pass for all messages that did
 * not change. `cacheKey` must uniquely identify the message (e.g. its
 * database id); pass `null` to bypass the cache.
 */
export function renderAssistantMarkdownCached(
  cacheKey: string | null,
  text: string,
): string {
  if (!cacheKey) return renderMarkdown(text);
  const cached = markdownRenderCache.get(cacheKey);
  if (cached && cached.text === text) {
    // Refresh LRU order.
    markdownRenderCache.delete(cacheKey);
    markdownRenderCache.set(cacheKey, cached);
    return cached.html;
  }
  const html = renderMarkdown(text);
  putMarkdownRenderCache(cacheKey, text, html);
  return html;
}

// ---------------------------------------------------------------------------
// Throttle
// ---------------------------------------------------------------------------

/**
 * Create a throttled wrapper around a patch function.
 *
 * During streaming, `onDelta` fires very frequently. This helper schedules at
 * most one DOM update per animation frame and never more often than
 * `intervalMs`, keeping the UI responsive without overwhelming the renderer.
 *
 * Scheduling via `requestAnimationFrame` (when available) aligns DOM writes
 * with frame boundaries instead of firing between them; a trailing patch is
 * always executed, so the final delta is never dropped.
 *
 * @param patchFn  The function that performs the actual DOM patch.
 * @param intervalMs  Minimum interval between consecutive patches (default 30ms).
 */
export function createQueuedStreamingPatch(
  patchFn: () => void,
  intervalMs: number = DEFAULT_PATCH_INTERVAL_MS,
): () => void {
  let scheduled = false;
  let lastRunAt = 0;

  const run = () => {
    scheduled = false;
    const now = Date.now();
    if (now - lastRunAt >= intervalMs) {
      lastRunAt = now;
      patchFn();
      return;
    }
    schedule();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    const raf = (
      globalThis as { requestAnimationFrame?: (cb: () => void) => unknown }
    ).requestAnimationFrame;
    if (typeof raf === "function") {
      raf(() => run());
    } else {
      setTimeout(run, FRAME_FALLBACK_INTERVAL_MS);
    }
  };

  return schedule;
}

// ---------------------------------------------------------------------------
// Auto-scroll
// ---------------------------------------------------------------------------

/**
 * If the chatBox is scrolled near the bottom (within `threshold` px),
 * snap to the very bottom. This keeps the latest streamed content in view
 * without fighting the user if they have scrolled up.
 */
export function autoScrollStreamingIfNeeded(
  chatBox: HTMLDivElement | null,
  threshold: number = DEFAULT_AUTO_SCROLL_THRESHOLD,
): void {
  if (!chatBox) return;
  const distanceFromBottom =
    chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight;
  if (distanceFromBottom <= threshold) {
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

// ---------------------------------------------------------------------------
// Stateful streaming auto-scroller
// ---------------------------------------------------------------------------

export interface StreamingAutoScroller {
  /**
   * Whether auto-scroll is currently active.
   * Starts as `true` if the chatBox was near bottom when created.
   * Becomes `false` when the user scrolls away (see `onUserScroll`).
   */
  readonly active: boolean;

  /**
   * Call from the queued streaming-patch callback.
   * Wraps the DOM patch and scroll-to-bottom in a scroll-suspension
   * guard so the `persistScroll` handler won't write a spurious
   * `"manual"` snapshot caused by content-height jumps (e.g. KaTeX).
   */
  patchAndScroll: (patchFn: () => void) => void;

  /**
   * Call from a *user-initiated* scroll event to break auto-scroll.
   * Should only be called when the scroll was NOT caused by a
   * programmatic `scrollTop` write (i.e. `isScrollUpdateSuspended()`
   * returns false).
   */
  onUserScroll: () => void;

  /**
   * Re-activate auto-scroll (e.g. when the user clicks "scroll to bottom").
   */
  reactivate: () => void;
}

/**
 * Create a stateful auto-scroller for a streaming session.
 *
 * Unlike the stateless `autoScrollStreamingIfNeeded`, this tracks whether
 * the user was at the bottom when streaming started and keeps scrolling
 * until the user explicitly scrolls away.  This prevents formula rendering
 * (which can increase `scrollHeight` dramatically in a single frame) from
 * inadvertently breaking auto-scroll.
 *
 * @param chatBox              The scrollable chat container.
 * @param suspendScrollUpdates Callback to set `_scrollUpdatesSuspended = true`.
 * @param resumeScrollUpdates  Callback to set `_scrollUpdatesSuspended = false` (deferred).
 * @param threshold            Distance from bottom considered "near bottom".
 */
export function createStreamingAutoScroller(
  chatBox: HTMLDivElement | null,
  suspendScrollUpdates: () => void,
  resumeScrollUpdates: () => void,
  threshold: number = DEFAULT_AUTO_SCROLL_THRESHOLD,
): StreamingAutoScroller {
  let _active = false;

  // Determine initial state: auto-scroll only if already near bottom.
  if (chatBox) {
    const distanceFromBottom =
      chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight;
    _active = distanceFromBottom <= threshold;
  }

  return {
    get active() {
      return _active;
    },

    patchAndScroll(patchFn: () => void) {
      if (!chatBox) {
        patchFn();
        return;
      }

      // ── Pre-patch user-scroll detection ──
      // BEFORE executing patchFn (which may dramatically increase
      // scrollHeight via KaTeX rendering), check whether the user has
      // scrolled away from the bottom since the last patch.  At this
      // point scrollHeight hasn't changed yet, so any distance from
      // the bottom must be caused by the user scrolling.
      const distanceFromBottom =
        chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight;
      if (distanceFromBottom > threshold) {
        _active = false; // User scrolled up → stop auto-scroll
      } else {
        _active = true; // User scrolled back to bottom → resume
      }

      // Suspend scroll-event persistence so the height jump from
      // innerHTML replacement doesn't create a "manual" snapshot.
      suspendScrollUpdates();
      try {
        patchFn();
      } finally {
        if (_active) {
          chatBox.scrollTop = chatBox.scrollHeight;
        }
        // Resume asynchronously so the scroll event triggered by our
        // programmatic scrollTop write is also suppressed.
        Promise.resolve().then(resumeScrollUpdates);
      }
    },

    onUserScroll() {
      if (!chatBox) return;
      const distanceFromBottom =
        chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight;
      if (distanceFromBottom > threshold) {
        _active = false;
      } else {
        // User scrolled back to bottom — re-activate.
        _active = true;
      }
    },

    reactivate() {
      _active = true;
    },
  };
}
