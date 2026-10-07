# Python Nodemap

A Python IDE that runs entirely in your browser, built for teaching. You write Python on the left; on the right a
**node map** shows your program as connected nodes: one card per statement, wires for the data flowing between them, and a
box on every node showing the current values of the variables it defines. Run the program, then scrub through it
step by step.

No server, no install, no account: Python runs in the browser ([Pyodide](https://pyodide.org)) and projects are stored in
your browser's `localStorage`.

**Contents:** [Features](#features) · [Run it](#run-it) · [Using it](#using-it) · [Reading the node map](#reading-the-node-map) ·
[Libraries](#libraries) · [Limits](#limits) · [Troubleshooting](#troubleshooting) · [Privacy](#privacy) ·
[How it works](#how-it-works-short-version) · [Tests](#tests) · [Contributing](#contributing) · [License](#license)

## Features

- **Editor**: VS Code-style tabs and explorer, multiple files that can import each other, syntax highlighting,
  autocomplete, find/replace, light and dark themes, resizable panels.
- **Node map**: statements in source order, nested for functions/classes/loops/`if`/`try`; wires for data flow,
  calls (two-way when a function returns a value) and loop-carried values; collapsible containers; zoom; find a
  variable; wire filters; PNG export of each file's map.
- **Values and stepping**: every node shows its variables and how many times it ran; a slider replays the run step by step
  (up to 30,000 steps) with the current line highlighted in the editor and on the map.
- **Beginner hints**: unused variables, use before assignment, a missing `return`, mutable default arguments, shadowed
  built-ins, unreachable code and imports that aren't available, as squiggles in the editor.
- **Errors**: the failing line and message are marked in the editor and on the map; tracebacks in the console are
  clickable.
- **Safe to run**: a **Stop** button (the program runs in a Web Worker), an infinite-loop cutoff, an output cap, and an import
  allow-list.
- **`input()`** works (the page asks for the answer in the console).
- **Projects**: export a zip of every `.py` plus a PNG of each map, import a zip, or share the whole project as a link.
- **Libraries** (each one is a plug-in, see below): `random`, `math`, `time`, `enum`, `doctest`, `unittest`,
  `tkinter` (GUI windows) and `turtle`.

## Run it

Use the hosted copy, or run your own:

```bash
git clone <this repository>
cd <repository>/projects/python_nodemap     # the folder containing index.html
python -m http.server 8000
# open http://localhost:8000/
```

Any static file server works (the app is plain HTML, CSS and JavaScript: **no build step, no npm**). It has to be _served_:
opening `index.html` straight from disk is blocked by the browser, because the page loads `runner.py` and each library's
`lib.py` with `fetch`. It needs internet access for the CDN-hosted dependencies (Pyodide about 5 MB on the first visit, then
cached; CodeMirror 5; JSZip).

**Browsers:** current Chrome and Firefox are tested. Anything recent with Web Workers and ES2022 should work (Edge shares
Chrome's engine); Safari has not been tried.

To publish: copy the folder to any static host (GitHub Pages works as is). Browsers cache static files for a few minutes,
so right after deploying a hard refresh (Ctrl+F5) shows the new version.

## Using it

1. Write code in the editor. The node map updates a moment after you stop typing.
2. Press **▶ Run** (or Ctrl+Enter). Output goes to the console; values and run counts appear on the map.
3. Use the step bar above the map to replay the run: ⏮ start, |◀ back, ▶ play/pause, ▶| forward, ⏭ end, or drag the slider.
4. Click a card to jump to its line; click the chevron on a container (function, loop, `if` ...) to fold it.

Other things worth knowing:

- **Files**: **+** in the explorer makes a file (names must be importable: letters, digits, `_`). Files import each other with
  a plain `import helpers`. Hover a file to rename (✎) or delete (✕) it.
- **Share** copies a link that contains the whole project (it lives in the part after `#`, so no server ever sees it). Opening
  one asks first, then **replaces** everything in the explorer. **Import** takes `.py` files (added to the project) or a `.zip`
  (replaces the project, after asking). **Export** downloads a zip of every `.py` plus a PNG of each file's node map.
- **Doctest** and **Tests** buttons (next to Run) import the active file and run its `>>>` examples or its `unittest` tests.
- **Stop** ends a run immediately by restarting Python in the background (a couple of seconds; the files are cached).
- `input()` shows an input box in the console. See [Limits](#limits) for how this works and what it means for your program.
- The status bar shows the number of hints (hover for the list), the cursor position and which libraries are available.

### Keyboard shortcuts

| Keys | Does |
| --- | --- |
| Ctrl+Enter, F5 | Run the active file |
| Ctrl+Space | Autocomplete (it also pops up as you type) |
| Ctrl+F · F3 / Shift+F3 · Ctrl+H | Find · next / previous match · replace |
| Ctrl+/ | Comment or uncomment the selected lines |
| Tab · Shift+Tab | Indent · outdent |
| Ctrl+mouse wheel over the map | Zoom the map |
| Enter in "Find variable…" | Jump to the next matching node |

## Reading the node map

- **Cards** are statements, in source order. The word in the corner says what it is (FUNCTION, CLASS, LOOP, IF / ELIF / ELSE,
  TRY / CATCH, RETURN, IMPORT, SET, RUN, WITH), and the colour follows the kind. Containers hold the cards of their body.
  Top right: the source line (`L12`) and, after a run, how many times it executed (`×5`). A card that never ran is dimmed.
- **Value box** under a card: the variables that statement defines and their value right after it ran (`–` before it ran). A
  function's box shows its parameters and its return value.
- **Wires** go from where a value comes from to where it is used, and never cross a card.
  - A solid wire is **data**: the label is the variable name, and the same variable always has the same colour.
  - A dashed orange wire is a **call**: it points at the function (or class `__init__`) being called, and has an extra arrow
    back (`↔`) when the function returns a value.
  - A dotted wire marked `↻` is a **loop-carried** value: used on one pass, produced on the previous one.
- Hover or put the cursor in a card to light up its wires; the **data / calls / loops / selected** buttons filter them. The
  search box highlights every card and wire that mentions a name.
- **Hints** (yellow or red squiggles and a dot in the gutter) come from the same analysis; hover them for the explanation.

The map is built by reading your code, not by watching it run, so it is approximate in places: if both branches of an `if`
assign a name, only the later one is wired to a later use. That is deliberate (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Libraries

Only these can be imported (plus the project's own files); anything else raises a clear `ImportError`.

| Library                          | What you get                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `random`, `math`, `time`, `enum` | The standard modules (autocomplete included).                                                                                                                                                                                               |
| `doctest`                        | The module, plus a **Doctest** button that runs the active file's `>>>` examples.                                                                                                                                                           |
| `unittest`                       | The module, plus a **Tests** button; the report is shown in the console in normal colour.                                                                                                                                                   |
| `tkinter`                        | A look-alike of real tkinter drawn as floating windows: the common widgets, `pack`/`grid`/`place`, variables, `bind`, `after`, `Canvas`, menus, `messagebox`, `ttk` basics. See its limits in [`libs/tkinter/lib.py`](libs/tkinter/lib.py). |
| `turtle`                         | The everyday turtle API on top of that canvas: movement, pen, colours, fill, shapes, stamps, `write`, key/click/timer events and the module-level functions.                                                                                |

Each library, what it supports and what it doesn't: [libs/README.md](libs/README.md).

**Adding a library is meant to be easy**: it is one folder with a small manifest and, if needed, a Python file. See
[docs/ADDING_A_LIBRARY.md](docs/ADDING_A_LIBRARY.md). Many more standard modules (`string`, `collections`, `itertools`,
`json`, `datetime`, `statistics` ...) need only three lines each, and make good first contributions.

## Limits

- `input()` re-runs the program with the answers collected so far (output isn't repeated; `random` is seeded the same each
  time). Python can't pause and wait inside a Web Worker without special server headers that GitHub Pages can't send, so this is
  how it works everywhere. Anything else that varies between runs (the clock, `id()`) may differ between those re-runs, and
  `input()` is not available inside GUI callbacks (use an `Entry` widget).
- A GUI window stays open after the script ends, like in IDLE or Thonny; it closes with its ✕ or the next **Run**. Code after
  `mainloop()` / `turtle.done()` never runs.
- Dialogs (`messagebox.askyesno`, `simpledialog.askstring`) can't wait for a click, so they answer immediately and say so.
- Programs run in the browser's single-threaded Python: no threads, files, network or third-party packages.
- Safety caps: a run stops after 1.5 million executed lines (assumed to be an infinite loop) or 400,000 characters of output;
  the step slider records the first 30,000 steps. A share link carries at most 50 files of under 500,000 characters each.

## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| "Could not load Python" | The page needs internet access to `cdn.jsdelivr.net` (Pyodide) and `cdnjs.cloudflare.com` (editor, zip). Check the connection, any ad blocker or school filter, then reload. |
| The page says it has to be served | You opened `index.html` from disk. Run `python -m http.server` in the folder and open `http://localhost:8000/`. |
| Old behaviour after a deploy | Browsers cache static files for a few minutes: hard refresh with Ctrl+F5. |
| Everything is gone | Projects live in this browser's `localStorage` (`python_nodemap.v1`). Clearing site data, a private window or another browser starts fresh; **Export** for a backup. |
| `ImportError: 'x' isn't available here` | Only the libraries listed above can be imported. The message lists what you can use. |
| Python restarts after **Stop** | That is how a running program is interrupted. It takes a couple of seconds. |
| A window won't go away | Close it with its ✕ or press **Run** (a new run closes the old windows). |

## Privacy

Nothing you write leaves your browser. The page downloads Pyodide, CodeMirror and JSZip from public CDNs (so those hosts see an
ordinary page load), your files are kept in `localStorage`, and a share link carries the project in the URL fragment, which
browsers never send to a server.

## How it works (short version)

`index.html` loads the page; `app.js` is the IDE; `worker.js` starts Pyodide in a Web Worker and loads `runner.py` (the
backend: parses your code with `ast`, runs it under `sys.settrace`) and every library. `nodemap.js` turns the analysis into
SVG. The full tour is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
index.html  style.css
app.js          the IDE: files, editor, console, run/stop, stepping, import/export/share
nodemap.js      layout + SVG drawing of the node map (also used for the PNG export)
complete.js     autocomplete          worker.js   Pyodide in a Web Worker
libs.js         the library registry  runner.py   analysis + traced execution (Python)
libs/<name>/    one folder per library: lib.js (manifest) and lib.py (optional)
tests/          python tests/test_backend.py
docs/           ARCHITECTURE.md, ADDING_A_LIBRARY.md, examples/clicker (a complete tiny GUI library)
```

## Tests

```bash
python tests/test_backend.py      # prints "ok"; Python 3.10+, no dependencies
```

It loads `runner.py` and every library the same way the page does and exercises analysis, tracing, `input()` replay,
tkinter, turtle, unittest and enum. There is no automated browser suite in the repository; when you change the UI, open
the page in Chrome and Firefox and try the feature (docs/ARCHITECTURE.md lists what is easy to break). More in
[tests/README.md](tests/README.md).

## Contributing

Issues and pull requests are welcome. Good first contributions are **new libraries** (the contract is documented),
beginner hints in `analyze()` in `runner.py`, and missing tkinter/turtle features. Please keep it dependency-free: no
bundler, no framework, one `<script>` per file. Before opening a pull request run the tests above and try your change in a
browser. Comment the _why_ of anything non-obvious; the files are meant to be read.

Where to change what:

| To ... | Look at |
| --- | --- |
| add a beginner hint | `lint()` or the end of `analyze()` in `runner.py`; add a case to `hints()` in `tests/test_backend.py` |
| add or restyle a node kind | `KIND` in `runner.py`; `LABEL`, `COLOR_DARK`, `COLOR_LIGHT` in `nodemap.js` |
| change how the map is laid out or wired | `NodeMap.build` in `nodemap.js` (layout, routing) and `sources()` / `wire()` in `runner.py` (which wires exist) |
| add a module students can import | a folder in `libs/` ([guide](docs/ADDING_A_LIBRARY.md)) |
| change the safety caps | `LIMIT`, `MAXSTEPS`, `MAXFACTS`, `OUTLIM` at the top of `runner.py` |
| add a toolbar button or a shortcut | `index.html` and the matching handler (or `extraKeys`) in `app.js` |
| change the starter project | `STARTER` in `app.js` |
| change the Pyodide version | `PYODIDE` and `PYODIDE_SIZES` in `app.js` (see the comment there first) |
| change editor colours | CSS variables and the `.cm-s-vscode*` rules in `style.css`; the map has its own palettes in `nodemap.js` |

## License

[GNU GPL v3](../../LICENSE) (the `LICENSE` file at the root of this repository). Contributions are accepted under the
same license.

## Credits

[Pyodide](https://pyodide.org) (CPython in WebAssembly), [CodeMirror 5](https://codemirror.net/5/) (editor),
[JSZip](https://stuk.github.io/jszip/) (zip import/export).
