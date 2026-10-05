# Architecture

How Python Nodemap works, for people who want to change it. Read the [README](../README.md) first for what it does and
[ADDING_A_LIBRARY.md](ADDING_A_LIBRARY.md) if you only want to add a module.

There is no build step. Everything is plain scripts loaded by `index.html`; third-party code comes from CDNs.

## The big picture

```
 main thread                                           Web Worker (worker.js)
 ┌─────────────────────────────────────────┐          ┌───────────────────────────────────────┐
 │ app.js     IDE: files, editor, console, │  init    │ Pyodide (CPython 3.13 in WebAssembly) │
 │            run/stop, stepping, share    │ ───────► │  runner.py   analyze() / run()        │
 │ nodemap.js SVG node map + PNG export    │ analyze  │  libs/*/lib.py  (one per library)     │
 │ complete.js autocomplete                │ run      │                                       │
 │ libs.js    registry of libraries        │ ───────► │ sys.settrace records values per line  │
 │ libs/*/lib.js manifests + GUI views     │ ◄─────── │ stdout/stderr, GUI trees, results     │
 └─────────────────────────────────────────┘ messages └───────────────────────────────────────┘
```

Python runs in a worker so the page never freezes and **Stop** can simply kill the worker (it restarts in a couple of
seconds; the downloaded files are cached).

### Files

