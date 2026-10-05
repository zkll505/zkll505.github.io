/* doctest: the stdlib module, plus a "Doctest" run button that imports the active file and runs its >>> examples. */
PyLibs.add({
  name: 'doctest',
  python: 'libs/doctest/lib.py',
  members: 'testmod testfile run_docstring_examples ELLIPSIS NORMALIZE_WHITESPACE IGNORE_EXCEPTION_DETAIL DocTestSuite',
  modes: [{ id: 'doctest', label: '✔ Doctest', title: 'Import this file and run its doctests' }],
});
