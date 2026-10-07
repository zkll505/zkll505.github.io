# Adding a library

Every importable library in Python Nodemap, including the built-in ones, is a plug-in. The app only lets student code
import what a library registered, and everything else a library may need (autocomplete, an extra run button, a GUI window)
hangs off the same small manifest. Nothing in `app.js`, `runner.py` or `worker.js` has to change.

A library is a folder `libs/<name>/` with up to three kinds of content:

| You want to... | You need |
| --- | --- |
| let students `import` a standard-library module (and get autocomplete) | `lib.js` only (3 lines) |
| provide your own module written in Python, or add a run button | `lib.js` + `lib.py` |
| open windows / draw something | `lib.js` + `lib.py` + a *view* in `lib.js` (or build on `tkinter`, like `turtle` does) |

Then add one `<script src="libs/<name>/lib.js">` line to `index.html`.

## 1. A standard-library module (the 3-line library)

Python already has the module (Pyodide ships the standard library); it only needs to be on the allow-list. `libs/stdlib/lib.js`
registers `random`, `math`, `time` and `enum` this way:

```js
PyLibs.add({
  name: 'string',                                   // what students type after `import`
  members: 'ascii_letters ascii_lowercase digits punctuation capwords Template',   // for autocomplete
});
```

Put it in its own `libs/string/lib.js` and add the `<script>` line, or append it to `libs/stdlib/lib.js` for tiny modules.
Check the module exists in Pyodide first: add the library, reload, and run `import string` in the page.

## 2. The manifest

`PyLibs.add({...})` takes one object. Only `name` is required.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | The import name; also what appears in the status bar. Must be unique. |
| `python` | string | Path (relative to `index.html`) of a Python file to run once at start-up. |
| `members` | space-separated string | Names suggested after `name.` and in `from name import ...`. |
| `submodules` | `{ sub: 'members' }` | The same for submodules students import from yours (e.g. `tkinter.messagebox`). |
| `methods` | space-separated string | Names suggested after `something.` when the editor doesn't know what `something` is (methods of your classes). |
| `modes` | `[{ id, label, title }]` | Extra run buttons. Clicking one runs the active file in mode `id`; your `lib.py` provides the function. |
| `view` | object | For libraries that draw windows: `{ apply(tree), setSend(fn) }` (see GUI libraries). |

Registration order is load order: list a library after the libraries it builds on in `index.html` (turtle comes after
tkinter). Student code can only import top-level names that are registered, but `import tkinter.messagebox` works because
`tkinter` is.

## 3. `lib.py`: what it can define

`lib.py` runs **once**, at start-up, in its own namespace (`__name__` is `<name>_lib`). Its frames are hidden from students'
tracebacks. It may define any of these module-level names; `runner.py` looks for them:

| Name | Purpose |
| --- | --- |
| `install()` | Called after the file runs. Register your module(s): `sys.modules["mylib"] = module`. |
| `run_modes` | `{mode_id: fn(module)}` for the manifest's `modes`. `fn` receives the student's file, already imported as a module, and prints its results. |
| `gui_hooks` | A dict of functions, if your library keeps a window open (see GUI libraries). |

Rules of thumb:

- **Your module lives for the whole session, not per run.** The student's program runs many times in one Python process. State
  you keep (a window, a cache, a default object) must be reset or re-validated when a new run starts (the `reset` hook for GUI
  libraries). The turtle library once reused a screen from the previous run because of exactly this.
- Don't print or do work at import time; students import your module in every run.
- You can import other registered libraries' modules (`import tkinter as tk`), because their `install()` already ran.
- No network, threads or files: it runs in the browser. Third-party packages (numpy, ...) are not supported yet; it would
  need a `packages` manifest field calling Pyodide's `loadPackage`.

### A library with its own module

```js
// libs/hello/lib.js
PyLibs.add({ name: 'hello', python: 'libs/hello/lib.py', members: 'greet' });
```
```python
# libs/hello/lib.py
import sys, types

def greet(name):
    print(f"Hello, {name}!")

def install():
    m = types.ModuleType("hello")
    m.greet = greet
    sys.modules["hello"] = m
```

Now `import hello; hello.greet("Ada")` works, `hello.` autocompletes `greet`, and `hello` shows up in the status bar. If you
see `ImportError: 'hello' isn't available here`, the manifest isn't registered (check the `<script>` line).

### A run mode (a button)

`libs/doctest/` is the whole recipe: the manifest declares the button, `lib.py` provides the function.

```js
modes: [{ id: 'doctest', label: '✔ Doctest', title: 'Import this file and run its doctests' }],
```
```python
import doctest

def _run(mod):
    r = doctest.testmod(mod, verbose=False)
    print(f"doctest: {r.attempted} run, {r.failed} failed")

run_modes = {"doctest": _run}
```

## 4. GUI libraries

Two options:

1. **Draw on something that exists.** `turtle` is ~560 lines of Python on top of tkinter's `Canvas` and has no view at all. If
   what you need can be drawn with a canvas, build on `import tkinter as tk`.
2. **Bring your own window**: a view in `lib.js` plus `gui_hooks` in `lib.py`. A complete, working, tiny example lives in
   [`docs/examples/clicker/`](examples/clicker/) (one button that counts clicks); `libs/tkinter/` is the full-size one.

### The division of labour

Python owns the state and decides what to show. The view only draws what it is given and reports what the user does.

```
 your lib.py  ──(JSON frame)──►  your view.apply(tree)
      ▲                                  │
      └──────(event, any JSON)───── send({...})
```

### `gui_hooks` (Python)

