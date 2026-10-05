"""doctest library: adds the 'doctest' run mode (the Doctest button)."""
import doctest


def _run(mod):
    r = doctest.testmod(mod, verbose=False)
    print(f"doctest: {r.attempted} run, {r.failed} failed" if r.attempted else "doctest: no >>> examples found in docstrings")


run_modes = {"doctest": _run}  # mode id -> fn(module); runner.py calls it after importing the active file as a module
