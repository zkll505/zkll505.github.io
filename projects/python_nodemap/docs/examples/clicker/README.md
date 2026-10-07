# Example library: `clicker`

The smallest complete GUI library: `import clicker; clicker.show(); clicker.mainloop()` opens a small window with one button that
counts its clicks. It exists to show every piece a library with its own window needs; the full walkthrough is in
[../../ADDING_A_LIBRARY.md](../../ADDING_A_LIBRARY.md#4-gui-libraries).

| File | Role |
| --- | --- |
| `lib.py` | The state and the hooks `runner.py` calls: `install()` makes `import clicker` work, `dispatch()` handles a click, `pump()` reports what changed, `gui_hooks` ties them together. Python decides what to show and sends it as JSON. |
| `lib.js` | The view: draws a frame (`apply(tree)`), sends events back (`send({...})`), and registers the manifest. |

## Try it

It is not part of the app by default. To see it work, add one line to `index.html` next to the other libraries, and reload:

```html
<script src="docs/examples/clicker/lib.js"></script>
```

then run:

```python
import clicker

clicker.show()
clicker.mainloop()
```

Click the button and the count goes up; close the window with its ✕. Remove the line again when you are done (or use the example as
the starting point for your own library: copy the folder to `libs/<yourname>/` and change the paths in `lib.js`).

## Tested

`example_library()` in [`tests/test_backend.py`](../../../tests/test_backend.py) loads this library, clicks, and checks the frames,
so the example in the guide cannot rot.
