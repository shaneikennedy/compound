import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const DOUBLE_SPACE_MS = 450;

/** First row letters, left-to-right; extended with home row if many landmarks */
const QWERTY_HINT_ROW = Array.from(
  "qwertyuiopasdfghjkl",
) as readonly string[];

/** True when Space should type (do not treat as focus-map chord). */
function isTypingSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(".file-palette-backdrop")) return true;
  if (target.closest(".magit-backdrop")) return true;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute("role") === "textbox") return true;
  return false;
}

function blurIfTypingFocused() {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement)) return;
  if (!isTypingSurface(a)) return;
  a.blur();
}

function isLandmarkVisible(el: HTMLElement): boolean {
  if (el.closest(".tree-panel.collapsed")) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
}

function collectLandmarks(root: HTMLElement): { el: HTMLElement; label: string }[] {
  const nodes = root.querySelectorAll("[data-focus-landmark]");
  const out: { el: HTMLElement; label: string }[] = [];
  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (!isLandmarkVisible(node)) return;
    const label =
      node.dataset.focusMapLabel?.trim() ||
      node.getAttribute("aria-label")?.trim() ||
      "Focus area";
    out.push({ el: node, label });
  });
  return out;
}

function assignQwertyHints(
  items: { el: HTMLElement; label: string }[],
): FocusSpotMeasured[] {
  return items.slice(0, QWERTY_HINT_ROW.length).map((item, i) => {
    const r = item.el.getBoundingClientRect();
    return {
      el: item.el,
      label: item.label,
      hintKey: QWERTY_HINT_ROW[i]!,
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    };
  });
}

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isSubtreeHidden(el: Element): boolean {
  const style = getComputedStyle(el);
  return (
    style.visibility === "hidden" ||
    style.display === "none" ||
    el.getAttribute("aria-hidden") === "true"
  );
}

function focusScrollSurfaceWithin(region: HTMLElement): boolean {
  const surface = region.querySelector<HTMLElement>(
    "[data-focus-scroll-surface]",
  );
  if (!surface || isSubtreeHidden(surface)) return false;
  try {
    surface.focus({ preventScroll: true });
    if (document.activeElement === surface) return true;
    surface.focus();
    return document.activeElement === surface;
  } catch {
    return false;
  }
}

function focusLandmark(region: HTMLElement) {
  if (focusScrollSurfaceWithin(region)) return;
  if (focusFirstFocusable(region)) return;

  const host = region.querySelector(".repo-file-tree-host");
  if (host instanceof HTMLElement && host.shadowRoot) {
    if (focusFirstFocusable(host.shadowRoot)) return;
    try {
      host.focus({ preventScroll: true });
      if (document.activeElement === host) return;
    } catch {
      /* ignore */
    }
  }

  region.focus({ preventScroll: true });
}

function focusFirstFocusable(scope: DocumentFragment | Element): boolean {
  const candidates = scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i]!;
    if (isSubtreeHidden(el)) continue;
    if (el.closest(".file-palette-backdrop")) continue;
    if (el.closest(".magit-backdrop")) continue;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return true;
    try {
      el.focus();
    } catch {
      continue;
    }
    if (document.activeElement === el) return true;
  }
  return false;
}

/** Prefer first tabbable in the landmark; fallback to programmatic region focus */
function applyLandmarkFocus(region: HTMLElement) {
  focusLandmark(region);
}

type FocusSpotMeasured = {
  el: HTMLElement;
  label: string;
  hintKey: string;
  top: number;
  left: number;
  width: number;
  height: number;
};

export function FocusMapOverlay({
  disabled,
  landmarksRootRef,
}: {
  disabled: boolean;
  landmarksRootRef: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [spots, setSpots] = useState<FocusSpotMeasured[]>([]);
  const lastSpaceAt = useRef(0);
  const spotsRef = useRef<FocusSpotMeasured[]>(spots);
  spotsRef.current = spots;

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const refreshSpots = useCallback(() => {
    const root = landmarksRootRef.current;
    if (!root) {
      setSpots([]);
      return;
    }
    setSpots(assignQwertyHints(collectLandmarks(root)));
  }, [landmarksRootRef]);

  useLayoutEffect(() => {
    if (!open) {
      setSpots([]);
      return;
    }
    refreshSpots();
    const onResize = () => refreshSpots();
    window.addEventListener("resize", onResize);
    const afterLayout = window.setTimeout(refreshSpots, 220);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(afterLayout);
    };
  }, [open, refreshSpots]);

  useEffect(() => {
    if (disabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      /* Palette mode: chord disabled separately via `disabled`; never double-space inside palette */
      const t = e.target;
      if (t instanceof Element && t.closest(".file-palette-backdrop")) return;
      if (t instanceof Element && t.closest(".magit-backdrop")) return;

      const now = Date.now();
      if (now - lastSpaceAt.current < DOUBLE_SPACE_MS) {
        e.preventDefault();
        blurIfTypingFocused();
        setOpen((was) => !was);
        lastSpaceAt.current = 0;
        return;
      }
      lastSpaceAt.current = now;
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : "";
      const isQwertyLetter = /^[a-z]$/.test(k);
      if (
        isQwertyLetter &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const spot = spotsRef.current.find((s) => s.hintKey === k);
        if (spot) {
          e.preventDefault();
          const region = spot.el;
          setOpen(false);
          requestAnimationFrame(() => {
            applyLandmarkFocus(region);
          });
          return;
        }
      }

      if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="focus-map-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard focus map"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) setOpen(false);
      }}
    >
      <div className="focus-map-hud">
        {spots.map((item) => (
          <div
            key={item.hintKey}
            className="focus-map-frame"
            style={{
              top: item.top,
              left: item.left,
              width: item.width,
              height: item.height,
            }}
          >
            <span className="focus-map-badge">
              <span className="focus-map-hint-letter" aria-hidden>
                {item.hintKey.toUpperCase()}
              </span>
              <span className="focus-map-badge-label">{item.label}</span>
            </span>
          </div>
        ))}
        <footer className="focus-map-footer">
          <span className="focus-map-footer-dynamic">
            {spots.map((s) => (
              <kbd key={s.hintKey}>{s.hintKey}</kbd>
            ))}
            <span className="focus-map-footer-jump"> jump</span>
          </span>
          <span>
            <kbd>Space</kbd> <kbd>Space</kbd> toggle
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
          <span>
            <kbd>Tab</kbd> move focus
          </span>
          <span title="Search files">
            <kbd>⌘</kbd>
            <kbd>K</kbd> / <kbd>Ctrl</kbd>
            <kbd>K</kbd> files
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
