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
| `index.html`, `style.css` | Page shell, themes (CSS variables), VS Code look, the look of tkinter's widgets. |
| `app.js` | Everything about the IDE: state, files/tabs, editor (CodeMirror), console, run/stop/`input()`, stepping, node-map interactions, preferences, import/export/share. Globals such as `S` (state) and `W` (worker client) are handy in the browser console. |
| `nodemap.js` | `NodeMap.build(graph, trace, opts)` → SVG string (layout, wire routing, themes, folding); `NodeMap.png()`; `NodeMap.viewAt()` (rebuilds values at step *n*). |
| `libs.js` | `PyLibs`: the registry every library registers with. |
| `complete.js` | Autocomplete; its data comes from the registry. |
| `worker.js` | One function, `workerMain`, whose source text becomes a Blob worker (so it can't use outside variables). |
| `sw.js` | A service worker that is only a mailbox: window events made while a program is running wait here until it reads them (see *Events while a program is running*). |
| `runner.py` | The Python backend (see below). Knows nothing about specific libraries. |
| `libs/<name>/` | `lib.js` manifest (+ view for GUI libraries) and optional `lib.py`. |
| `tests/test_backend.py` | Backend tests ([tests/README.md](../tests/README.md)). |
| `libs/README.md`, `docs/examples/clicker/` | What each library supports; a complete tiny GUI library to copy from. |

## Start-up

1. `index.html` loads `libs.js`, then each `libs/<name>/lib.js` (registration order = load order), then `worker.js`,
   `nodemap.js`, `complete.js`, `app.js`.
2. `app.js` registers `sw.js` and waits until it controls the page (first visit only, at most 2.5 s; skipped if there are no service
   workers), because the worker has to be created afterwards to inherit that control. Then it fetches `runner.py` and every library's
   `lib.py` (as text) and starts the worker with an `init` message.
3. The worker downloads Pyodide's four big files itself (so the page can show a real progress bar), calls `loadPyodide`, runs
   `runner.py` in a namespace named `nm_runner`, calls `configure(names)` (the import allow-list) and `load_lib(name, src)`
   for each library in order.
4. The page enables **Run** and analyzes the active file.

Pyodide is pinned (`PYODIDE` in `app.js`) to 0.29.x because Pyodide 314+ only supports *module* workers, and a classic Blob
worker is simpler. Lifting the pin means testing worker creation in Chrome and Firefox.

## Messages between the page and the worker

Every request carries an `id`; `W.call(type, data)` in `app.js` returns a promise that the matching reply settles. Other messages
are pushed by the worker whenever it likes.

| Direction | Message | Meaning |
| --- | --- | --- |
| page → worker | `init {url, runner, libs, allowed, sizes}` | Download and start Pyodide, run `runner.py`, `configure()`, `load_lib()` each library. |
| page → worker | `analyze {src, mods}` | Static analysis of one file. Reply `{id, result}` with the JSON string. |
| page → worker | `run {files, main, mode, answers, seed, mailbox, locked, opts}` | Run a program (`mailbox` is the URL of the service worker's mailbox, or `''`; `locked` lists the files the user may not open, hidden ones included; `opts` are options for a library's mode, such as the file Grade tests). Reply `{id, result}` with the JSON string. |
| page → worker | `shell {src, files, locked, mailbox}` | A line typed at the console's `>>>` prompt (`runner.shell`). Reply `{id, result}`: `{more, files}`. |
| page → worker | `guievent {lib, ev}` | The user did something in a library's window (no reply of its own; frames come back as `gui`). |
| page → worker | `guireset` | The project was replaced: stop the windows and their timers. |
| page → worker | `guidrain` | A run just ended: read the mailbox once more, for events sent after Python's last read. |
| worker → page | `{id, result}` or `{id, error}` | The reply to a request. |
| worker → page | `out {cls, text}` | Console output, batched (`cls` is `''` for stdout, `'err'` for stderr). |
| worker → page | `progress {loaded, total}` | Bytes of Pyodide downloaded so far, for the loading bar. |
| worker → page | `gui {lib, tree}` | A frame for that library's view; `tree: null` means close everything. |
| worker → page | `trace {files}` | New values for the node map after a window callback ran. |
| worker → page | `input` | The program is waiting in `input()`: open the console's typing line (the answer goes back through the service worker). |

## Analysis (`analyze`)

`analyze(src, mods_json)` parses with `ast` and returns JSON `{nodes, wires, hints}`; it never runs the code, so the map
updates while you type (debounced, and re-analysis is skipped when neither the code nor the file list changed).

- **Nodes**: one per statement (docstrings skipped), numbered in pre-order, with `kids` for compound statements. `elif` is a
  sibling of its `if`; `else:`/`finally:` are small pseudo-nodes. `show` lists the names a node defines (its value box).
- **Wires**: for each name a statement uses, `sources()` finds the definition that reaches it: the nearest earlier one in the
  same scope chain (class scopes are skipped from inside methods, `global` is honoured, `self.x` is a name shared across a
  class's methods), plus, for each enclosing loop, one loop-carried definition (the last one later in that loop, which may be the statement itself, as in
  `total = add(total, i)`). A call to a function/class/method becomes a `call` wire (`two: true`
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

**`input()`** really waits. `ask()` calls the worker's `wantInput()` (flush the output, so the prompt shows; post `input` to the page,
which opens the typing line at the end of the console), then makes a synchronous request to the service worker's mailbox
(`__mailbox?lib=__input&wait=1`). `sw.js` holds that request open until the page posts the line that was typed, or for 20 s, after
which the worker simply asks again. A synchronous request in a worker blocks only the worker, so this needs no special HTTP headers
(SharedArrayBuffer would). Without a service worker it falls back to the old way: `input()` raises `NeedInput`, the page collects the
answer and calls `run` again with every answer so far (output already shown is skipped, `random` is seeded identically). So that a
bare `except:` around `input()` can't swallow `NeedInput` and loop, the tracer raises it again on every line after the first.

**The `>>>` prompt** (`shell()`): at the end of every run the sandbox pieces are kept in `_SHELL` (enter / leave, the traces, the temp
folder, the module the program ran as). A line typed at the prompt is compiled with `codeop.compile_command(..., "single")` (an
expression's value is printed; `None` back means "incomplete", and the page shows `... `) and executed in that module's globals inside
the same sandbox, still traced, so calls into the program update the map. With no run yet, an empty program is run first to set the
sandbox up. The next run (or a new project, `gui_stop`) deletes the folder and the modules (`shell_cleanup`).

**Modes**: `run(..., mode)` with a mode id a library registered (`doctest`, `unittest`) imports the file as a module and hands
it to that library's function instead of running it as `__main__`.

## The node map

`NodeMap.build` lays nodes out in one vertical column in source order; containers nest. A wire from a box back to itself (a loop-carried accumulator) is just a short loop round that box and takes no lane. Wires never cross a box: each leaves
the source's right edge, runs down a gutter *lane*, crosses the gap above its target (where its label sits) and enters the
target's left edge. Wires that belong together (all the wires into one box; on the right side also all the wires out of one box, when there are more of
those) form a *bundle*: they share a lane and run `TIGHT` pixels apart, ordered so none crosses another's row. Bundles are then assigned
lanes by interval colouring, so bundles that don't overlap vertically share one. All colours are CSS variables
on the `<svg>` (two palettes: dark/light), so the same markup serves the screen and the PNG export, which rasterises the SVG
through a canvas. Collapsing a container hides its descendants and re-attaches their wires to it. Hover/cursor highlighting
and search are done in `app.js` by toggling CSS classes on the existing SVG, without a redraw.

## GUI libraries (tkinter, turtle)

A library that opens windows registers *hooks* (`gui_hooks` in its `lib.py`, [details](ADDING_A_LIBRARY.md#4-gui-libraries))
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

### Real windows

`PopOut` (`libs.js`) opens a real window for the node map, the console or a program's window, and `$` also looks in those. It takes Document
Picture-in-Picture if the browser has it and no one holds it (asking for a second would close the first), otherwise a popup, and returns
null without a recent click rather than set off the browser's popup warning. So the view can't assume it gets a window:

1. `drawWin` first lays the window out in `#tkhost`, unseen and as wide as its content. That is the size the program asks for, so no one has
   to compute it.
2. `popOpen` opens a window of that size and moves the elements there (`.popped`: they fill it). New elements are made in that document (`doc`).
   If no window came, the program still runs and a prompt in `#tkhost` opens it on a click.
3. Closing the window sends `{t: 'close'}`, unless we closed it (`w.quiet`: `withdraw()`; `w.gone`: the window is finished in Python). A
   `WM_DELETE_WINDOW` handler may keep the window, so after a moment it comes back as a prompt.

**Sizes.** One `ResizeObserver` per window (`watch`) sees the body and every widget, redraws canvases, and sends `{t: 'resize', sizes}`, so
`dispatch` can update `winfo_width()` and fire `<Configure>`. The observer, and `requestAnimationFrame` for mouse moves, must come from the window
that holds the elements: the page's own stop when its tab is hidden or covered, which is when a floating window is in use. `watch` makes a new
observer after each move.

**Shrinking.** A `Canvas` asks for its size with `min-width`/`min-height`, as it has to for `fill`'s stretch to work. In a real window, what
fills or expands drops that minimum (`packSlave`: `.gw`, `.gh`, `.gs`), so it follows the window both ways. Anything else keeps its size and `.tkbody`
scrolls. `turtle` packs its canvas with `fill` and `expand`, and on `<Configure>` moves what is drawn by half the change (`_recentre`) to keep
the origin in the middle, so clicks and `window_width()` need nothing special.

The tkinter view (`libs/tkinter/lib.js`) is the biggest piece of front-end code: `pack` is rendered as nested flex boxes (the
first slave takes a band of the cavity, the rest share what is left), `grid` as CSS grid, `place` as absolutely positioned
boxes. Widget DOM elements are reused between updates, and `Entry`/`Text` values are only written when Python changed them
(a revision counter), so typing is never overwritten by a stale value. A `Canvas` is a wrapper `<div>` that layout sizes (its
`width`/`height` are only the *requested* size, so `pack(fill=BOTH, expand=True)` can make it larger, as in Tk) with the `<canvas>`
bitmap inside resized to match through a `ResizeObserver`. Drawing and mouse coordinates are therefore 1:1; stretching the bitmap
with CSS instead made clicks land away from the pointer.

## Events while a program is running

A busy Python worker cannot receive messages: its event loop is stuck inside the program. So a key press during `while True:
turtle.update(); sleep(0.02)` (the usual animation or game loop) used to wait until the loop ended, which was never. The usual cure,
`SharedArrayBuffer`, needs server headers GitHub Pages cannot send. This is the substitute:

1. While a run is executing (`pyBusy` in `app.js`), the view's `send()` does not message the worker. It posts `{lib, ev}` to the
   **service worker** (`sw.js`), which just keeps a list per library.
2. The program reads that list with a **synchronous request**: `runner.mailbox(lib)` does a sync `XMLHttpRequest` to
   `<folder>/__mailbox?lib=<name>`, which the service worker answers (and empties). Synchronous requests are allowed in workers.
3. A library calls it from its own update point. tkinter's `update()` does `_poll()`, which dispatches the events exactly as if the
   worker had received them, so callbacks (turtle's `onkey` ...) run in the middle of the user's loop, traced like any other code. The
   poll rate adapts to how slow the request was (about 0.6 ms in Chrome, 3 to 20 ms in Firefox), capped at roughly a tenth of the time.
4. When the run ends, `gui_pump()` hands over anything still waiting; from then on events go straight to the worker as before.

The worker is created *after* the service worker controls the page, because a worker inherits its creator's control (a Blob worker
included); that is why start-up waits for it on the first visit. If anything is missing (no service worker, a hard reload, a mailbox
that doesn't answer) the first failed read switches polling off for that run and the program behaves exactly as before: events are
handled after it finishes.

Two related rules live in the same place. `update()` on a destroyed window raises `TclError` (and turtle turns that into
`Terminator`), so closing the window during a loop ends the program as in the real modules; and `update()` calls `_heartbeat()`,
which resets the traced-line counter, because an animation that keeps drawing is not the infinite loop that `LIMIT` is there to catch
(Stop still works). Libraries get `_mailbox()` and `_heartbeat()` in their namespace (see the library guide). The same mailbox carries
`input()`'s answers, with one difference: that request is held until the answer comes (see Running and tracing).

## Locked files

A file with a `# pynodemap lock <password>` line is a **locked file** ([LOCKED_FILES.md](LOCKED_FILES.md) is the user's view). `app.js` finds the
tag (`lockOf`), keeps a per-session set of files whose password was entered, and refuses to open any other locked file: in
`openFile` itself (so tabs, the explorer, a saved project and the step bar are all covered), in the console's traceback links, in
rename/delete/import, in autocomplete, in Export. Share deliberately includes them, with the tag, so an assignment travels.

The page passes the locked names with every `run`. `run()` then keeps those files off the disk: a small meta path finder (`Hidden`)
imports them from memory, compiled with a filename but no source (`get_source` returns `None`), so `open()` finds nothing and tracebacks
have no line to quote. They are left out of `info`, so they are never traced: no value boxes, steps or hit counts. `unittest`'s run mode
asks for their names (`_locked()`) and runs their tests too. The lock is a deterrent, not security (the text is in the browser and in
every share link), and the docs say so.

## Text files and the console

A project holds `.py` and `.txt` files (`isPy`, `okName` and `safeName` in `app.js` decide what a name may be: a `.txt` is `[\w-]+`, it
can't be imported so it needs no more). Only `.py` files are analysed, drawn, traced, locked (a lock line in a `.txt` is just text),
offered to autocomplete or counted in `modsOf()`. `run()` writes every file to the temp folder, so `open()` and a program's own
`doctest.testfile("test_klondike.txt")` find a text file next to the module, but it `continue`s before analysing a non-`.py`. When the
active file is a `.txt` it isn't executed: the page turns Run into the doctest mode (if that library is there), and the doctest
library runs `testfile` on `mod.__file__`.

`out()` reads a program's output (not the `err` / `dim` messages) for ANSI codes: `\x1b[...m` colours and bold become inline styles
(`setSgr`; 16 colours, no 256-colour or true colour) and `\x1b[2J` empties the console, so a game that clears the screen before it
redraws shows one board. Other codes are dropped. The style in force (`sgr`) carries over between pieces of output, and a re-run after
`input()` only receives the output that is new, so a clear in the part already shown is not repeated.

## Folders and the project's disk

A project is still a flat `{name: text}`, but names can hold folders (`pkg/util.py`), and a folder with nothing in it is an entry whose name
ends in `/` with empty text (`isDir`), so empty folders are saved and shared with no extra state. `okName` is what may be in a project at
all (share links are checked against it, and names go into the page's HTML); `askName` is stricter for what you type. The explorer
builds its tree from the names on each `chrome()`.

`run()` writes every file into its temp folder, the working directory, and adds the folder of the file being run to `sys.path`, as
Python does. `pkg/util.py` is the module `pkg.util`; the import guard allows the top-level name (`mods`) and removes all of them between
runs (`loaded`). A locked module in a folder is served from memory under its dotted name.

`disk_snapshot()` reads the folder before the program starts and `disk_changes()` compares it when it ends, so what a program writes,
changes or deletes comes back as `disk` in the result, and `applyDisk()` puts it in the project (never over a protected file).
The snapshot stays in `_SHELL` and is updated each time, so a line at the `>>>` prompt reports only what that line did, and an edit in the
page is never overwritten by an unchanged file on disk. A run stopped by the re-run fallback for `input()` reports nothing: it starts over.

The import guard looks at who is importing. `__import__('socket')` from a student's code has no `globals` argument, so it uses the calling
frame; Python's own code importing things the same way is left alone (`open(..., encoding="utf8")` makes the `encodings` package import
its codec like that, and blocking it made that an `unknown encoding` error).

## Coverage

`run()` always returns `cover` (`cover_of()` in `runner.py`): for each traced file that ran, which of its statements never did, and the
text of the report. `statements(src)` lists the statements the way Coverage.py counts them, from the `ast`: the first line of every
statement and `except` clause, minus docstrings, `global` / `nonlocal`, and anything marked `# pragma: no cover` (on a compound
statement that includes its body). Each is a `[first, last]` span: a statement counts as run when any traced line from first to last
(hits are the same line events the node map uses) is in `hits`, so a multi-line statement doesn't depend on which of its lines fired
first and a compound statement is judged by its header alone. `cover_report()` formats the table (Coverage.py's rounding: only a
file that is really complete shows 100%, only one that never ran shows 0%; consecutive missed statements become a range).

The page only asks for it: the **Coverage** button calls `run('run', true)`, `finish()` prints `cover.report` and keeps
`S.cover = {file: [missed lines]}`, and `showMarks()` shades those lines of the active file (`cm-miss`). Any edit, rename, delete or
new run drops `S.cover`. It is line coverage only. Files that never ran are left out of the report, as with Coverage.py without
`--source`, and locked files are untraced so they never appear.

Two things in `run()` make a finished test file behave as it would under plain Python. `input()` reads `sys.stdin` when the program has
replaced it (the real `input()` does), and `leave()` restores `sys.stdin` and every attribute of `builtins` that the program changed,
so a test that sets `builtins.input = ...` can't break the next run.

## Limits at a glance

| Limit | Where | Why |
| --- | --- | --- |
| 1.5 million traced lines | `LIMIT` in `runner.py` | Stops what is probably an infinite loop (the message says so). |
| 30,000 recorded steps / 120,000 value facts | `MAXSTEPS`, `MAXFACTS` | Bounds the memory of the step timeline; the run itself continues, only the replay is cut (`trunc`). |
| Newest 200,000 characters on the console | `MAXOUT` / `KEEPOUT` in `app.js` | Printing is never an error. Nearing the limit, `trimOut()` drops the oldest pieces (down to `KEEPOUT`) and leaves a note at the top, so a runaway `print` loop can't make the page slow or run out of memory (the worker already sends output in batches); the executed-line cap is what ends such a loop. A clear screen (`\x1b[2J`) empties the console like in a terminal. |
| 50 files, 500,000 characters each | `loadShared()` in `app.js` | Validates a share link before it replaces your project. |
| Pyodide 0.29.x | `PYODIDE` in `app.js` | Newer versions need module workers (see Start-up). |

## Persistence and sharing

`localStorage`: `python_nodemap.v1` (files, open tabs, active file) and `python_nodemap.prefs` (theme, font size, zoom, wire
filters). A share link is `#p=` plus the project as JSON, deflated (`CompressionStream`, falling back to uncompressed) and
base64url-encoded; it lives in the URL fragment, so it is never sent to a server. Opening one, like any import, shows the import
dialog (`askImport`): what comes in and what happens to each file, then **Replace** (`replaceProject`) or **Add** (`mergeFiles`, which
never overwrites a locked, hidden or read-only file). A link opened on a first visit can be accepted before the Python worker exists
(start-up waits for the service worker), which is why `replaceProject` must not assume `W.w` is there.

## The rest of the page

- **Find / replace** (`openFind` and friends in `app.js`): matches are character offsets into the file (case ignored), highlighted
  with one CodeMirror overlay; Replace All is a single `cm.operation`, so one Undo takes it back.
- **The console's typing line** (`#line`, an `<input>` inside the `<pre>`) is always its last child, so it sits right after a prompt;
  `put()` inserts output before it and `trimOut()` never removes it. `job.waiting` says what Enter does: answer a held `input()`
  (`'block'`), re-run with one more answer (`'replay'`), or, with no job, send the line to `shell()`.
- **Popping the map out** (`popMap`): the `#mapp` panel itself moves into a Document Picture-in-Picture window (or a popup where the
  browser has none), with the page's stylesheets cloned. Its handlers move with it; `$` looks in that window too, and `syncPip` copies
  the theme. Closing it (`pagehide`) moves the panel back.
- **pynodesettings.py** (`cfg()`, re-parsed when the file changes; [SETTINGS.md](SETTINGS.md)): hidden files count as locked
  (`isLocked`) and are filtered out of the explorer; read-only ones set CodeMirror's `readOnly`; `isProtected` covers both plus locked
  files for rename, delete and import. `teacher()` is true once the settings file itself is open to you (its password entered, or no
  lock): then `isHidden` is false (the files show with 👻) and Export skips nothing. It goes by the settings file's password rather
  than any locked file's, because a student can lock a file of their own. Grade (shown only while the settings file is open) is the
  unittest library's `grade` mode, told which file to test through `run(..., opts_json)` and `_option()`; it groups tests by TestCase
  class and weights them by the class's `weight`. A new file named `gradeuser.py` is filled from `graderTemplate()`.
- **The guides**: `tutorial/tutorial.html` and `tutorial/educators.html` are plain pages (with `guide.css` and `img/`), shown in a
  `<dialog>` frame by `openGuide()` with the app's theme in `?theme=`. The screenshots are taken from the tool itself; retake them after
  a visible change. The sample project (`STARTER`) carries `education.py`, locked with the password `teach`.

## Browser differences we hit

- `Element.scrollIntoView()` does nothing for SVG elements in Firefox, so the map scrolls itself (`reveal()` in `app.js`), and
  redraws restore the scroll position explicitly.
- Moving a focused element in the DOM drops its focus; `TkView.apply` restores focus and caret after re-layout.
- Synchronous `XMLHttpRequest` from a worker to the service worker costs about 0.6 ms in Chrome but 3 to 20 ms in Firefox, which is why
  the mailbox poll rate adapts instead of being fixed.
- A tree can arrive after the page already closed the windows (messages in flight); the worker sends `tree: null` after a
  reset and at the start of each run so the last message always wins.
- Module state lives for the whole session, not per run (a library's `lib.py` runs once). Anything a library keeps between
  runs, like turtle's `Screen`, must notice that its window is gone.

## Testing

`python tests/test_backend.py` covers the Python side. For UI changes, drive the page with a real browser (we used
`puppeteer-core` against both Chrome and Firefox): run programs and assert on the DOM, canvas pixels and console text.
Things that are easy to break: scrolling in both browsers, focus while typing in tkinter windows, pack/grid layout
geometry, stale windows after Stop/replace, and the first load over a slow connection.
