"""unittest library: the 'unittest' run mode (the Tests button), and the report goes to stdout (not red stderr)."""
import importlib
import sys
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


run_modes = {"unittest": _run}  # mode id -> fn(module), matching the manifest in lib.js
