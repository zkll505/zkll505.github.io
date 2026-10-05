"""unittest library: the 'unittest' run mode (the Tests button), and the report goes to stdout (not red stderr)."""
import sys
import unittest

_init = unittest.TextTestRunner.__init__


def _stdout_runner(self, stream=None, *a, **k):  # unittest writes to stderr by default, which the console would show in red
    _init(self, sys.stdout if stream is None else stream, *a, **k)


unittest.TextTestRunner.__init__ = _stdout_runner


def _run(mod):
    unittest.main(module=mod, argv=["unittest"], exit=False, verbosity=2)


run_modes = {"unittest": _run}
