"""doctest library: adds the 'doctest' run mode (the Doctest button)."""
import doctest


def _run(mod):
    text = mod.__file__.endswith(".txt")  # a text file (test_klondike.txt) is run as it is; a .py file is imported and its docstrings run
    r = doctest.testfile(mod.__file__, module_relative=False, verbose=False) if text else doctest.testmod(mod, verbose=False)
    print(f"doctest: {r.attempted} run, {r.failed} failed" if r.attempted else f"doctest: no >>> examples found in {'the file' if text else 'docstrings'}")


run_modes = {"doctest": _run}  # mode id -> fn(module); runner.py calls it after importing the active file as a module