A dict of functions that lets the runner drive your window's life.

| Hook | Called when | What to do |
| --- | --- | --- |
| `reset()` | start of every run, **Stop**, project replaced | Close windows, drop timers and state. |
| `active()` | right after the script ended | Return `True` to keep the window open (the script's callbacks keep working, like IDLE/Thonny). |
| `finish()` | the script ended and `active()` was `False` | Clean up; show anything still pending. |
| `dispatch(ev)` | the view sent an event | Run the callbacks; `ev` is the dict the view passed to `send`. |
| `tick()` | a timer you requested is due | Run due timers. |
| `pump()` | after the script, each event, each tick | Return `{"alive": bool, "next": ms or None, "tree": {...}}`. Include `tree` **only if something changed**. `next` asks the page to call `tick()` after that many milliseconds (`None` = no timer). |
| `set_post(f)` | once, at load | Keep `f`. Calling `f(json_string)` pushes a frame immediately: how animations stream while the script is still running. |
| `exit` | (not a function) | An exception class derived from `BaseException`. Your `mainloop()` raises it: the script stops there but the window stays. |

Callbacks that run inside `dispatch`/`tick` are traced, so the node map's values update as the user clicks. Catch exceptions
from student callbacks and print them to `sys.stderr` (as tkinter does) so one bad handler doesn't kill the window.

### Events while the script is busy

A program stuck in `while True:` can't receive messages, so the page leaves its window events in a mailbox. `runner.py` puts two
functions in your `lib.py`'s namespace (their leading underscore keeps them out of the module you build):

| Function | Use |
| --- | --- |
| `_mailbox()` | The events (a list of dicts, whatever your view passed to `send`) that arrived since the last call. One synchronous request, so call it at most about 30 times a second; tkinter does it from `update()` and backs off when it is slow. |
| `_heartbeat()` | Call it when your library shows the program is alive (a frame was drawn). It restarts the infinite-loop count, so an animation isn't cut off after 1.5 million lines. |

Pass what `_mailbox()` returns to your own `dispatch`, as `tkinter`'s `_poll()` does. If your windows can be closed, make your update
call fail once the window is gone (tkinter raises `TclError`), or a loop would run on against a window that no longer exists.

### The view (JavaScript)

```js
const view = {
  setSend(fn) { /* keep fn; call fn({...}) for each user event: click, key, close ... */ },
  apply(tree) { /* draw the frame; tree === null means: remove everything (new run, Stop, project replaced) */ },
};
PyLibs.add({ name: 'clicker', python: 'libs/clicker/lib.py', members: 'show mainloop', view });
```

Things to get right (each was a real bug):

- Always send a final frame when the window closes (the example sends `open: false`), or the view never learns.
- Reuse DOM elements between frames: replacing them loses focus and the caret while the user types.
- A frame can arrive *after* the page told you to close. Make `apply(tree)` idempotent.
- Don't write a value into an input the user is editing unless Python changed it.

## 5. Testing your library

1. **Python** (no browser): `tests/test_backend.py` loads `runner.py` and the libraries the way the page does. Add a function
   that runs a small student program with `runner.run(json.dumps({"main.py": SRC}), "main.py")` and checks the output or the
   frames you posted. For a GUI library collect frames with `runner.GUI["yourlib"]["set_post"](list.append)` and send events
   with `runner.gui_event("yourlib", json.dumps({...}))`. See `example_library()` in the test file, which tests the clicker.
2. **Browser**: serve the folder, open it in Chrome *and* Firefox, and run a program that uses your library. Check that Run
   again, **Stop** and replacing the project (import a zip) leave no stale window.
3. Run `python tests/test_backend.py`; it must print `ok`.

## 6. Checklist for a pull request

- [ ] `libs/<name>/lib.js` registers the library; the `<script>` line is in `index.html`, after its dependencies.
- [ ] `members` lists what students will actually use, so autocomplete helps.
- [ ] Nothing at import time; state is reset between runs.
- [ ] A test in `tests/test_backend.py` (or the example/walkthrough it relates to).
- [ ] Tried in Chrome and Firefox; Run twice, Stop, and project replace behave.
- [ ] The README's library table and [libs/README.md](../libs/README.md) have a row for it, and anything it can't do is stated in the
      library's docstring.

## 7. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `ImportError: 'mylib' isn't available here` | The manifest isn't registered: the `<script>` line is missing from `index.html`, or `name` differs from what students import. |
| "library ... is registered twice" in the console | Two `PyLibs.add` calls use the same `name`. |
| Autocomplete knows nothing about it | `members` (names after `mylib.`) or `methods` (names after `something.`) is missing from the manifest. |
| The page says "Could not load Python" and quotes your exception | `lib.py` raised while loading, or its `python:` path is wrong (the message says which URL failed). It runs at start-up, so test it by reloading. |
| A run button is missing, or does nothing | The `modes` entry's `id` must equal the key in `run_modes`. |
| Works the first time, not the second | State kept in a module global survived the previous run. Reset it in the `reset` hook (or re-validate it, as turtle's `Screen()` does). |
| A window survives **Run**, **Stop** or an import | `reset()` doesn't close it, or the view's `apply(null)` doesn't remove it. |
| Typing in your window loses focus or text | The view re-created elements instead of reusing them, or wrote a value into an input the user is editing. |
| Nothing works when `index.html` is opened from disk | It has to be served (`python -m http.server`); see the README. |

A quick way to try a library without touching `index.html` permanently: add the `<script>` line, reload, and remove it again. The
example in [`docs/examples/clicker/`](examples/clicker/README.md) is set up that way.
