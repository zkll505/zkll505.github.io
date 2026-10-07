# Tests

```bash
python tests/test_backend.py      # prints "ok" when everything passes; Python 3.10+, no dependencies
```

Run it from anywhere; it finds the project from its own location. It exits with a traceback at the first failed assertion.

## What it covers

`test_backend.py` imports `runner.py` and registers the libraries listed in `index.html`, the same way the page does, then
calls `analyze()`, `run()` and the GUI hooks directly (the calls `worker.js` makes). One function per area:

| Function | Area |
| --- | --- |
| `analyze` | Nodes and wires: data, call, two-way, loop-carried, methods and `self.attributes`, `elif`, syntax errors |
| `execute` | Output, values per line, parameters / call counts / returns, `global`, the import guard, the infinite-loop cutoff, tracebacks, doctest mode |
| `hints` | The beginner hints, and that a clean program has none |
| `timeline` | The step timeline matches the hit counts; replaying the facts gives the final values |
| `input_and_errors` | `input()` re-runs with the same random seed, error locations, the output cap |
| `tkinter_app`, `tkinter_widgets`, `tkinter_classes`, `tkinter_star_import` | The tkinter library: widget tree, events, callbacks, subclassing, `from tkinter import *`, windows that stay open |
| `turtle_lib` | Turtle drawing as canvas items, colours and fill, key / click / timer events, animation frames, two runs in a row (no stale window) |
| `example_library` | `docs/examples/clicker`, the library the guide walks through |
| `pathlib_and_teleport` | `pathlib` on the run's temporary folder; `turtle.teleport` |
| `window_events` | Events reaching a running loop through the mailbox, a window closed mid-run ending the script, `update()` as a heartbeat for the loop cutoff |
| `enum_and_unittest` | `enum` and the **Tests** run mode |

## Adding a test

Write a function that runs a small student program and asserts on what comes back:

```python
def my_check():
    src = "x = 1\nprint(x + 1)\n"
    with contextlib.redirect_stdout(io.StringIO()) as out:
        result = json.loads(runner.run(json.dumps({"main.py": src}), "main.py"))
    assert out.getvalue() == "2\n" and result["error"] is None
```

then call it from the block at the bottom of the file. For a GUI library, collect the frames it posts in `POSTS` and send events
with `runner.gui_event("yourlib", json.dumps({...}))`; `tkinter_app()` and `example_library()` are good models. Clear `POSTS` and
call `runner.gui_stop()` when a test leaves a window open.

## What it does not cover (try these in a browser)

The page itself has no automated suite in this repository. After a change to the UI, serve the folder
(`python -m http.server 8000`) and try the feature in **Chrome and Firefox**. The things that have broken before:

- the node map following the editor cursor, and keeping its scroll position when it redraws (Firefox does not scroll SVG elements
  into view by itself, so `reveal()` in `app.js` does it);
- focus and caret while typing in a tkinter `Entry` (re-layout must not drop them);
- pack and grid layout geometry of tkinter windows;
- stale windows after **Stop**, a second **Run**, or importing a zip / opening a share link;
- the first load over a slow connection (the progress bar), and the message when the page is opened from disk;
- light and dark themes, in the editor and on the map;
- **Export** (the PNGs) and **Share** round-trips.

A browser suite is a welcome contribution: `puppeteer-core` against installed Chrome and Firefox worked well (load the page, run a
program, assert on the DOM, canvas pixels and console text).
