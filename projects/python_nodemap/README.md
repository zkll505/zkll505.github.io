# Python Nodemap

A Python IDE that runs entirely in your browser, built for teaching. You write Python on the left; on the right a
**node map** shows your program as connected nodes: one card per statement, wires for the data flowing between them, and a
box on every node showing the current values of the variables it defines. Run the program, then scrub through it
step by step.

No server, no install, no account: Python runs in the browser ([Pyodide](https://pyodide.org)) and projects are stored in
your browser's `localStorage`.

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
cached; CodeMirror 5; JSZip). Tested in current Chrome and Firefox.

To publish: copy the folder to any static host (GitHub Pages works as is). Browsers cache static files for a few minutes,
so right after deploying a hard refresh (Ctrl+F5) shows the new version.

## Libraries

Only these can be imported (plus the project's own files); anything else raises a clear `ImportError`.

| Library                          | What you get                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `random`, `math`, `time`, `enum` | The standard modules (autocomplete included).                                                                                                                                                                                               |
| `doctest`                        | The module, plus a **Doctest** button that runs the active file's `>>>` examples.                                                                                                                                                           |
| `unittest`                       | The module, plus a **Tests** button; the report is shown in the console in normal colour.                                                                                                                                                   |
| `tkinter`                        | A look-alike of real tkinter drawn as floating windows: the common widgets, `pack`/`grid`/`place`, variables, `bind`, `after`, `Canvas`, menus, `messagebox`, `ttk` basics. See its limits in [`libs/tkinter/lib.py`](libs/tkinter/lib.py). |
| `turtle`                         | The everyday turtle API on top of that canvas: movement, pen, colours, fill, shapes, stamps, `write`, key/click/timer events and the module-level functions.                                                                                |

**Adding a library is meant to be easy**: it is one folder with a small manifest and, if needed, a Python file. See
[docs/ADDING_A_LIBRARY.md](docs/ADDING_A_LIBRARY.md).

Behaviours worth knowing about:

- `input()` re-runs the program with the answers collected so far (output isn't repeated; `random` is seeded the same each
  time). It is not available inside GUI callbacks.
- A GUI window stays open after the script ends, like in IDLE or Thonny; it closes with its ✕ or the next **Run**. Code after
  `mainloop()` / `turtle.done()` never runs.
- Dialogs (`messagebox.askyesno`, `simpledialog.askstring`) can't wait for a click, so they answer immediately and say so.
- Programs run in the browser's single-threaded Python: no threads, files, network or third-party packages.

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
docs/           ARCHITECTURE.md, ADDING_A_LIBRARY.md
```

## Tests

```bash
python tests/test_backend.py      # prints "ok"; Python 3.10+, no dependencies
```

It loads `runner.py` and every library the same way the page does and exercises analysis, tracing, `input()` replay,
tkinter, turtle, unittest and enum. There is no automated browser suite in the repository; when you change the UI, open
the page in Chrome and Firefox and try the feature (docs/ARCHITECTURE.md lists what is easy to break).

## Contributing

Issues and pull requests are welcome. Good first contributions are **new libraries** (the contract is documented),
beginner hints in `analyze()` in `runner.py`, and missing tkinter/turtle features. Please keep it dependency-free: no
bundler, no framework, one `<script>` per file. Before opening a pull request run the tests above and try your change in a
browser.

## License

[GNU GPL v3](../../LICENSE) (the `LICENSE` file at the root of this repository). Contributions are accepted under the
same license.

## Credits

[Pyodide](https://pyodide.org) (CPython in WebAssembly), [CodeMirror 5](https://codemirror.net/5/) (editor),
[JSZip](https://stuk.github.io/jszip/) (zip import/export).
