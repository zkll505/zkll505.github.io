# Locked files (hidden tests)

A **locked file** is a file the person using the tool cannot open without a password, so you can give out an assignment with tests
the student can run but not read.

## The tag

Put one comment line in the file:

```python
# pynodemap lock my_password
```

- It can be anywhere in the file; the top is the usual place. Spacing and case don't matter (`#pynodemap  LOCK ...` works).
- The **password is the rest of the line** (spaces inside it are kept, the ends are trimmed). Passwords are case-sensitive.
- A lock with **no password** (`# pynodemap lock` on its own) seals the file: nobody can open it in the tool. Edit it elsewhere.
- It has to be a `#` comment, as in any Python file. (A line starting with `//` is a syntax error in Python.)

## What the student sees

- The file is in the explorer with a **🔒**, with no rename or delete buttons. Clicking it asks for the password in a dialog (the
  typing is hidden). A wrong password is refused, Cancel and Escape close the dialog, and nothing of the file is shown.
- It still **runs**. Other files can `import` it by name, and the **☑ Tests** button runs the `unittest` tests in the active file
  *and* in every locked file of the project.
- Failures show the file name and line (`File "tests_hidden.py", line 9`) and the assertion message, but never the source line, and
  the file name is not a link. `open("tests_hidden.py")` finds no file: the source is only ever in memory.
- The node map, the value boxes, the step bar and autocomplete know nothing about it.
- It can't be replaced by importing a `.py` file of the same name, and nothing from inside it is offered by autocomplete (its module
  name can still be imported, like any file's).
- It is left out of **Export** (the zip), which a student would otherwise unzip and read.

## What you do

Typical assignment: `main.py` holds the student's starter code, `tests_hidden.py` the tests.

```python
# tests_hidden.py
# pynodemap lock s3cret
import unittest
from main import add


class Hidden(unittest.TestCase):
    def test_adds(self):
        self.assertEqual(add(2, 3), 5)
```

1. Create the file, type the tag line. The file stays open while you are editing it (🔓), and locks when the page is reloaded.
2. Press **Share**. The link **includes the locked file**, tag and all, so the student opens the link and finds the file locked.
   This is how you send an assignment out.
3. To edit the file later, click it and enter the password; it stays open for the rest of the session. A file you have unlocked is
   also included in **Export**, so unlock it first if you want a zip of the assignment to hand out.

Opening a share link or importing a zip replaces the whole project, and locks every locked file again.

## What it does *not* protect

This is a lock for the classroom, **not security**. The password sits in the file itself and the whole project lives in the student's
browser, so anyone who wants to look can: the share link you send contains the file's text (compressed, not encrypted), the browser's
developer tools show the project's saved files, and the values the student's own functions get while the hidden tests run show up
in the node map. It stops casual viewing and accidental edits, and keeps the tests out of the places students normally look. Anything
that must stay secret (an answer key for marked work) needs to be checked on a server, not in this page.

## How it works

The page notices the tag (`lockOf` in `app.js`), refuses to open such a file until its password has been entered, and tells
`runner.py` which files are locked on every run. The runner keeps those files out of the temp folder and serves them from memory
(`Hidden` in `run()`), compiles them without source, and doesn't trace them; the `unittest` library asks the runner for their names
(`_locked()`). See [ARCHITECTURE.md](ARCHITECTURE.md).
