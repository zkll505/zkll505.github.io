# Project settings (pynodesettings.py)

A teacher can put a file called **`pynodesettings.py`** in a project to change how the tool behaves for whoever opens it. Each
setting is one comment line. Lock the file like any other (`# pynodemap lock <password>`, see [LOCKED_FILES.md](LOCKED_FILES.md)),
so students can't read or change it; the settings apply all the same. Send the project out as a share link or a zip, as usual.

```python
# pynodemap lock my_password
# no copy paste
# track pastes
# hide gradeuser.py answers.txt
# read only test_klondike.txt
```

| Line | What it does |
| --- | --- |
| `# no copy paste` | Copying, cutting, pasting and dragging text are blocked in the editor, and pasting in the console. The status bar says so when someone tries. |
| `# track pastes` | Every paste into the editor is written to **`paste_log.txt`**: the time, the file and line, how many characters, and how the text starts. The log is read only and can't be deleted, and it travels with Export and Share, so it comes back with the work. On the way out it is locked with this file's password, so once imported again it opens only for you. |
| `# grade <student file> <tests>` | Grade that student file with those tests (a `unittest` .py file, or a `.txt` of `>>>` examples). Use as many lines as there are files to grade; **★ Grade** runs them all, then shows their average. `# grade <tests>` alone grades the open file (or the first student file). With no grade line, Grade runs `gradeuser.py`. |
| `# self grade: true` | **★ Grade** is on every file, not just this one, so students can grade themselves against the (hidden or locked) tests as often as they like and see which tests they don't pass yet. `false`, or no line, keeps it on this file only. |
| `# grade_verbose: true` | For each failing test Grade also shows the test's code and what went wrong (the assertion, expected and actual values). With `false`, or no line, it shows only each test's **description**: the first line of its docstring. |
| `# hide <files>` | Those files don't show up at all: not in the explorer, the tabs, autocomplete or traceback links, and they can't be opened. They still run and can be imported, like locked files, and a student's Export leaves them out. Hiding only works when this file is locked (see Teacher mode). |
| `# read only <files>` | Those files open but can't be changed, renamed or deleted (👁 in the explorer). |
| `# whitelist-libs: <libraries>` | The student's code may import only these libraries, e.g. `# whitelist-libs: math random`. The status bar lists just them, autocomplete offers just them, and any other import is flagged in the editor and refused when the code runs (at the `>>>` prompt too). Each file of the project can still be imported. The files this settings file names as yours (hidden files, the tests of the grade lines, or `gradeuser.py` when there are none) may import any library, so tests that use `unittest` still run. A line with no libraries allows none. |

`pynodesettings.py` can hide itself (`# hide pynodesettings.py`). It can't be clicked then, so give it the same password as another
locked file: a password opens **every** file locked with it, so entering it for that other file unlocks the settings too, which starts
teacher mode and lists the settings file again (👻). The sample project does exactly that: unlocking `education.py` with `teach` also
opens its hidden `pynodesettings.py` and `gradeuser.py` (press Grade on the settings file to see a weighted grade of the sample code).
Without such a file, a self-hidden settings file can only be changed by importing the whole project again with **Replace my project**.

## Teacher mode

Once the password of `pynodesettings.py` has been entered (in this browser tab, for that file or for any locked file with the same
password), you are the teacher until the page is reloaded:

- hidden files are listed again, marked 👻, and open like any other file;
- **Export** puts every file in the zip, locked and hidden ones included;
- while `pynodesettings.py` is the open file, the toolbar shows **★ Grade** and **🎓 Educator guide** (with `# self grade: true`, Grade is
  on every file for everyone).

If `pynodesettings.py` has no lock line, everyone is in teacher mode, so lock it.

## Grading

**★ Grade** runs each `# grade` line in turn: the student file, then its tests (with no grade line, `gradeuser.py` against the student's
file). With several lines each gets its own grade, and the last line is the average:

```
# grade main.py main_tests.py
# grade helpers.py helpers_tests.txt
```

```
== main.py with main_tests.py
Grade: 50%
  ...
== helpers.py with helpers_tests.txt
Grade: 100%
  ...
Overall: 75% (the average of 2 grades)
```

A `.txt` test file is run with the student file's names already defined, as if its examples were in that file's docstrings, so
`>>> average([2, 4])` needs no import. For each grade Grade prints the grade and one line per group, never the tests' code:

```
Grade: 62.5%
  Basics  weight 1    2/2 passed    100%
  Harder  weight 3    1/2 passed     50%   not yet: test_sub
```

Each `unittest.TestCase` class is a **group**, and a class attribute `weight = 3` makes a group count three times as much as one with the
default weight of 1. A group's score is the share of its tests that pass; the grade is `sum(weight x score) / sum(weight)`. A `.txt`
file of `>>>` examples is one group, each example a test.

After the groups comes a list of the tests that don't pass yet. By default each is shown by its description, the first line of its
docstring, so give every test one that says what it checks:

```
Not passing yet:
  Harder.test_sub: Subtracting a bigger number gives a negative result.
```

With `# grade_verbose: true` each one also shows the test's code and the failure (`AssertionError: 8 != 2`); for that run the test file is
not kept locked, since its code is what is shown. Leave it off for `# self grade` if the tests should stay secret. A traceback appears only
when the student's code crashes, and lists only the student's files, so to find a bug in a test itself use the **Tests** button. In a `.txt` doctest
file a failing example is shown by its line number, or with verbose, as doctest reports it (the example, what was expected, what came).

Make a file named **`gradeuser.py`** (the **+** in the explorer) and it starts as a template of two weighted groups, with a described
example test in each, that already imports the student's file. Hide it (`# hide gradeuser.py`) or lock it so students can't read the
tests.

## Details

Names in a list are separated by spaces or commas; `# hide` and `# read only` can name a folder, which covers everything in it. Case and spacing don't matter (`# No Copy/Paste` works); a comment line that isn't one
of these is ignored, so you can write notes in the file too. Changes apply as soon as the file changes.

## What this is not

Like locked files, these settings are a classroom convenience, not security. Everything runs in the student's browser, and someone
who knows how can read the project's files from the browser's storage or from the share link, switch the settings off there, or edit
the paste log the same way. They stop casual copying and peeking, and they make the honest path the easy one.
