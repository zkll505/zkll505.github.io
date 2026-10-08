# Libraries

Everything a student can `import` besides their own files is a plug-in in this folder. One folder per library:

```
libs/<name>/
  lib.js    the manifest: registers the library with PyLibs.add({...}); GUI libraries also hold their view here
  lib.py    optional: Python that runs once at start-up (defines a module, a run button, or a window's backend)
```

`index.html` has one `<script src="libs/<name>/lib.js">` line per library; their order is the load order, so a library
that builds on another (turtle on tkinter) comes after it. The core (`app.js`, `runner.py`, `worker.js`) knows none of them by
name. How to write one, field by field: [../docs/ADDING_A_LIBRARY.md](../docs/ADDING_A_LIBRARY.md).

## What is here

| Folder | Importable as | Has `lib.py` | What it adds |
| --- | --- | --- | --- |
| `stdlib/` | `random`, `math`, `time`, `enum`, `pathlib` | no | Nothing but permission to import them (they are already in Python) and autocomplete lists. `pathlib` works on the run's temporary working folder, which is deleted when the run ends. |
| `doctest/` | `doctest` | yes | The **Doctest** button: imports the active file and runs its `>>>` examples. |
| `unittest/` | `unittest` | yes | The **Tests** button (it also runs the tests in locked files), and the report goes to stdout instead of red stderr. |
| `tkinter/` | `tkinter`, `tkinter.ttk`, `.messagebox`, `.simpledialog`, `.font`, `.constants` | yes | A look-alike of tkinter (widgets, geometry managers, events, timers, canvas, menus) and the renderer that draws it as floating windows. The largest library by far. |
| `turtle/` | `turtle` | yes | The turtle module, drawn on tkinter's canvas (so it needs no renderer of its own). |

## tkinter: what works and what doesn't

Widgets are plain Python objects that remember their options; `lib.js` draws them. Nothing here is real Tk, so anything that
depends on exact pixel metrics is approximate (`winfo_width()` and font measurements are estimates).

- **Works:** `Tk`, `Toplevel`, `Frame`, `LabelFrame`, `Label`, `Message`, `Button`, `Entry`, `Text` (plain text), `Checkbutton`,
  `Radiobutton`, `Scale`, `Spinbox`, `Listbox`, `Canvas` (line, rectangle, oval, polygon, arc, text; tags; `tag_bind`;
  `find_*`), `Menu` (cascades, checks, radios, accelerators), `OptionMenu`, `ttk` `Combobox` / `Progressbar` / `Separator` and
  the ttk look-alikes of the classic widgets; `StringVar` / `IntVar` / `DoubleVar` / `BooleanVar` with traces; `pack`, `grid`
  (weights, spans, sticky), `place`; `bind`, `bind_all`, virtual events; `after`, `after_cancel`, `update`; `messagebox`,
  `simpledialog`, `font.Font`.
- **Events while the script runs:** key presses, clicks and the window's ✕ reach a program that is busy in a loop, as long as the loop
  calls `update()` (see the mailbox in [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)). Closing the window mid-run raises `TclError` at the
  next `update()`, as in Tk.
- **Different on purpose:** dialogs cannot wait for a click, so they answer at once (`askyesno` says yes, `askstring` says
  `None`) and print a note. A window stays open after the script ends; `mainloop()` ends the script.
- **Not supported:** images (`PhotoImage` raises a clear error), file dialogs, `Text` tags, real scrollbars (widgets scroll by
  themselves), ttk themes, `Notebook` and `Treeview`.

## turtle: what works and what doesn't

- **Works:** `forward`/`back`/`left`/`right`/`goto`/`teleport`/`setheading`/`home`, `circle`, `dot`, `stamp`, `write`, pen up/down, pen and
  fill colours (names, `#rrggbb`, RGB tuples with `colormode`), `begin_fill`/`end_fill`, shapes, `speed`, `tracer`/`update`,
  several turtles, `Screen()` (`bgcolor`, `setup`, `title`, `onkey`, `onscreenclick`, `ontimer`, `listen`, `exitonclick`,
  `textinput`), and all the module-level functions (`turtle.forward(...)`). `turtle.done()` ends the script and keeps the window.
- **Not supported:** `undo`, `ondrag`, custom shapes and images, `setworldcoordinates`, tilt.
- Drawings are redrawn in full on every frame, which is fine for thousands of segments; see the `ponytail:` note in
  `turtle/lib.py` if a huge drawing lags.

## Conventions for library code

- `lib.py` runs **once**, but a student's program runs many times in the same Python process: keep per-run state out of module
  globals, or reset it in the `reset` hook (the turtle library once reused a window from the previous run).
- Do no work at import time, and never print from `install()`.
- Add a test to `tests/test_backend.py`, and try the library in both Chrome and Firefox if it has a view.
