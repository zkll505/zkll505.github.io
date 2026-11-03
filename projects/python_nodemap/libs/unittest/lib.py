"""unittest library: the 'unittest' run mode (the Tests button), the 'grade' mode (the Grade button), and the report goes to stdout
(not red stderr)."""
import contextlib
import importlib
import inspect
import io
import re
import sys
import textwrap
import unittest

_init = unittest.TextTestRunner.__init__


def _stdout_runner(self, stream=None, *a, **k):  # unittest writes to stderr by default, which the console would show in red
    _init(self, sys.stdout if stream is None else stream, *a, **k)


unittest.TextTestRunner.__init__ = _stdout_runner


def _run(mod):  # run every TestCase in the imported file, and in the project's locked (hidden) files, which the student can't open
    loader = unittest.defaultTestLoader
    suite = loader.loadTestsFromModule(mod)
    for name in _locked():  # provided by runner.py: module names of the locked files
        suite.addTests(loader.loadTestsFromModule(importlib.import_module(name)))
    unittest.TextTestRunner(verbosity=2).run(suite)


def _flat(suite):  # the single tests in a (nested) TestSuite
    for t in suite:
        yield from _flat(t) if isinstance(t, unittest.TestSuite) else [t]


def _pct(x):  # 66.666 -> "66.7%", 100.0 -> "100%"
    return f"{x:.1f}".rstrip("0").rstrip(".") + "%"


def _grade(mod):
    """The Grade button: every `# grade <student file> <test file>` line of pynodesettings.py (or `# grade <test file>`, or just a
    gradeuser.py), in order: the page passes them as the option "grades", [[student or None, tests], ...]. Each is graded on its own
    (_grade_one), and with more than one the overall grade, their average, comes last."""
    grades = _option("grades") or [[None, _option("grade") or ""]]
    scores = []
    for student, tests in grades:
        if len(grades) > 1:
            print(("\n" if scores else "") + f"== {student + ' with ' if student else ''}{tests}")
        scores.append(_grade_one(mod, student, tests))
    if len(grades) > 1:
        print(f"\nOverall: {_pct(sum(scores) / len(scores))} (the average of {len(scores)} grades)")


def _grade_one(mod, student, target):
    """Grade one student file (the module of that name; None = the file this run started from) with the tests in `target`, print the
    result and return the grade as a percentage.
    Each TestCase class is a group with an optional `weight = n` (default 1). A group's score is the share of its tests that pass, and
    the grade is the weighted average of the group scores. A .txt doctest file is one group, each >>> example a test, run with the
    student file's names already defined (as if the examples were in its docstrings; they can import it too).
    Then every test that doesn't pass yet is listed: by its description (the first line of its docstring), or, with the option
    "verbose" (pynodesettings.py: `# grade_verbose: true`), with its code and what went wrong as well."""
    verbose, quiet = _option("verbose", False), io.StringIO()
    rows, failed = [], []  # rows = (group, weight, passed, total); failed = (name, description, details)
    try:
        code = importlib.import_module(student[:-3]) if student else mod
    except BaseException as e:
        print(f"Grade: 0% ({student} couldn't be run: {type(e).__name__}: {e})")
        return 0
    if target.endswith(".txt"):
        import doctest
        with contextlib.redirect_stdout(quiet):
            r = doctest.testfile(target, module_relative=False, report=False, globs=dict(vars(code)))
        rows.append((target, 1, r.attempted - r.failed, r.attempted))
        # doctest's report: one block per failed example, each starting with a line of stars, then File "t.txt", line N
        for block in quiet.getvalue().split("*" * 70):
            m = re.search(r'line (\d+)', block)
            if m and "Failed example" in block:
                failed.append((f"{target}, line {m.group(1)}", "", block.strip().split("\n", 1)[1] if verbose else ""))
    else:
        try:
            tests = importlib.import_module(target[:-3])
        except BaseException as e:
            print(f"Grade: the tests in {target} couldn't be loaded ({type(e).__name__}: {e})")
            return 0
        groups = {}  # class name -> (weight, its tests), in the order they come
        for t in _flat(unittest.defaultTestLoader.loadTestsFromModule(tests)):
            w = getattr(type(t), "weight", 1)
            groups.setdefault(type(t).__name__, (w if isinstance(w, (int, float)) and w >= 0 else 1, []))[1].append(t)
        order = list(vars(tests))  # the loader sorts classes by name: list the groups in the order the file defines them
        groups = dict(sorted(groups.items(), key=lambda g: order.index(g[0]) if g[0] in order else len(order)))
        for name, (w, ts) in groups.items():
            res = unittest.TextTestRunner(stream=quiet, verbosity=0).run(unittest.TestSuite(ts))
            bad = res.failures + res.errors
            total = res.testsRun - len(res.skipped)
            rows.append((name, w, total - len(bad), total))
            for t, err in bad:
                details = ""
                if verbose:  # (the page leaves the test file unlocked for a verbose grade, so its source is there to show)
                    try:
                        details = textwrap.dedent(inspect.getsource(getattr(type(t), t._testMethodName))).rstrip() + "\n"
                    except (AttributeError, OSError, TypeError):
                        pass
                    details += err.rstrip()
                failed.append((f"{name}.{getattr(t, '_testMethodName', t.id())}", t.shortDescription() or "", details))
    counted = [r for r in rows if r[3] and r[1]]
    weights = sum(r[1] for r in counted)
    grade = sum(r[1] * r[2] / r[3] for r in counted) / weights * 100 if weights else 0
    print(f"Grade: {_pct(grade)}")
    width = max([len(r[0]) for r in rows] + [5])
    for name, w, passed, total in rows:
        score = _pct(100 * passed / total) if total else "-"
        print(f"  {name:<{width}}  weight {w:<3}  {passed}/{total} passed  {score:>6}")
    if failed:
        print("\nNot passing yet:")
        for name, desc, details in failed:
            print(f"  {name}" + (f": {desc}" if desc else ""))
            if details:
                print(textwrap.indent(details, "      "))
    return grade


run_modes = {"unittest": _run, "grade": _grade}  # mode id -> fn(module); "grade" has no button of its own (the page adds one, see SETTINGS.md)
