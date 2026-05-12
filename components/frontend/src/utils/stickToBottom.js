/**
 * useStickToBottom — chat-UI "follow the conversation" behavior.
 *
 * Industry-standard pattern (ChatGPT / Slack / Discord / Linear): if the user
 * is at/near the bottom of the scroll container when new content arrives,
 * smoothly scroll to keep them at the bottom. If they have scrolled up to
 * read older messages, leave them where they are — never yank.
 *
 * Pass either:
 *   • a ref to the scroll container itself, OR
 *   • a ref to a marker element placed at the end of the list — the hook
 *     walks up to find the nearest scrollable ancestor.
 *
 * deps:  the dependency array that fires on new content (e.g. [messages]).
 */
import { useEffect, useLayoutEffect, useRef } from "react";

// How far from the bottom still counts as "at the bottom".
// 120 px ≈ one short message of headroom; gives streaming replies room
// to grow a token or two before we lock the position.
const NEAR_BOTTOM_PX = 120;

function findScrollParent(el) {
  let node = el?.parentElement;
  while (node && node !== document.body) {
    const cs = window.getComputedStyle(node);
    const oy = cs.overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return node;
    node = node.parentElement;
  }
  return null;
}

export function useStickToBottom(targetRef, deps) {
  const wasAtBottom = useRef(true);
  const scrollerRef = useRef(null);

  // Resolve the scroll container once on mount and wire up a scroll
  // listener that tracks whether the user is at the bottom.
  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const cs = window.getComputedStyle(target);
    const scroller =
      cs.overflowY === "auto" || cs.overflowY === "scroll"
        ? target
        : findScrollParent(target);
    if (!scroller) return;
    scrollerRef.current = scroller;

    const update = () => {
      const dist =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      wasAtBottom.current = dist <= NEAR_BOTTOM_PX;
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", update);
      scrollerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On dep change: glue to bottom if user was already there.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !wasAtBottom.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
