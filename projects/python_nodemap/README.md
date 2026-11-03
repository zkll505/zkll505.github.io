# Python Nodemap

A Python IDE that runs entirely in your browser, built for teaching. You write Python on the left; on the right a
**node map** shows your program as connected nodes: one box per statement, wires for the data flowing between them, and a
value box in every one showing the current values of the variables it defines. Run the program, then scrub through it
step by step.

No server, no install, no account: Python runs in the browser ([Pyodide](https://pyodide.org)) and projects are stored in
your browser's `localStorage`.

**Contents:** [Features](#features) · [Run it](#run-it) · [Using it](#using-it) · [Reading the node map](#reading-the-node-map) ·
[Libraries](#libraries) · [Limits](#limits) · [Troubleshooting](#troubleshooting) · [Feedback](#feedback) · [Privacy](#privacy) ·
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
- **Safe to run**: a **Stop** button (the program runs in a Web Worker), an infinite-loop cutoff, a console that keeps only its newest
  output, and an import allow-list.
- **An interactive console**: `input()` is answered right where it asks, at the end of the console, and the program really waits
  for it. After a run the console is a Python prompt (`>>>`) in what the program left behind, like IDLE after F5: type
  `list(Rank)` after running a file that defines `Rank`. A program that gives itself a stream to read
  (`sys.stdin = io.StringIO("D\nQ\n")`) gets its input from that, which is how a test can play a whole game. ANSI colours and
  "clear screen" in a program's output work too, so a text game can redraw its board.
- **Projects**: export a zip of every file plus a PNG of each `.py` map, import a zip, or share the whole project as a link. A project
  can also hold plain-text `.txt` files, such as a doctest file (`test_klondike.txt`).
- **Locked files**: a `# pynodemap lock <password>` line makes a file unopenable without the password, so an assignment can carry
  tests the student can run (the **Tests** button, or `import`) but not read. See [docs/LOCKED_FILES.md](docs/LOCKED_FILES.md).
- **Project settings for teachers**: a `pynodesettings.py` file of comment lines can turn off copy and paste, log every paste, hide
  files completely, or make files read only. While it is open (with its password), a **Grade** button scores the work against a test
  file such as `gradeuser.py`, which starts as a template of weighted test groups, and Export takes every file. See
  [docs/SETTINGS.md](docs/SETTINGS.md).
- **Tutorials**: the **Tutorial** button explains the tool and the node map with screenshots; the **Educator guide** (shown while
  `pynodesettings.py` is open) covers assignments, locks, settings and grading. A new visitor's sample project also has a locked
  `education.py` with notes for teachers: its password is `teach`.
- **Find and replace** with a match count, and the node map can be **popped out** into its own window (picture-in-picture where the
  browser has it, so it floats above the editor or another app).
- **Libraries** (each one is a plug-in, see below): `random`, `math`, `time`, `enum`, `pathlib`, `typing`, `sys`, `io`, `builtins`,
  `contextlib`, `collections`, `copy`, `re`, `itertools`, `functools`, `string`, `doctest`, `unittest`, `tkinter` (GUI windows) and `turtle`.

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
4. Click a box to jump to its line; click the chevron on a container (function, loop, `if` ...) to fold it, or the one on a value
   box to collapse its list of values.

Other things worth knowing:

- **Files**: **+** in the explorer makes a file: `name.py` (names must be importable: letters, digits, `_`) or a plain-text
  `name.txt`. Files import each other with a plain `import helpers`. Hover a file to rename (✎) or delete (✕) it.
- **Text files** (`.txt`) are kept with the project and written next to the `.py` files on every run, so `open("data.txt")` and
  `doctest.testfile("test_klondike.txt")` find them. They get no node map or hints; **Run** (or **Doctest**) on one runs the `>>>`
  examples in it.
- **Share** copies a link that contains the whole project (it lives in the part after `#`, so no server ever sees it). **Import**
  takes `.py` and `.txt` files or a `.zip` of them (anything else in it is skipped). Both open a dialog listing what comes in and what
  happens to each file, with the choice of **Replace my project** or **Add to my project** (files with the same name are replaced;
  locked, hidden and read-only ones are kept). **Export** downloads a zip of every file plus a PNG of each `.py` file's node map.
- **Doctest** and **Tests** buttons (next to Run) import the active file and run its `>>>` examples or its `unittest` tests (on a
  `.txt` file, Doctest runs the examples in the file itself).
- **Coverage** (next to them) runs the active file like Run, then prints a table like `coverage report -m` (statements, how many
  never ran, the percentage, the line numbers) and shades the lines that never ran in the editor, so you can see which tests are
  missing. It counts statements the way Coverage.py does (line coverage, not branch coverage; docstrings are not counted and
  `# pragma: no cover` leaves a line, or a whole `def` / `if`, out). To measure a test file, run the `.py` file whose `__main__` block
  runs it, or open the `.txt` and press Coverage. Editing a file clears the shading.
- **Stop** ends a run immediately by restarting Python in the background (a couple of seconds; the files are cached).
- **The console**: when a program calls `input()`, type the answer right after its prompt and press Enter. Once a run ends, the
  console shows `>>>`: type Python there and it runs in the program's globals (an expression's value is printed, a block such as a
  `for` loop ends with an empty line, ↑ / ↓ bring back earlier lines). **Stop** ends a line that runs forever.
- **⧉** at the top of the node map pops it out into its own window; ⤓ there, or closing that window, puts it back.
- **Insert** switches to overwrite mode: the cursor becomes a block and the status bar says OVR.
- The status bar shows the number of hints (hover for the list), the cursor position and which libraries are available.

### Keyboard shortcuts

| Keys | Does |
| --- | --- |
| Ctrl+Enter, F5 | Run the active file |
| Ctrl+Space | Autocomplete (it also pops up as you type) |
| Ctrl+F · Ctrl+H | Find (with a match count) · find and replace |
| Enter / ↓ · Shift+Enter / ↑ (in the find box), F3 / Shift+F3 | Next · previous match |
| Enter · Ctrl+Enter (in the replace box) | Replace this match · replace all |
| Insert | Overwrite mode on / off |
| ↑ / ↓ at the `>>>` prompt | Earlier / later lines typed there |
| Ctrl+/ | Comment or uncomment the selected lines |
| Tab · Shift+Tab | Indent · outdent |
| Ctrl+mouse wheel over the map | Zoom the map |
| Enter in "Find variable…" | Jump to the next matching node |

## Reading the node map

Every statement is a **box**, in source order; a box inside a box is part of its body. The dark **value box** inside a box lists the
variables that statement defines and their values: **every** one is shown (a function with six parameters shows all six and its
`return`), and a value box with three or more rows has a **▾** that collapses it to a single line. **Wires** go from where a value
comes from to where it is used: solid for data, dashed orange for calls (with **↔** when the function returns a value), dotted
with **↻** for values carried round a loop. After a run each box shows how often it ran (`×5`) and a box that never ran is dimmed.

The full explanation of every part, with the function and class view, is in **[docs/NODE_MAP.md](docs/NODE_MAP.md)**.

## Libraries

Only these can be imported (plus the project's own files); anything else raises a clear `ImportError`.

| Library                          | What you get                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `random`, `math`, `time`, `enum`, `pathlib`, `typing`, `sys`, `io`, `builtins`, `contextlib`, `collections`, `copy`, `re`, `itertools`, `functools`, `string` | The standard modules (autocomplete included). `pathlib` and `open()` work on a temporary folder that is deleted when the run ends.                                                                                                                                                                                               |
| `doctest`                        | The module, plus a **Doctest** button that runs the active file's `>>>` examples (a `.txt` file's, if that is the active file).                                                                                                                                                           |
| `unittest`                       | The module, plus a **Tests** button; the report is shown in the console in normal colour.                                                                                                                                                   |
| `tkinter`                        | A look-alike of real tkinter drawn as floating windows: the common widgets, `pack`/`grid`/`place`, variables, `bind`, `after`, `Canvas`, menus, `messagebox`, `ttk` basics. See its limits in [`libs/tkinter/lib.py`](libs/tkinter/lib.py). |
| `turtle`                         | The everyday turtle API on top of that canvas: movement, pen, colours, fill, shapes, stamps, `write`, key/click/timer events and the module-level functions.                                                                                |

Each library, what it supports and what it doesn't: [libs/README.md](libs/README.md).

**Adding a library is meant to be easy**: it is one folder with a small manifest and, if needed, a Python file. See
[docs/ADDING_A_LIBRARY.md](docs/ADDING_A_LIBRARY.md). Many more standard modules (`string`, `collections`, `itertools`,
`json`, `datetime`, `statistics` ...) need only three lines each, and make good first contributions.

## Limits

- `input()` waits through the service worker (`sw.js`), which needs https or `localhost`. Where there is none (a Firefox private
  window) the program is re-run with the answers collected so far instead: output isn't repeated and `random` is seeded the same,
  but anything else that varies between runs (the clock, `id()`) may differ, and the `>>>` prompt can't use `input()`. `input()` is
  not available inside GUI callbacks either way (use an `Entry` widget).
- A GUI window stays open after the script ends, like in IDLE or Thonny; it closes with its ✕ or the next **Run**. Code after
  `mainloop()` / `turtle.done()` never runs.
- Dialogs (`messagebox.askyesno`, `simpledialog.askstring`) can't wait for a click, so they answer immediately and say so.
- **Keys and clicks reach a running program** through a service worker (`sw.js`), so a loop that keeps calling `update()`, like an
  animation or a game, can be steered from the keyboard. Where the browser has no service worker (Firefox private windows, plain
  `http` that isn't `localhost`) the program only sees them once it finishes. A program that keeps updating its window is also not
  counted towards the infinite-loop cutoff, and closing the window mid-run ends the program (`TclError`, or `turtle.Terminator`).
- Programs run in the browser's single-threaded Python: no threads, network or third-party packages, and files only in a temporary
  folder that is deleted when the run ends.
- Safety caps: a run stops after 1.5 million executed lines (assumed to be an infinite loop). The console keeps the newest 200,000
  characters and drops the oldest when it nears that (a note at the top says so), so a program can print as much as it likes;
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
| Keys or clicks do nothing in a running animation | They travel through the service worker (`sw.js`), which needs https or `localhost` and isn't available in Firefox private windows. The loop must also call `update()` (`turtle.update()`, `screen.update()`, `root.update()`) so the program can see them. Ctrl+F5 skips the service worker for that visit; reload normally. |

## Feedback

The **Feedback** link in the toolbar opens [the feedback form](https://forms.gle/yK2p1S2hzGKyzfm78) in a new tab. Bug reports and
ideas are just as welcome as issues on the repository.

## Privacy

Nothing you write leaves your browser. The page downloads Pyodide, CodeMirror and JSZip from public CDNs (so those hosts see an
ordinary page load), your files are kept in `localStorage`, and a share link carries the project in the URL fragment, which
browsers never send to a server. The Feedback link only opens a Google Form in a new tab; nothing is sent unless you submit it.

## How it works (short version)

`index.html` loads the page; `app.js` is the IDE; `worker.js` starts Pyodide in a Web Worker and loads `runner.py` (the
backend: parses your code with `ast`, runs it under `sys.settrace`) and every library. `nodemap.js` turns the analysis into
SVG. The full tour is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
index.html  style.css
app.js          the IDE: files, editor, console, run/stop, stepping, import/export/share
nodemap.js      layout + SVG drawing of the node map (also used for the PNG export)
complete.js     autocomplete          worker.js   Pyodide in a Web Worker
sw.js           service worker: a mailbox that delivers key and mouse events, and input() answers, to a running program
libs.js         the library registry  runner.py   analysis + traced execution (Python)
libs/<name>/    one folder per library: lib.js (manifest) and lib.py (optional)
tests/          python tests/test_backend.py
docs/           NODE_MAP.md (what each part of the map means), LOCKED_FILES.md, SETTINGS.md, ARCHITECTURE.md, ADDING_A_LIBRARY.md, examples/clicker
tutorial/       tutorial.html and educators.html (the in-app guides), their screenshots (img/) and guide.css
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
| change the safety caps | `LIMIT`, `MAXSTEPS`, `MAXFACTS` at the top of `runner.py`; `MAXOUT` / `KEEPOUT` (the console) in `app.js` |
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
