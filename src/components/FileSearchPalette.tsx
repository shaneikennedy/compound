import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { filterRepoFilePaths } from "../palette/filterRepoFiles";

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

export function FileSearchPalette({
  open,
  onClose,
  filePaths,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  filePaths: ReadonlySet<string> | null;
  onPick: (relativePath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRowRef = useRef<HTMLLIElement | null>(null);

  const results = useMemo(
    () =>
      filePaths && filePaths.size > 0
        ? filterRepoFilePaths(filePaths, query)
        : [],
    [filePaths, query],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    setHighlight((h) => {
      if (results.length === 0) return 0;
      return Math.min(h, results.length - 1);
    });
  }, [results.length, query]);

  useEffect(() => {
    if (!open) return;
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const moveHighlight = useCallback(
    (delta: number) => {
      if (results.length === 0) return;
      setHighlight((h) => {
        const next = h + delta;
        if (next < 0) return results.length - 1;
        if (next >= results.length) return 0;
        return next;
      });
    },
    [results.length],
  );

  const confirm = useCallback(() => {
    const path = results[highlight];
    if (path == null) return;
    onPick(path);
    onClose();
  }, [highlight, onClose, onPick, results]);

  const onInputKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveHighlight(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveHighlight(-1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        confirm();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.ctrlKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        moveHighlight(1);
        return;
      }
      if (e.ctrlKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        moveHighlight(-1);
        return;
      }
    },
    [confirm, moveHighlight, onClose],
  );

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const hasIndex = filePaths != null && filePaths.size > 0;
  const activeId =
    results.length > 0 ? `file-palette-opt-${highlight}` : undefined;

  return createPortal(
    <div
      className="file-palette-backdrop"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="file-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search files"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="file-palette-input-row">
          <input
            ref={inputRef}
            type="search"
            className="file-palette-input"
            placeholder={
              hasIndex ? "Search files…" : "Open a folder to search files"
            }
            value={query}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-activedescendant={activeId}
            aria-controls="file-palette-listbox"
            disabled={!hasIndex}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setHighlight(0);
            }}
            onKeyDown={onInputKeyDown}
          />
        </div>
        {!hasIndex ? (
          <div className="file-palette-empty">
            Nothing indexed yet — open or clone a repository first.
          </div>
        ) : results.length === 0 ? (
          <div className="file-palette-empty">No matching files.</div>
        ) : (
          <ul
            id="file-palette-listbox"
            className="file-palette-list"
            role="listbox"
            aria-label="File results"
          >
            {results.map((path, i) => {
              const base = basename(path);
              const isActive = i === highlight;
              return (
                <li
                  ref={isActive ? activeRowRef : undefined}
                  id={`file-palette-opt-${i}`}
                  key={path}
                  role="option"
                  aria-selected={isActive}
                  className={
                    isActive ? "file-palette-row file-palette-row-active" : "file-palette-row"
                  }
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(path);
                    onClose();
                  }}
                >
                  <span className="file-palette-row-name">{base}</span>
                  <span className="file-palette-row-path">{path}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="file-palette-footer">
          <span>
            <kbd>↑↓</kbd> move
          </span>
          <span>
            <kbd>⌃N</kbd> <kbd>⌃P</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
