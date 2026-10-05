/* unittest: the stdlib module, plus a "Tests" run button, and its report goes to stdout instead of stderr (see lib.py). */
PyLibs.add({
  name: 'unittest',
  python: 'libs/unittest/lib.py',
  members: 'TestCase main TestSuite TextTestRunner TestLoader defaultTestLoader skip skipIf skipUnless expectedFailure mock',
  methods: 'assertEqual assertNotEqual assertTrue assertFalse assertIs assertIsNot assertIsNone assertIsNotNone assertIn assertNotIn assertIsInstance assertRaises assertAlmostEqual assertGreater assertLess assertGreaterEqual assertLessEqual assertCountEqual assertRegex setUp tearDown setUpClass tearDownClass subTest fail skipTest',
  modes: [{ id: 'unittest', label: '☑ Tests', title: 'Import this file and run its unittest tests' }],
});