| File | Role |
| --- | --- |
| `index.html`, `style.css` | Page shell, themes (CSS variables), VS Code look, the floating tkinter windows' look. |
| `app.js` | Everything about the IDE: state, files/tabs, editor (CodeMirror), console, run/stop/`input()`, stepping, node-map interactions, preferences, import/export/share. Globals such as `S` (state) and `W` (worker client) are handy in the browser console. |
| `nodemap.js` | `NodeMap.build(graph, trace, opts)` → SVG string (layout, wire routing, themes, folding); `NodeMap.png()`; `NodeMap.viewAt()` (rebuilds values at step *n*). |
| `libs.js` | `PyLibs`: the registry every library registers with. |
| `complete.js` | Autocomplete; its data comes from the registry. |
| `worker.js` | One function, `workerMain`, whose source text becomes a Blob worker (so it can't use outside variables). |
| `runner.py` | The Python backend (see below). Knows nothing about specific libraries. |
| `libs/<name>/` | `lib.js` manifest (+ view for GUI libraries) and optional `lib.py`. |
| `tests/test_backend.py` | Backend tests. |

## Start-up

1. `index.html` loads `libs.js`, then each `libs/<name>/lib.js` (registration order = load order), then `worker.js`,
   `nodemap.js`, `complete.js`, `app.js`.
2. `app.js` fetches `runner.py` and every library's `lib.py` (as text) and starts the worker with an `init` message.
3. The worker downloads Pyodide's four big files itself (so the page can show a real progress bar), calls `loadPyodide`, runs
   `runner.py` in a namespace named `nm_runner`, calls `configure(names)` (the import allow-list) and `load_lib(name, src)`
   for each library in order.
4. The page enables **Run** and analyzes the active file.

Pyodide is pinned (`PYODIDE` in `app.js`) to 0.29.x because Pyodide 314+ only supports *module* workers, and a classic Blob
worker is simpler. Lifting the pin means testing worker creation in Chrome and Firefox.

## Analysis (`analyze`)

`analyze(src, mods_json)` parses with `ast` and returns JSON `{nodes, wires, hints}`; it never runs the code, so the map
updates while you type (debounced, and re-analysis is skipped when neither the code nor the file list changed).

- **Nodes**: one per statement (docstrings skipped), numbered in pre-order, with `kids` for compound statements. `elif` is a
  sibling of its `if`; `else:`/`finally:` are small pseudo-nodes. `show` lists the names a node defines (its value box).
- **Wires**: for each name a statement uses, `sources()` finds the definition that reaches it: the nearest earlier one in the
  same scope chain (class scopes are skipped from inside methods, `global` is honoured, `self.x` is a name shared across a
  class's methods), plus one loop-carried definition. A call to a function/class/method becomes a `call` wire (`two: true`
  when the function returns a value). This is deliberately **flow-insensitive**: branches that both assign a name only show the
  last one.
- **Hints**: lint rules that reuse the same tables (unused variable, use before assignment, missing `return`, ...).
  Add a rule in `analyze()`; it appears as a squiggle with no UI work.

## Running and tracing (`run`)

`run(files, main, mode, answers, seed)` writes the project into a temp directory and executes the active file inside a
sandbox set up by `enter()`:

- an **import guard** (`builtins.__import__`) that only allows registered libraries and the project's own files, only for code
  that belongs to the user (library internals import freely);
- `input()` replaced, stdout/stderr wrapped (temp paths hidden, output capped);
- `sys.settrace` with a per-line callback. After each line runs, the *next* line event snapshots the values of the names that
  statement defines (`snap`), so a node shows what its statement produced. It also records call counts, parameters and
  return values per function.

The result is JSON: aggregate values/hit counts per file (`files`), a **timeline** (`steps` = every executed `(file, line)`;
`facts` = values that became known before step *n*), the error location, and whether a GUI window is still open. Caps keep it
bounded: 1.5 M traced lines (assumed infinite loop), 30,000 recorded steps, 400 k characters of output.

The page shows either the aggregate (finished) or `NodeMap.viewAt(timeline, n)` (stepping), which replays the facts up to
step *n*.

**`input()`** can't block inside a worker without special HTTP headers (SharedArrayBuffer), so it raises `NeedInput`; the page
shows an input box, then calls `run` again with the answers collected so far. Output already shown is skipped, and `random`
is seeded identically each time, so the program behaves the same up to the point it asked.

**Modes**: `run(..., mode)` with a mode id a library registered (`doctest`, `unittest`) imports the file as a module and hands
it to that library's function instead of running it as `__main__`.

## The node map

`NodeMap.build` lays nodes out in one vertical column in source order; containers nest. Wires never cross a card: each leaves
the source's right edge, runs down a gutter *lane*, crosses the gap above its target (where its label sits) and enters the
target's left edge. Lanes are assigned by interval colouring so non-overlapping wires share one. All colours are CSS variables
on the `<svg>` (two palettes: dark/light), so the same markup serves the screen and the PNG export, which rasterises the SVG
through a canvas. Collapsing a container hides its descendants and re-attaches their wires to it. Hover/cursor highlighting
and search are done in `app.js` by toggling CSS classes on the existing SVG, without a redraw.

## GUI libraries (tkinter, turtle)

A library that opens windows registers *hooks* (`gui_hooks` in its `lib.py`, [details](ADDING_A_LIBRARY.md#gui-libraries))
and a *view* (in its `lib.js`). The flow:

1. While the script runs, the library posts its widget tree (`set_post`) whenever it wants a frame (`update()`); the
   worker forwards it as `{type: 'gui', lib, tree}` and the view draws it. This is how animations play while Python is busy.
2. After the script returns, `run()` asks each backend if it is `active()`. If so the sandbox is kept (`_LIVE`) and a window
   stays open, like IDLE/Thonny.
3. Clicks and keys go page → worker as `guievent` → `gui_event(lib, json)` → the backend's `dispatch`, executed back inside
   the sandbox with tracing on, so callbacks update the node map (`{type: 'trace'}` carries the new values). `after()` timers
   are driven by `setTimeout` in the worker from the `next` value in each reply.
4. A new **Run**, **Stop**, or replacing the project closes the windows (`tree: null`) and calls the backends' `reset()`.

`turtle` has no view at all: it draws on a tkinter `Canvas`, so it only needed `lib.py`.

The tkinter view (`libs/tkinter/lib.js`) is the biggest piece of front-end code: `pack` is rendered as nested flex boxes (the
first slave takes a band of the cavity, the rest share what is left), `grid` as CSS grid, `place` as absolutely positioned
boxes. Widget DOM elements are reused between updates, and `Entry`/`Text` values are only written when Python changed them
(a revision counter), so typing is never overwritten by a stale value.

## Persistence and sharing

`localStorage`: `python_nodemap.v1` (files, open tabs, active file) and `python_nodemap.prefs` (theme, font size, zoom, wire
filters). A share link is `#p=` plus the project as JSON, deflated (`CompressionStream`, falling back to uncompressed) and
base64url-encoded; it lives in the URL fragment, so it is never sent to a server. Opening one asks for confirmation and
**replaces** the whole project, as does importing a zip; importing loose `.py` files only adds them.

## Browser differences we hit

- `Element.scrollIntoView()` does nothing for SVG elements in Firefox, so the map scrolls itself (`reveal()` in `app.js`), and
  redraws restore the scroll position explicitly.
- Moving a focused element in the DOM drops its focus; `TkView.apply` restores focus and caret after re-layout.
- A tree can arrive after the page already closed the windows (messages in flight); the worker sends `tree: null` after a
  reset and at the start of each run so the last message always wins.
- Module state lives for the whole session, not per run (a library's `lib.py` runs once). Anything a library keeps between
  runs, like turtle's `Screen`, must notice that its window is gone.

## Testing

`python tests/test_backend.py` covers the Python side. For UI changes, drive the page with a real browser (we used
`puppeteer-core` against both Chrome and Firefox): run programs and assert on the DOM, canvas pixels and console text.
Things that are easy to break: scrolling in both browsers, focus while typing in tkinter windows, pack/grid layout
geometry, stale windows after Stop/replace, and the first load over a slow connection.
