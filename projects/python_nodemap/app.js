/* Python Nodemap: the IDE, running on the page's main thread. Python itself runs in a worker (worker.js + runner.py).
   Everything is a plain global on purpose, so you can poke at it from the browser console (S, P, W, cm, NodeMap, PyLibs).

   Where things are, top to bottom:  state (S, P) -> the worker client (W) -> console -> editor (CodeMirror) -> files/tabs ->
   node map (analyse, draw, highlight, zoom, folding) -> preferences -> stepping -> run / stop / input() -> import / export / share
   -> resizable panels -> start-up.

   The main loops:  typing -> analyze (debounced) -> S.graph -> NodeMap.build() -> SVG in #map
                    Run -> W.call('run') -> S.trace + S.tl (the timeline) -> draw() again, now with values
                    stepping -> NodeMap.viewAt(S.tl, step) -> draw() */
'use strict';
let pipWin = null; // the window the node map was popped out into (see popMap), or null
const $ = s => document.querySelector(s) || pipWin?.document.querySelector(s);
const STORE = 'python_nodemap.v1', PREFS = 'python_nodemap.prefs'; // localStorage keys: the project (files, tabs) and the preferences
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/'; // pinned: Pyodide 314+ only supports module workers; 0.29 (Python 3.13) works in our classic Blob worker
// unpacked sizes of what Pyodide downloads (about 5 MB over the wire), used for the progress bar. Re-measure if PYODIDE changes.
const PYODIDE_SIZES = { 'pyodide.asm.wasm': 8647684, 'python_stdlib.zip': 2424003, 'pyodide.asm.js': 1074322, 'pyodide-lock.json': 122027 };
let ready = false; // Python finished loading
const STOPPED = new Error('stopped'); // what a pending worker call rejects with when Stop kills the worker (not an error to show)

// the project a first-time visitor starts with: a function, a class, a loop, an if/else, an import of a second file and a doctest
const STARTER = {
  'main.py': `import random
from helpers import average


def add(a, b):
    """Return a + b.

    >>> add(2, 3)
    5
    """
    return a + b


class Dog:
    def __init__(self, name):
        self.name = name
        self.tricks = []

    def learn(self, trick):
        self.tricks.append(trick)

    def show(self):
        return self.name + " knows " + str(len(self.tricks)) + " trick(s)"


total = 0
for i in range(1, 4):
    total = add(total, i)
print("total:", total)

rex = Dog("Rex")
rex.learn("sit")
print(rex.show())

scores = [random.randint(50, 100) for _ in range(5)]
print("average:", average(scores))

if total > 10:
    print("big")
else:
    print("small")

if __name__ == "__main__":
    import doctest
    doctest.testmod()
`,
  'helpers.py': `def average(nums):
    """Mean of a list.

    >>> average([2, 4])
    3.0
    """
    return sum(nums) / len(nums)
`,
  // for teachers: how to use the tool with a class (locked; the password is "teach", see the README)
  'education.py': `# pynodemap lock teach
#
# ================================================================================================================
#   PYTHON NODEMAP FOR EDUCATORS
# ================================================================================================================
# You opened this with the password "teach". Students see this file with a lock and can't open it without that
# password. It is only part of the sample project: delete it from your own projects (hover it, then the cross).
# The Tutorial button explains the tool itself; open pynodesettings.py for the Educator guide button.
#
# ----------------------------------------------------------------------------------------------------------------
#   AN ASSIGNMENT IN SIX STEPS
# ----------------------------------------------------------------------------------------------------------------
#   1. Write the starter code students get (klondike.py, say), plus any data or doctest files (.txt).
#   2. Make a file named gradeuser.py (the + in the explorer). It starts out as a grading template: every class
#      is a group of unittest tests with a weight, and the grade is the weighted average of the groups.
#   3. Make a file named pynodesettings.py, one setting per comment line, for example
#          # hide gradeuser.py          (students don't see the grading tests at all)
#          # track pastes               (every paste into the editor is logged in paste_log.txt)
#      and lock it with a password of your own: a line starting "# pynodemap lock" followed by the password.
#   4. Press Share. The link holds every file, locked and hidden ones too (in the part after #, which never
#      reaches a server). Post it for the class. Students who open it get the whole project, locks included.
#   5. Students work and send the result back: Share (a link) or Export (a zip of their files).
#   6. Open a student's link or zip (Import), open pynodesettings.py with your password and press Grade.
#
# ----------------------------------------------------------------------------------------------------------------
#   LOCKED FILES
# ----------------------------------------------------------------------------------------------------------------
#   A line starting "# pynodemap lock" makes a .py file unopenable without the password written after it (no
#   password at all seals it for good). A locked file still runs: students can import it, and the Tests button
#   runs the unittest tests in locked files too, without ever showing their source, not even in tracebacks.
#   The password is asked once per session; reloading the page locks the file again.
#
# ----------------------------------------------------------------------------------------------------------------
#   PYNODESETTINGS.PY (lock it, or students can open it and change it back)
# ----------------------------------------------------------------------------------------------------------------
#   # no copy paste        no copying, cutting, pasting or dragging text in the editor; no pasting in the console
#   # track pastes         each paste into the editor goes in paste_log.txt (time, file, line, size, how it starts);
#                          the log is read only, can't be deleted, and comes back with the student's Share / Export
#   # grade tests.py       the file Grade runs (default: gradeuser.py if there is one); a .txt file of >>> examples
#                          works too, each example counting as one test
#   # self grade: true     Grade on every file: students grade themselves and see which tests fail (by description)
#   # grade_verbose: true  Grade also shows each failing test's code and what went wrong (default: descriptions only)
#   # hide a.py b.txt      those files are not listed at all and can't be opened; they still run and import
#   # read only data.txt   those files open but can't be changed, renamed or deleted
#
# ----------------------------------------------------------------------------------------------------------------
#   TEACHER MODE
# ----------------------------------------------------------------------------------------------------------------
#   Once you have entered the password of pynodesettings.py (in this browser tab; a password opens every file locked
#   with it, which is how this sample's hidden settings and gradeuser.py show up), hidden files are listed again,
#   marked with a ghost, and Export puts every file in the zip, locked and hidden ones included. The Grade and
#   Educator guide buttons appear while pynodesettings.py is the open file. Reloading the page ends it.
#
# ----------------------------------------------------------------------------------------------------------------
#   GRADING (gradeuser.py)
# ----------------------------------------------------------------------------------------------------------------
#   Each unittest.TestCase class is a group. Give a class "weight = 3" to make it count three times as much as a
#   class with the default weight of 1. A group's score is the share of its tests that pass; the grade is
#   sum(weight x score) / sum(weight). Grade prints the grade and a line per group with the tests that fail:
#       Grade: 62.5%
#         Basics  weight 1    2/2 passed    100%
#         Harder  weight 3    1/2 passed     50%   not yet: test_edge_cases
#   Grade imports the student's module the way the tests do, so name the student's file in gradeuser.py's import.
#   Give every test a docstring: its first line is what Grade shows for a test that fails.
#
# ----------------------------------------------------------------------------------------------------------------
#   WHAT STUDENTS CAN RUN THEMSELVES
# ----------------------------------------------------------------------------------------------------------------
#   Run (Ctrl+Enter), Doctest (the >>> examples in docstrings, or in a .txt file), Tests (unittest, locked test
#   files included), Coverage (a coverage report -m style table; lines that never ran are shaded red).
#   input() is answered right in the console, and after a run the console is a >>> Python prompt in the program's
#   variables, like IDLE.
#
# ----------------------------------------------------------------------------------------------------------------
#   TEACHING WITH THE NODE MAP
# ----------------------------------------------------------------------------------------------------------------
#   Every statement is a box; a box inside a box is part of its body (that's also scope). After Run each box shows
#   the values it set and how often it ran (x5); boxes that never ran are dimmed. Wires: solid = data (where a
#   value comes from), dashed orange = a call (a two-way arrow when it returns a value), dotted = a value carried
#   round a loop. The step bar replays the run one line at a time: good for "what is total after the 3rd pass?"
#   questions. The pop-out button puts the map in its own window, handy on a projector.
#
# ----------------------------------------------------------------------------------------------------------------
#   GOOD TO KNOW
# ----------------------------------------------------------------------------------------------------------------
#   Everything runs in the student's browser: nothing is uploaded, and there are no accounts. That also means the
#   locks and settings are a classroom deterrent, not security: someone determined can read a share link or the
#   browser's storage. Keep real answer keys out of what you hand out if that matters.
#   Long share links can be cut off by some chat apps; send a zip (Export) instead.
`,
  // the sample project's settings and grading tests: hidden from students and locked with the same password as education.py, so
  // unlocking education.py with "teach" unlocks them too, starts teacher mode, and they show up (👻)
  'pynodesettings.py': `# pynodemap lock teach
# hide pynodesettings.py gradeuser.py
#
# Python Nodemap settings for this project, one per line (see the Educator guide, or education.py).
# This file and gradeuser.py are hidden: they show up (marked with a ghost) once you have unlocked education.py,
# since they share its password. Open this file and press Grade to grade main.py with gradeuser.py's tests.
# Settings you could add (take "example:" off the front):
#   example: # no copy paste
#   example: # track pastes
#   example: # self grade: true
#   example: # grade_verbose: true
#   example: # hide gradeuser.py
#   example: # read only data.txt
`,
  'gradeuser.py': `# pynodemap lock teach
"""gradeuser.py for the sample project: how main.py and helpers.py would be graded (hidden and locked with "teach").

Open pynodesettings.py and press Grade. Each class is a group of tests; its weight says how much it counts, and the grade is the
weighted average of the groups. A test's docstring is what Grade shows when that test fails. Try breaking add() in main.py.
"""
import unittest

import helpers
import main


class Functions(unittest.TestCase):
    weight = 1

    def test_add(self):
        """add() returns the sum of two numbers."""
        self.assertEqual(main.add(2, 3), 5)
        self.assertEqual(main.add(-1, 1), 0)

    def test_average(self):
        """average() returns the mean of a list."""
        self.assertEqual(helpers.average([2, 4]), 3)


class Dogs(unittest.TestCase):
    weight = 2  # counts twice as much as Functions

    def test_learn(self):
        """A dog remembers every trick it learns, in order."""
        dog = main.Dog("Fido")
        dog.learn("sit")
        dog.learn("roll over")
        self.assertEqual(dog.tricks, ["sit", "roll over"])

    def test_show(self):
        """show() says the dog's name and how many tricks it knows."""
        dog = main.Dog("Fido")
        dog.learn("sit")
        self.assertEqual(dog.show(), "Fido knows 1 trick(s)")
`,
};

// ---- state. Files + open tabs persist in localStorage; everything else lives for the session.
const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
// S = the project and the current results. Files, open tabs and the active file are saved; the rest lives for the session.
const S = (() => { const s = read(STORE); return s?.files?.[s.active] ? s : { files: { ...STARTER }, open: ['main.py'], active: 'main.py' }; })();
Object.assign(S, {
  trace: {},   // file -> values/hits of the finished run
  tl: null,    // step timeline of the last run; step = null means "finished" (the final values)
  step: null, views: null,
  error: null, // {file, line, msg} of the last run
  cover: null, // {file: [lines that never ran]} of the last Coverage run
  graph: {}, key: {}, err: {}, hints: {}, fold: {}, // per-file analysis results (key = what they were computed from)
});
// P = preferences (saved): theme, editor font size, map zoom (a number or 'fit'), the wire filters (data / calls / loops = back) and
// `only` (draw just the selected node's wires)
const P = { light: false, font: 14, zoom: 1, data: true, call: true, back: true, only: false, ...read(PREFS) };
const docs = {}; // file name -> CodeMirror document (keeps undo history and cursor per file)
const save = () => store(STORE, { files: S.files, open: S.open, active: S.active });
let timer;
// debounce: f runs only if nothing else calls later() within ms milliseconds
const later = (f, ms) => { clearTimeout(timer); timer = setTimeout(f, ms); };
const setStatus = t => { $('#st').textContent = t; };
// the project's module names (file names without .py): they can import each other, so analysis must know them
// A project holds .py files (modules: they can import each other) and .txt files (plain text: a doctest file like test_klondike.txt,
// or data for open()). Only the .py files are analysed, drawn on the map and imported.
const isPy = n => n.endsWith('.py');
const modsOf = () => Object.keys(S.files).filter(isPy).map(f => f.slice(0, -3)).sort();
const okName = n => /^[A-Za-z_]\w*\.py$/.test(n) || /^[\w-]+\.txt$/.test(n);

// ---- locked files. A line `# pynodemap lock <password>` in a file makes it unopenable: the explorer shows it with a 🔒, and clicking it
// asks for the password. A locked file still runs (import it, or press Tests) but its source stays hidden, and Export and Share leave
// it out. This is a soft lock for the classroom, not security: docs/LOCKED_FILES.md says what it does and doesn't protect.
const LOCK = /^[ \t]*#[ \t]*pynodemap[ \t]+lock\b[ \t]*(.*?)[ \t]*$/im;
S.unlocked = new Set(); // locked files whose password was entered during this session (never saved)
const lockOf = n => { const m = isPy(n) ? LOCK.exec(S.files[n] ?? '') : null; return m ? m[1] : null; }; // its password ('' = none: sealed), or null if it isn't locked
// ---- pynodesettings.py: a teacher's settings for the project, one comment line each (docs/SETTINGS.md). Lock it like any other file
// (`# pynodemap lock <password>`) so students can't change it; the settings apply all the same.
//   # no copy paste           no copying, cutting, pasting or dragging text in the editor or the console
//   # track pastes            every paste into the editor is written to paste_log.txt (read only, can't be deleted)
//   # grade tests.py          the file Grade runs (unittest, or the >>> examples of a .txt); without it, gradeuser.py
//   # self grade: true        the Grade button is on every file, so students can grade themselves (it is otherwise only on this file)
//   # grade_verbose: true     Grade shows the code of each failing test and what went wrong (false: only the tests' descriptions)
//   # hide a.py notes.txt     those files don't show up at all; they still run and can be imported (like locked files)
//   # read only data.txt      those files open but can't be changed
const SETTINGS = 'pynodesettings.py', PASTES = 'paste_log.txt';
const cfg = (() => { // the parsed settings, re-read whenever the settings file changes
  let src = null, val = null;
  return () => {
    if (S.files[SETTINGS] === src && val) return val;
    src = S.files[SETTINGS];
    val = { nocopy: false, pastes: false, grade: null, selfgrade: false, verbose: false, hide: new Set(), readonly: new Set() };
    for (const line of (src || '').split('\n')) {
      const m = /^\s*#\s*(no\s*copy\s*(?:\/|,|and|&)?\s*paste|track\s+pastes?|paste\s+tracking|self[\s_]*grade|grade[\s_]*verbose|grade|hide|hidden|read\s*only)\b\s*(.*?)\s*$/i.exec(line);
      if (!m) continue;
      const key = m[1].toLowerCase().replace(/[\s_]+/g, ''), rest = m[2].replace(/^[:=]\s*/, ''), names = rest.split(/[\s,]+/).filter(Boolean);
      const yes = !/^(false|no|off|0)$/i.test(rest); // a yes / no setting: `# self grade: true` (a bare `# self grade` means yes too)
      if (key.startsWith('nocopy')) val.nocopy = true;
      else if (key.startsWith('track') || key === 'pastetracking') val.pastes = true;
      else if (key === 'selfgrade') val.selfgrade = yes;
      else if (key === 'gradeverbose') val.verbose = yes;
      else if (key === 'grade') val.grade = names[0] || null;
      else if (key === 'hide' || key === 'hidden') names.forEach(n => val.hide.add(n));
      else names.forEach(n => val.readonly.add(n));
    }
    if (val.pastes) val.readonly.add(PASTES);
    return val;
  };
})();
// teacher mode: the project has a pynodesettings.py and it is open to you (its password was entered this session, or it has none).
// Then hidden files are listed again (👻) and can be opened, and Export takes every file, locked ones included.
const teacher = () => SETTINGS in S.files && (lockOf(SETTINGS) === null || S.unlocked.has(SETTINGS));
const isHidden = n => cfg().hide.has(n) && !teacher();
const isReadOnly = n => cfg().readonly.has(n);
// a locked file can't be opened without its password; a hidden one can't be opened (or seen) at all
const isLocked = n => isHidden(n) || (lockOf(n) !== null && !S.unlocked.has(n));
// files an import must not overwrite: locked, hidden or read only (the paste log among them)
const isProtected = n => isLocked(n) || isReadOnly(n);
const firstOpenable = skip => Object.keys(S.files).sort().find(n => n !== skip && !isLocked(n));
// the files as autocomplete may see them: a locked file's names stay secret
const visibleFiles = () => Object.fromEntries(Object.entries(S.files).filter(([n]) => isPy(n) && !isHidden(n)).map(([n, s]) => [n, isLocked(n) ? '' : s]));
// a saved project must never open a locked file by itself, as the active file or in a tab
S.open = S.open.filter(n => n in S.files && !isLocked(n));
if (isLocked(S.active)) {
  S.active = S.open[0] || firstOpenable();
  if (!S.active) { S.files['untitled.py'] = ''; S.active = 'untitled.py'; } // a project that is nothing but locked files
}
if (!S.open.includes(S.active)) S.open.push(S.active);

// ---- the mailbox. While a program runs, its worker is busy and can't receive messages, so a key press or click made during a
// `while True:` animation would never reach it. sw.js (a service worker) keeps those events in a mailbox instead, and the running
// program reads it at each window update. The Python worker has to be created AFTER the service worker controls the page, because
// a worker inherits that control; that is why start-up waits here (first visit only, and at most 2.5 s). No service worker
// (private window, old browser, plain http)? Everything still works, but a program sees no events until it finishes.
const mailboxReady = (async () => {
  if (!navigator.serviceWorker) return false;
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await Promise.race([new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })), new Promise(r => setTimeout(r, 2500))]);
    }
  } catch {}
  return !!navigator.serviceWorker.controller;
})();
const mailboxUrl = () => (navigator.serviceWorker?.controller ? new URL('__mailbox', location.href).href : ''); // '' = no mailbox
let pyBusy = false; // Python is executing a run right now (its worker can't take messages): window events go to the mailbox

// ---- Python lives in a worker (worker.js + runner.py + libs/*/lib.py), so the page never freezes and Stop works
const W = {
  n: 0, pend: new Map(), onOut: () => {}, onProgress: () => {},
  call(type, data) { // one request to the worker -> Promise of its result (a JSON string); every call but 'init' waits for Python to be ready
    return (type === 'init' ? Promise.resolve() : W.ready).then(() => new Promise((res, rej) => {
      const id = ++W.n;
      W.pend.set(id, { res, rej });
      W.w.postMessage({ id, type, ...data });
    }));
  },
  start() {
    W.ready = mailboxReady.then(() => {
      W.w = new Worker(URL.createObjectURL(new Blob([`(${workerMain})()`], { type: 'text/javascript' })));
      W.w.onmessage = ({ data: m }) => {
        if (m.type === 'out') return W.onOut(m.text, m.cls);
        if (m.type === 'progress') return W.onProgress(m.loaded, m.total);
        if (m.type === 'gui') return PyLibs.view(m.lib)?.apply(m.tree);
        if (m.type === 'trace') return liveTrace(m.files);
        if (m.type === 'input') return wantInput();
        const p = W.pend.get(m.id);
        W.pend.delete(m.id);
        if (p) m.error ? p.rej(new Error(m.error)) : p.res(m.result);
      };
      W.w.onerror = e => out(`Python worker error: ${e.message || e}\n`, 'err');
      W.src ??= Promise.all([fetchText('runner.py'), PyLibs.load()]); // fetched once; a restart (Stop) reuses it
      return W.src.then(([runner, libs]) => W.call('init', { url: PYODIDE, runner, libs, allowed: PyLibs.names(), sizes: PYODIDE_SIZES }));
    });
    W.ready.catch(() => {});
  },
  restart() { // Stop: killing the worker is the only way to interrupt running Python (it restarts; the files are in the HTTP cache)
    W.w.terminate();
    W.pend.forEach(p => p.rej(STOPPED));
    W.pend.clear();
    W.start();
  },
};

// ---- console. A re-run (after input) re-sends output we already showed, so only the new part is displayed:
// `seen` = characters received during this attempt, `shown` = the most characters of any attempt, already on screen.
let seen = 0, shown = 0;
// A program's output may hold ANSI codes, as a text game does: colours (\x1b[31m) become styles, "clear screen" (\x1b[2J) empties the
// console, and any other code is dropped. `sgr` is the colour / bold in force; it carries over from one piece of output to the next.
const PAL = ['#000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5', '#666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#fff'];
const ANSI = /\x1b\[([?\d;]*)([A-Za-z])/g;
let sgr = {};
function setSgr(params) { // \x1b[...m: 0 reset, 1 bold, 22 not bold, 30-37 / 90-97 colour, 40-47 / 100-107 background, 39 / 49 default
  const c = params === '' ? [0] : params.split(';').map(Number);
  for (let i = 0; i < c.length; i++) {
    const n = c[i];
    if (n === 0) sgr = {};
    else if (n === 1) sgr.b = true;
    else if (n === 22) delete sgr.b;
    else if (n === 39) delete sgr.fg;
    else if (n === 49) delete sgr.bg;
    else if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) sgr.fg = PAL[n < 90 ? n - 30 : n - 82];
    else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) sgr.bg = PAL[n < 100 ? n - 40 : n - 92];
    else if (n === 38 || n === 48) i += c[i + 1] === 5 ? 2 : 4; // 256 / true colour: not supported, skip its arguments
  }
}
const sgrStyle = () => (sgr.fg ? `color:${sgr.fg};` : '') + (sgr.bg ? `background:${sgr.bg};` : '') + (sgr.b ? 'font-weight:bold;' : '');
// Console output is queued and written about every 30 ms, so a program that prints thousands of lines a second costs the page one
// scroll (and one layout) per tick instead of one per line (the worker already sends it in batches).
let queued = [], outTimer = 0;
function out(text, cls = '') {
  queued.push([text, cls]);
  outTimer ||= setTimeout(drainOut, 30);
}
function drainOut() {
  clearTimeout(outTimer);
  outTimer = 0;
  const q = queued;
  queued = [];
  q.forEach(([text, cls]) => writeOut(text, cls));
  $('#out').scrollTop = 1e9;
}
function writeOut(text, cls) { // append text to the console. Program output (cls '') is read for ANSI codes; messages and errors are plain
  if (cls) return put(text, cls, '');
  let at = 0;
  for (const m of text.matchAll(ANSI)) {
    put(text.slice(at, m.index), '', sgrStyle());
    at = m.index + m[0].length;
    if (m[2] === 'm') setSgr(m[1]);
    else if (m[2] === 'J' && (m[1] === '2' || m[1] === '3')) clearOut();
  }
  put(text.slice(at), '', sgrStyle());
}
// The console only ever keeps the newest MAXOUT characters. Nearing that, the oldest output is dropped (down to KEEPOUT, so it isn't
// redone on every line) and a note at the top says so; a program can print as much as it likes without being stopped or slowing the page.
const MAXOUT = 200000, KEEPOUT = 150000;
let outChars = 0; // characters on the console now (not counting the note)
// #line (an <input> after the output, so it sits right after a prompt like "number: ") is always the console's last child
const LINE = $('#line'), IN = $('#in');
const clearOut = () => { $('#out').textContent = ''; $('#out').append(LINE); outChars = 0; queued = []; };
function trimOut() {
  const box = $('#out');
  let note = box.querySelector(':scope > #cut');
  if (!note) { note = Object.assign(document.createElement('span'), { id: 'cut', className: 'dim', textContent: '[earlier output cleared]\n' }); box.prepend(note); }
  while (outChars > KEEPOUT && note.nextSibling?.nextSibling && note.nextSibling.nextSibling !== LINE) { // (the newest piece always stays)
    outChars -= note.nextSibling.textContent.length;
    note.nextSibling.remove();
  }
  const only = note.nextSibling; // one huge piece of text (a print of millions of characters): keep its end
  if (outChars > KEEPOUT && only !== LINE && only?.childNodes.length === 1 && only.firstChild.nodeType === 3) { only.firstChild.data = only.firstChild.data.slice(-KEEPOUT); outChars = KEEPOUT; }
}
function put(text, cls, style) { // one span of console text; `File "x.py", line 3` in a traceback becomes a link to that line
  if (!text) return;
  const span = document.createElement('span');
  span.className = cls;
  if (style) span.style.cssText = style;
  text.split(/(File "[^"]+", line \d+)/).forEach((p, i) => {
    if (i % 2 === 0) return span.append(p);
    const [, f, l] = /File "([^"]+)", line (\d+)/.exec(p);
    if (isLocked(f)) return span.append(p); // a locked file can't be opened: plain text, no link
    const a = document.createElement('a');
    a.textContent = p; a.dataset.file = f; a.dataset.line = l;
    span.append(a);
  });
  $('#out').insertBefore(span, LINE);
  outChars += text.length;
  if (outChars > MAXOUT) trimOut();
}
W.onOut = (text, cls) => {
  const from = Math.max(0, shown - seen);
  seen += text.length;
  shown = Math.max(shown, seen);
  if (from < text.length) out(text.slice(from), cls);
};
$('#out').onclick = e => {
  const a = e.target.closest('a');
  if (a && S.files[a.dataset.file] && !isLocked(a.dataset.file)) { openFile(a.dataset.file); gotoLine(+a.dataset.line); return; }
  if (!LINE.hidden && !getSelection().toString()) IN.focus({ preventScroll: true }); // a click in the console means "let me type"
};
$('#clear').onclick = clearOut;

// The typing line: an answer to input() while a program waits (wantInput: it really waits, through the service worker; or, without
// one, the program is re-run with the answers so far), or Python at the >>> prompt once it has finished (shellLine), in the globals the
// program left behind, like IDLE after F5. Up / Down bring back earlier entries.
function showLine(prompt, focus) {
  LINE.dataset.p = prompt;
  LINE.hidden = false;
  drainOut();
  if (focus) IN.focus({ preventScroll: true });
  $('#out').scrollTop = 1e9;
}
const hideLine = () => { LINE.hidden = true; };
let more = ''; // an unfinished block typed at the >>> prompt (a `for` line, say): sent again with the next line
// (the prompt takes the keyboard back if you were typing in the console: its line was hidden while the code ran, so focus fell to <body>)
const showIdle = (focus = [IN, document.body, null].includes(document.activeElement)) => { if (ready && !job) showLine(more ? '... ' : '>>> ', focus); };
const hist = [];
let hpos = 0;
function wantInput() { // the running program called input() and waits for the answer (runner.ask)
  if (!job) return;
  job.waiting = 'block';
  setStatus('Waiting for your input…');
  showLine('', true);
}
async function shellLine(v) {
  out(LINE.dataset.p, 'dim');
  out(v + '\n', 'echo');
  const src = more ? more + '\n' + v : v;
  if (v.trim()) { hist.push(v); hpos = hist.length; }
  if (!src.trim()) return showIdle();
  job = { repl: true };
  hideLine(); setRunning(true); setStatus('Running…');
  seen = shown = 0;
  pyBusy = true;
  let res = null;
  try {
    res = JSON.parse(await W.call('shell', { src, files: S.files, locked: Object.keys(S.files).filter(isLocked), mailbox: mailboxUrl() }));
  } catch (e) {
    if (e === STOPPED) return;
    out(String(e.message || e) + '\n', 'err');
  } finally {
    pyBusy = false;
  }
  job = null;
  setRunning(false); setStatus('Ready');
  more = res?.more ? src : '';
  if (res?.files) liveTrace(res.files); // calls into the program's functions update its values on the map
  drainOut();
  showIdle();
}
IN.onkeydown = e => {
  if (!job && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && hist.length) {
    e.preventDefault();
    hpos = Math.max(0, Math.min(hist.length, hpos + (e.key === 'ArrowUp' ? -1 : 1)));
    IN.value = hist[hpos] ?? '';
    return;
  }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const v = IN.value;
  IN.value = '';
  if (job?.waiting === 'block') { // (runner.ask is waiting in the service worker's mailbox)
    job.waiting = null;
    hideLine(); setStatus('Running…');
    navigator.serviceWorker.controller?.postMessage({ lib: '__input', ev: v });
  } else if (job?.waiting === 'replay') {
    job.waiting = null;
    hideLine();
    job.answers.push(v);
    attempt();
  } else if (!job && ready) shellLine(v);
};

// ---- editor
const complete = c => c.showHint({ hint: cc => PyComplete.hint(cc, visibleFiles()), completeSingle: false });
const cm = CodeMirror($('#cm'), {
  mode: 'python', theme: 'vscode', lineNumbers: true, gutters: ['lint', 'CodeMirror-linenumbers'], indentUnit: 4,
  matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
  extraKeys: {
    Tab: c => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ', 'end')),
    'Shift-Tab': 'indentLess', 'Ctrl-/': 'toggleComment', 'Ctrl-Enter': () => run(), F5: () => run(), 'Ctrl-S': () => {},
    'Ctrl-Space': complete, 'Ctrl-F': () => openFind(false), 'Ctrl-H': () => openFind(true), F3: () => findStep(1), 'Shift-F3': () => findStep(-1),
    Esc: () => (findOpen() ? closeFind() : CodeMirror.Pass),
  },
});
// Insert toggles overwrite mode (CodeMirror's default key); the cursor becomes a block (style.css) and the status bar says OVR
cm.on('overwriteToggle', (c, on) => { $('#ovr').hidden = !on; });
// pynodesettings.py: `# no copy paste` stops copying, cutting, pasting and dragging text; `# track pastes` writes each paste to the log
for (const ev of ['copy', 'cut', 'paste', 'drop', 'dragstart']) {
  cm.on(ev, (c, e) => { if (cfg().nocopy) { e.preventDefault(); setStatus('Copy and paste are turned off for this project'); } });
}
for (const ev of ['paste', 'drop']) IN.addEventListener(ev, e => { if (cfg().nocopy) { e.preventDefault(); setStatus('Copy and paste are turned off for this project'); } });
cm.on('beforeChange', (c, ch) => {
  if (ch.origin === 'paste' && cfg().pastes && S.active !== PASTES) logPaste(S.active, ch.from.line + 1, ch.text.join('\n'));
});
function logPaste(file, line, text) { // one line per paste in paste_log.txt: when, where, how much, and how it starts
  const when = new Date().toLocaleString('sv').slice(0, 19), start = text.slice(0, 60).replace(/\n/g, '⏎');
  const head = S.files[PASTES] ?? '# Every paste into the editor, written by Python Nodemap (pynodesettings.py: # track pastes)\n';
  S.files[PASTES] = head + `${when}  ${file} line ${line}  ${text.length} characters  "${start}${text.length > 60 ? '…' : ''}"\n`;
  docs[PASTES]?.setValue(S.files[PASTES]);
  save();
  if (!$('#files li[data-f="' + PASTES + '"]')) chrome();
}
const docOf = n => (docs[n] ||= CodeMirror.Doc(S.files[n], isPy(n) ? 'python' : null));
cm.on('change', () => { // every edit: store it, drop the results of the last run (they no longer match), re-analyse shortly
  S.files[S.active] = cm.getValue();
  const tagged = lockOf(S.active) !== null; // typing (or deleting) the lock tag in the open file: it stays open until the page is reloaded
  if (tagged !== S.unlocked.has(S.active)) { if (tagged) S.unlocked.add(S.active); else S.unlocked.delete(S.active); chrome(); }
  delete S.trace[S.active];
  S.tl = null; S.step = null; S.error = null; S.cover = null; // the recorded run no longer matches the code
  stopPlay(); showMarks(); updateStepper();
  save();
  if (findOpen()) findHits();
  if (S.active === SETTINGS) applySettings();
  later(refresh, 350);
});
cm.on('cursorActivity', () => {
  const c = cm.getCursor();
  $('#pos').textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}`;
  mark(true);
});
cm.on('inputRead', (c, ch) => { // autocomplete as you type: after a dot, or after two identifier characters
  if (c.state.completionActive || ch.origin !== '+input' || !/^[\w.]$/.test(ch.text[0] || '')) return;
  if (/string|comment/.test(c.getTokenTypeAt(c.getCursor()) || '')) return;
  const before = c.getLine(c.getCursor().line).slice(0, c.getCursor().ch);
  if (ch.text[0] === '.' || /[A-Za-z_]\w$/.test(before)) complete(c);
});
function gotoLine(l) { // 1-based line: put the cursor there and scroll it into view
  cm.setCursor({ line: l - 1, ch: 0 });
  cm.scrollIntoView(null, 120);
  cm.focus();
}

// marks in the editor: the line being stepped to, the line that raised an error, and lint squiggles
const slot = {}; // 'now' and 'err': the one highlighted line of each kind (and its message widget), so it can be cleared
function clearSlot(k) {
  const m = slot[k];
  if (!m) return;
  m.doc.removeLineClass(m.h, 'background', m.cls);
  m.w?.clear();
  slot[k] = null;
}
function markLine(k, line, cls) {
  if (line < 1 || line > cm.lineCount()) return null;
  return (slot[k] = { doc: cm.getDoc(), h: cm.addLineClass(line - 1, 'background', cls), cls });
}
let coverMarks = []; // the editor lines a Coverage run says never ran (shaded)
function showMarks() {
  clearSlot('now'); clearSlot('err');
  coverMarks.forEach(m => m.doc.removeLineClass(m.h, 'background', 'cm-miss'));
  coverMarks = (S.cover?.[S.active] || []).filter(l => l <= cm.lineCount()).map(l => ({ doc: cm.getDoc(), h: cm.addLineClass(l - 1, 'background', 'cm-miss') }));
  const [f, l] = nowAt();
  if (f === S.active && l) { markLine('now', l, 'cm-now'); cm.scrollIntoView({ line: l - 1, ch: 0 }, 90); }
  const e = S.error;
  if (e && e.file === S.active) {
    const m = markLine('err', e.line, 'cm-err');
    if (m) {
      const el = document.createElement('div');
      el.className = 'err-widget';
      el.textContent = e.msg;
      m.w = cm.addLineWidget(e.line - 1, el);
    }
  }
}
let lintMarks = [];
function showHints() { // draw the analyser's hints: a squiggle under the line, a dot in the gutter, the count in the status bar
  lintMarks.forEach(m => m.clear());
  lintMarks = [];
  cm.clearGutter('lint');
  const hs = S.hints[S.active] || [], byLine = {};
  hs.forEach(h => (byLine[h.line] ||= []).push(h));
  for (const [line, list] of Object.entries(byLine)) {
    const text = cm.getLine(line - 1);
    if (text == null) continue;
    const kind = list.some(h => h.kind === 'error') ? 'error' : 'warn', msg = list.map(h => h.msg).join('\n');
    lintMarks.push(cm.markText({ line: line - 1, ch: text.length - text.trimStart().length }, { line: line - 1, ch: text.length }, { className: 'lint-' + kind, title: msg }));
    const dot = document.createElement('div');
    dot.className = 'lint-dot ' + kind;
    dot.title = msg;
    cm.setGutterMarker(line - 1, 'lint', dot);
  }
  $('#probs').textContent = hs.length ? `⚠ ${hs.length}` : '';
  $('#probs').title = hs.map(h => `line ${h.line}: ${h.msg}`).join('\n');
}

// ---- files: explorer + tabs
function chrome() { // re-render the tab strip, the explorer list and the map's title from S
  $('#tabs').innerHTML = S.open.map(n => `<div class="tab${n === S.active ? ' on' : ''}" data-f="${n}">${n}<b data-x="${n}">×</b></div>`).join('');
  $('#files').innerHTML = Object.keys(S.files).filter(n => !isHidden(n)).sort().map(n => {
    const lk = lockOf(n) !== null, shut = isLocked(n), ro = isReadOnly(n), ghost = cfg().hide.has(n); // 🔒 = locked, 🔓 = locked but its password was entered this session
    const tip = (ghost ? 'Hidden from students (you see it in teacher mode). ' : '') + (lk ? (shut ? 'Locked: click to enter the password' : 'A locked file, open for this session') : ro ? 'Read only: it opens, but it can\'t be changed' : '');
    return `<li class="${n === S.active ? 'on' : ''}${shut ? ' locked' : ''}${ghost ? ' ghost' : ''}" data-f="${n}"${tip ? ` title="${tip}"` : ''}><span>${ghost ? '👻 ' : ''}${lk ? (shut ? '🔒 ' : '🔓 ') : ro ? '👁 ' : ''}${n}</span>${shut || ro ? '' : `<i data-ren="${n}" title="Rename">✎</i><i data-del="${n}" title="Delete">✕</i>`}</li>`;
  }).join('');
  $('#mapname').textContent = '· ' + S.active;
  $('#edu').hidden = S.active !== SETTINGS; // (you can only be viewing it if it is unlocked)
  $('#grade').hidden = S.active !== SETTINGS && !cfg().selfgrade; // `# self grade: true` puts it on every file
}
// remove every trace of file n (its text, document and cached results)
const forget = n => [S.files, docs, S.trace, S.graph, S.key, S.err, S.hints, S.fold].forEach(o => delete o[n]);
function askPassword(n) { // shows the password dialog (index.html); resolves true when the right password is typed
  const dlg = $('#pw'), input = $('#pw-in'), pw = lockOf(n);
  $('#pw-name').textContent = n;
  $('#pw-err').hidden = true;
  input.value = '';
  dlg.returnValue = '';
  return new Promise(resolve => {
    $('#pw-form').onsubmit = e => {
      e.preventDefault();
      if (input.value === pw) dlg.close('ok');
      else { $('#pw-err').hidden = false; input.select(); }
    };
    $('#pw-cancel').onclick = () => dlg.close('cancel');
    dlg.onclose = () => resolve(dlg.returnValue === 'ok');
    dlg.showModal();
    input.focus();
  });
}
async function unlock(n) { // true once file n may be opened: it isn't locked, it was unlocked already, or the right password was entered
  if (isHidden(n)) return false; // (a hidden file can't be opened at all)
  const pw = lockOf(n);
  if (pw === null || S.unlocked.has(n)) return true;
  if (pw === '') { alert(`${n} is locked and can't be opened here.`); return false; } // `# pynodemap lock` with no password seals it
  if (!await askPassword(n)) return false;
  S.unlocked.add(n); // for this session only
  // a password opens every file locked with it: so a settings file that hides itself (it can't be clicked) opens along with another
  // file that shares its password, and one "teach" opens the sample project's education.py, settings and grading tests together
  for (const f of Object.keys(S.files)) if (lockOf(f) === pw) S.unlocked.add(f);
  chrome();
  return true;
}
function openFile(n) { // make n the active file (adding a tab if needed) and redraw everything that depends on it
  if (isLocked(n)) { unlock(n).then(ok => { if (ok) openFile(n); }); return; } // a locked file asks for its password first
  if (!S.open.includes(n)) S.open.push(n);
  S.active = n;
  cm.swapDoc(docOf(n));
  cm.setOption('readOnly', isReadOnly(n));
  chrome(); save(); showMarks(); showHints(); updateStepper(); refresh();
  if (findOpen()) { findHits(); findStep(0); }
  if (!playT) cm.focus();
}
function closeTab(n) {
  S.open = S.open.filter(x => x !== n);
  if (!S.open.length) S.open = [firstOpenable(n) || n];
  openFile(S.active === n || !S.open.includes(S.active) ? S.open[0] : S.active);
}
function askName(msg, def) { // ask for a file name: name.py (letters, digits, _ so `import name` works) or name.txt
  let n = (prompt(msg, def) || '').trim();
  if (!n) return null;
  if (!/\.(py|txt)$/.test(n)) n += '.py';
  if (!okName(n)) { alert('Use letters, digits and _ only (so it can be imported), e.g. my_module.py, or a text file such as tests.txt'); return null; }
  return n;
}
function newFile() {
  const n = askName('New file name:', 'untitled.py');
  if (!n) return;
  if (!(n in S.files)) S.files[n] = n === GRADER ? graderTemplate() : '';
  openFile(n);
}
// gradeuser.py: what Grade runs when pynodesettings.py doesn't name a file. It is made from this template, importing the student's file.
const GRADER = 'gradeuser.py';
const studentFile = () => Object.keys(S.files).sort().find(n => isPy(n) && !isLocked(n) && ![SETTINGS, GRADER, 'education.py', cfg().grade].includes(n));
function graderTemplate() {
  const mod = (studentFile() || 'main.py').slice(0, -3);
  return `"""gradeuser.py: how this project is graded. Open pynodesettings.py and press Grade to run it.

Each class below is a GROUP of tests, and \`weight\` says how much the group counts (1 if a class doesn't say).
A group's score is the share of its tests that pass; the grade is the weighted average of the groups:
with Basics (weight 1) all passing and Harder (weight 3) half passing, the grade is (1 x 100% + 3 x 50%) / 4 = 62.5%.

Give each test a docstring: its first line is what Grade shows for a test that fails (with  grade_verbose: true  in
pynodesettings.py it also shows the test's code and what went wrong). With  self grade: true  students can press Grade
themselves and see which of these they don't pass yet, without seeing the tests' code.

Keep students from reading the tests: in pynodesettings.py add the line   # hide gradeuser.py   (and lock that file),
or lock this one by starting a line with  # pynodemap lock  followed by a password.
"""
import unittest

import ${mod}  # the student's file (change the name if it is a different one)


class Basics(unittest.TestCase):
    weight = 1

    def test_example(self):
        """Describe what this checks, for the student to read when it fails."""
        # replace these with checks of the student's code, e.g. self.assertEqual(${mod}.add(2, 3), 5)
        self.assertTrue(True)


class Harder(unittest.TestCase):
    weight = 3  # counts three times as much as Basics

    def test_example(self):
        """Adding two numbers gives their sum."""
        self.assertEqual(2 + 3, 5)
`;
}
function renameFile(old) {
  if (isProtected(old)) return;
  const n = askName('Rename to:', old);
  if (!n || n === old) return;
  if (n in S.files) return alert(n + ' already exists.');
  const src = S.files[old], doc = isPy(old) === isPy(n) ? docs[old] : null; // (.py <-> .txt changes the highlighting: it gets a fresh document)
  forget(old);
  S.files[n] = src;
  if (S.unlocked.delete(old)) S.unlocked.add(n); // a renamed file stays unlocked
  if (doc) docs[n] = doc;
  S.open = S.open.map(x => (x === old ? n : x));
  if (S.active === old) { S.active = n; cm.swapDoc(docOf(n)); }
  S.tl = null; S.step = null; S.error = null; S.cover = null;
  chrome(); save(); showMarks(); updateStepper(); refresh();
}
function deleteFile(n) {
  if (isProtected(n)) return;
  if (Object.keys(S.files).length < 2 || !firstOpenable(n)) return alert('Keep at least one file that can be opened.');
  if (!confirm(`Delete ${n}? This can't be undone.`)) return;
  forget(n);
  S.open = S.open.filter(x => x !== n);
  if (!S.open.length) S.open = [firstOpenable()];
  S.tl = null; S.step = null; S.error = null; S.cover = null;
  openFile(S.active === n ? S.open[0] : S.active);
}
$('#new').onclick = newFile;
$('#tabs').onclick = e => (e.target.dataset.x ? closeTab(e.target.dataset.x) : e.target.closest('.tab') && openFile(e.target.closest('.tab').dataset.f));
$('#files').onclick = e => {
  const d = e.target.dataset;
  if (d.ren) renameFile(d.ren); else if (d.del) deleteFile(d.del); else if (e.target.closest('li')) openFile(e.target.closest('li').dataset.f);
};

// ---- find / replace (Ctrl+F, Ctrl+H): a bar over the editor. Every match is highlighted and the count says which one is selected;
// Enter, ↓ or F3 go to the next, Shift+Enter, ↑ or Shift+F3 to the previous. Replace changes the selected match and moves on, All
// changes every one in a single undo step. Matching ignores case.
const F = { q: '', hits: [], i: -1, overlay: null }; // hits = where each match starts (character offsets into the file)
const findOpen = () => !$('#find').hidden;
function findHits() { // find every match of the query in the open file and highlight them
  const q = $('#f-q').value, ql = q.toLowerCase();
  if (F.overlay) cm.removeOverlay(F.overlay);
  F.q = q; F.hits = []; F.overlay = null;
  if (q) {
    const text = cm.getValue().toLowerCase();
    for (let i = text.indexOf(ql); i >= 0 && F.hits.length < 100000; i = text.indexOf(ql, i + ql.length)) F.hits.push(i);
    F.overlay = {
      token: s => {
        const j = s.string.slice(s.pos).toLowerCase().indexOf(ql);
        if (j === 0) { s.pos += ql.length; return 'searching'; }
        if (j < 0) s.skipToEnd(); else s.pos += j;
        return null;
      },
    };
    cm.addOverlay(F.overlay);
  }
  if (F.i >= F.hits.length) F.i = F.hits.length - 1;
  findCount();
}
function findCount() {
  $('#f-n').textContent = !F.q ? '' : F.hits.length ? `${F.i + 1 || '?'} of ${F.hits.length.toLocaleString()}` : 'No results';
  $('#f-n').classList.toggle('none', !!F.q && !F.hits.length);
}
function findStep(d) { // d = 1 next, -1 previous, 0 the first match at or after the cursor; selects it and scrolls to it
  if (!findOpen()) return openFind(false);
  const n = F.hits.length;
  if (!n) { F.i = -1; return findCount(); }
  if (d === 0 || F.i < 0) {
    const at = cm.indexFromPos(cm.getCursor('from'));
    F.i = F.hits.findIndex(h => h >= at);
    if (F.i < 0) F.i = 0;
  } else F.i = (F.i + d + n) % n;
  const from = cm.posFromIndex(F.hits[F.i]), to = cm.posFromIndex(F.hits[F.i] + F.q.length);
  cm.setSelection(from, to);
  cm.scrollIntoView({ from, to }, 80);
  findCount();
}
function openFind(replace) {
  const sel = cm.getSelection();
  if (sel && !sel.includes('\n')) $('#f-q').value = sel;
  $('#find').hidden = false;
  F.i = -1;
  findHits();
  findStep(0);
  const box = replace ? $('#f-r') : $('#f-q');
  box.focus();
  box.select();
}
function closeFind() {
  $('#find').hidden = true;
  if (F.overlay) cm.removeOverlay(F.overlay);
  F.overlay = null;
  cm.focus();
}
function replaceOne() {
  if (cm.getOption('readOnly') || !F.hits.length) return;
  if (F.i < 0) return findStep(0);
  const r = $('#f-r').value, start = F.hits[F.i];
  cm.replaceRange(r, cm.posFromIndex(start), cm.posFromIndex(start + F.q.length), '+replace');
  findHits();
  F.i = F.hits.findIndex(h => h >= start + r.length); // the next match after the one just replaced
  if (F.i < 0 && F.hits.length) F.i = 0;
  if (F.i >= 0) { F.i = (F.i - 1 + F.hits.length) % F.hits.length; findStep(1); } else findCount();
}
function replaceAll() {
  if (cm.getOption('readOnly') || !F.hits.length) return;
  const r = $('#f-r').value, n = F.hits.length;
  cm.operation(() => { for (let k = n - 1; k >= 0; k--) cm.replaceRange(r, cm.posFromIndex(F.hits[k]), cm.posFromIndex(F.hits[k] + F.q.length), '+replace'); });
  F.i = -1;
  findHits();
  setStatus(`Replaced ${n.toLocaleString()} match${n === 1 ? '' : 'es'}`);
}
$('#f-q').oninput = () => { F.i = -1; findHits(); findStep(0); };
$('#f-q').onkeydown = e => {
  if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); findStep(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1); }
  else if (e.key === 'Escape') closeFind();
};
$('#f-r').onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); e.ctrlKey || e.metaKey ? replaceAll() : replaceOne(); }
  else if (e.key === 'Escape') closeFind();
};
$('#f-prev').onclick = () => findStep(-1);
$('#f-next').onclick = () => findStep(1);
$('#f-x').onclick = closeFind;
$('#f-one').onclick = replaceOne;
$('#f-all').onclick = replaceAll;

// ---- node map
let act = null, hov = null; // node under the cursor / under the mouse
// Re-analyse the active file if it (or the list of project files) changed since the last analysis, then redraw the map and the hints.
// S.key[file] = what the cached S.graph[file] was computed from. Stale answers (the file changed while we waited) are dropped.
async function refresh() {
  const n = S.active, src = S.files[n], key = src + '\0' + modsOf();
  if (!isPy(n)) { $('#maperr').textContent = ''; draw(); showHints(); return; } // a text file: nothing to analyse
  if (S.key[n] !== key) {
    let g;
    try { g = JSON.parse(await W.call('analyze', { src, mods: modsOf() })); } catch { return; }
    if (n !== S.active || src !== S.files[n]) return; // edited or switched while we waited
    S.key[n] = key;
    if (g.error) {
      S.err[n] = '  syntax error, ' + g.error;
      S.hints[n] = [{ line: g.line, msg: 'Syntax error: ' + g.msg, kind: 'error' }];
    } else {
      S.err[n] = '';
      S.graph[n] = g;
      S.hints[n] = g.hints;
    }
  }
  $('#maperr').textContent = S.err[n] || '';
  draw();
  showHints();
}
const traceOf = file => { // the values to draw for a file: the final ones, or (while stepping) the replay at step S.step
  if (S.step == null || !S.tl) return S.trace[file];
  if (S.views?.s !== S.step) S.views = { s: S.step, v: NodeMap.viewAt(S.tl, S.step) };
  return S.views.v[file];
};
// [file, line] of the step being shown, or [] when the run is finished / there is none
const nowAt = () => (S.step == null || !S.tl ? [] : [S.tl.files[S.tl.steps[2 * S.step]], S.tl.steps[2 * S.step + 1]]);
function draw() { // rebuild the SVG for the active file (graph + trace + folding + theme) and re-apply zoom and highlights
  if (!ready) return; // the loading panel is showing
  const g = S.graph[S.active], box = $('#map');
  if (!g) { box.innerHTML = `<div class="empty">${isPy(S.active) ? 'Nothing to map yet.' : 'A text file has no node map.'}</div>`; S.dim = null; return; }
  const [nf, nl] = nowAt();
  const b = NodeMap.build(g, traceOf(S.active), {
    fold: new Set(S.fold[S.active]),
    now: nf === S.active ? nl : null,
    err: S.error?.file === S.active ? S.error.line : null,
    light: P.light,
  });
  const [sx, sy] = [box.scrollLeft, box.scrollTop];
  box.innerHTML = b.svg;
  box.scrollLeft = sx; box.scrollTop = sy; // replacing the content must not send the map back to the top (browsers differ)
  S.dim = b;
  applyZoom();
  mark();
  if (S.step != null) reveal(box.querySelector('.node.now'), true);
}
// the zoom factor in use ('fit' = as wide as the panel, at most 150%)
const curZoom = () => (P.zoom === 'fit' && S.dim ? Math.min(1.5, ($('#map').clientWidth - 4) / S.dim.w) : +P.zoom || 1);
function applyZoom() {
  const svg = $('#map svg');
  if (!svg || !S.dim) return;
  const z = curZoom();
  svg.setAttribute('width', S.dim.w * z);
  svg.setAttribute('height', S.dim.h * z);
  $('#zlabel').textContent = Math.round(z * 100) + '%';
}
const zoomBy = f => { P.zoom = Math.max(.3, Math.min(2.5, curZoom() * f)); applyZoom(); store(PREFS, P); };
$('#z-in').onclick = () => zoomBy(1.15);
$('#z-out').onclick = () => zoomBy(1 / 1.15);
$('#z-fit').onclick = () => { P.zoom = 'fit'; applyZoom(); store(PREFS, P); };
$('#zlabel').onclick = () => { P.zoom = 1; applyZoom(); store(PREFS, P); };
$('#map').addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); } }, { passive: false });
addEventListener('resize', applyZoom);

function matches(g, q) { // nodes that mention q, and both ends of wires carrying q
  const ids = new Set();
  g.nodes.forEach(n => { if (n.text.toLowerCase().includes(q) || n.show.some(s => s.toLowerCase() === q)) ids.add(n.id); });
  g.wires.forEach(w => { if (w.label.toLowerCase().includes(q)) { ids.add(w.from); ids.add(w.to); } });
  return ids;
}
function paint() { // highlight state: search hits, else the hovered / cursor node and its wires
  const svg = $('#map svg'), g = S.graph[S.active];
  if (!svg || !g) return;
  const vis = id => { while (id != null && !svg.querySelector(`.node[data-id="${id}"]`)) id = g.nodes[id].parent; return id; }; // folded -> its container
  const q = $('#q').value.trim().toLowerCase();
  const hit = q ? new Set([...matches(g, q)].map(vis)) : null;
  const a = act == null ? null : vis(act), id = hov ?? a;
  svg.querySelectorAll('.node').forEach(e => {
    const i = +e.dataset.id;
    e.classList.toggle('act', i === a);
    e.classList.toggle('hit', !!hit && hit.has(i));
  });
  svg.classList.toggle('q', !!hit);
  svg.classList.toggle('f', !!hit || id != null);
  svg.querySelectorAll('.wire').forEach(w => w.classList.toggle('on', hit ? w.dataset.l.toLowerCase().includes(q) : id != null && (+w.dataset.a === id || +w.dataset.b === id)));
}
function reveal(el, center) { // Element.scrollIntoView() does nothing for SVG in Firefox, so scroll the map ourselves
  if (!el) return;
  const box = $('#map'), r = el.getBoundingClientRect(), m = box.getBoundingClientRect();
  box.scrollTop += center ? r.top + r.height / 2 - (m.top + m.height / 2) : r.top < m.top ? r.top - m.top : r.bottom > m.bottom ? r.bottom - m.bottom : 0;
  box.scrollLeft += r.left < m.left ? r.left - m.left : r.right > m.right ? r.right - m.right : 0;
}
function mark(scroll) { // the node under the editor's cursor becomes the selected one; scroll the map to it if asked
  const g = S.graph[S.active];
  act = g ? NodeMap.nodeAt(g, cm.getCursor().line + 1)?.id ?? null : null;
  paint();
  if (scroll) reveal($('#map .node.act'));
}
$('#map').addEventListener('mouseover', e => {
  const id = e.target.closest('.node')?.dataset.id;
  const v = id == null ? null : +id;
  if (v !== hov) { hov = v; paint(); }
});
$('#map').addEventListener('mouseleave', () => { hov = null; paint(); });
$('#map').onclick = e => {
  const f = e.target.closest('.fold');
  if (f) { // collapse / expand a container
    const set = new Set(S.fold[S.active]);
    set.has(f.dataset.fold) ? set.delete(f.dataset.fold) : set.add(f.dataset.fold);
    S.fold[S.active] = [...set];
    return draw();
  }
  const n = e.target.closest('.node');
  if (n) gotoLine(+n.dataset.line);
};
$('#fold-all').onclick = () => { const g = S.graph[S.active]; if (g) { S.fold[S.active] = [...(S.fold[S.active] || []).filter(k => k.startsWith('v:')), ...g.nodes.filter(n => n.kids.length).map(NodeMap.foldKey)]; draw(); } }; // (keeps collapsed value boxes)
$('#unfold-all').onclick = () => { S.fold[S.active] = []; draw(); };
let qi = 0;
$('#q').oninput = () => { qi = 0; paint(); };
$('#q').onkeydown = e => {
  if (e.key !== 'Enter') return;
  const hits = [...$('#map').querySelectorAll('.node.hit')];
  if (hits.length) reveal(hits[qi++ % hits.length], true);
};

// ---- preferences: theme, font size, wire filters
function applyPrefs() {
  document.body.classList.toggle('light', P.light);
  document.body.style.setProperty('--fs', P.font + 'px');
  cm.setOption('theme', P.light ? 'vscode-light' : 'vscode');
  $('#theme').textContent = P.light ? '☾' : '☀';
  const m = $('#map');
  m.classList.toggle('no-data', !P.data);
  m.classList.toggle('no-call', !P.call);
  m.classList.toggle('no-back', !P.back);
  m.classList.toggle('only', P.only);
  for (const k of ['data', 'call', 'back', 'only']) $('#w-' + k).setAttribute('aria-pressed', P[k]);
  cm.refresh();
  store(PREFS, P);
  syncPip();
  draw(); // the node map has its own light palette
}
for (const k of ['data', 'call', 'back', 'only']) $('#w-' + k).onclick = () => { P[k] = !P[k]; applyPrefs(); };
$('#theme').onclick = () => { P.light = !P.light; applyPrefs(); };
$('#font-down').onclick = () => { P.font = Math.max(10, P.font - 1); applyPrefs(); };
$('#font-up').onclick = () => { P.font = Math.min(28, P.font + 1); applyPrefs(); };

// ---- step through the last run
const nSteps = () => (S.tl ? S.tl.steps.length / 2 : 0);
let playT = null;
function stopPlay() { clearInterval(playT); playT = null; $('#s-play').textContent = '▶'; }
function setStep(s) { // s = number of steps already executed; null = finished (shows the final values). Opens the file the step is in.
  if (s != null && s >= nSteps()) s = null;
  S.step = s == null ? null : Math.max(0, s);
  S.views = null;
  const [f] = nowAt();
  if (f && f !== S.active) return openFile(f);
  draw(); showMarks(); updateStepper();
}
function updateStepper() {
  const n = nSteps();
  $('#steps').hidden = !n;
  if (!n) return;
  $('#s-range').max = n;
  $('#s-range').value = S.step ?? n;
  const [f, l] = nowAt();
  $('#s-label').textContent = S.step == null ? `finished · ${n.toLocaleString()} steps${S.tl.trunc ? ' (first part recorded)' : ''}` : `step ${S.step} / ${n} · ${f}:${l}`;
  $('#s-play').textContent = playT ? '❚❚' : '▶';
}
$('#s-first').onclick = () => { stopPlay(); setStep(0); };
$('#s-prev').onclick = () => { stopPlay(); setStep((S.step ?? nSteps()) - 1); };
$('#s-next').onclick = () => { stopPlay(); setStep(S.step == null ? null : S.step + 1); };
$('#s-last').onclick = () => { stopPlay(); setStep(null); };
$('#s-range').oninput = e => { stopPlay(); setStep(+e.target.value); };
$('#s-play').onclick = () => {
  if (playT) return stopPlay();
  if (S.step == null) setStep(0);
  playT = setInterval(() => {
    const s = (S.step ?? nSteps()) + 1;
    if (s >= nSteps()) { stopPlay(); setStep(null); } else setStep(s);
  }, 160);
  updateStepper();
};

// ---- run / stop / input
// input() waits for the line typed at the end of the console: the worker sits in a request the service worker holds until the
// answer arrives (runner.ask, sw.js). Without a service worker (a Firefox private window, say) the program is re-run from the top
// instead, fed the answers collected so far (random is seeded the same), and only output that wasn't shown yet is added.
// job = the run in progress: its files (a snapshot), main file, mode, the input() answers so far, the random seed, and `waiting`
// ('block' or 'replay' while input() wants an answer); {repl: true} while a line typed at the >>> prompt runs
let job = null;
const setRunning = on => { document.querySelectorAll('#run, .runmode').forEach(b => { b.disabled = on || !ready; }); $('#stop').hidden = !on; };
async function run(mode = 'run', cover = false, opts = {}) { // mode = 'run', or the id of a mode a library added (doctest, unittest, grade ...); cover = report the lines that never ran
  if (job || !ready) return;
  hideLine();
  more = '';
  if (!isPy(S.active) && mode === 'run') mode = PyLibs.modes().find(m => m.id === 'doctest')?.id || mode; // a text file has nothing to execute: Run runs its >>> examples
  stopPlay();
  S.tl = null; S.step = null; S.error = null; S.cover = null;
  showMarks(); updateStepper(); draw();
  PyLibs.closeViews();
  const sw = navigator.serviceWorker?.controller;
  if (sw) [...PyLibs.views().map(l => l.name), '__input'].forEach(lib => sw.postMessage({ lib, clear: true })); // nothing left over from the last run
  const main = opts.main || S.active;
  // (a verbose grade shows the tests' code, so the test file is not kept locked for that run: its source has to be there to show)
  const locked = Object.keys(S.files).filter(n => isLocked(n) && !(opts.verbose && n === opts.grade));
  job = { files: { ...S.files }, main, mode, cover, opts, answers: [], seed: Math.floor(Math.random() * 2 ** 31), locked };
  S.ranFiles = { ...S.files };
  clearOut();
  shown = 0; sgr = {};
  out(`▶ ${cover ? 'coverage ' : ''}${mode === 'run' ? '' : mode + ' '}${mode === 'grade' ? opts.grade : main}\n`, 'dim');
  attempt();
}
async function attempt() { // one execution of the job; asks for more input and returns early when input() has no answer yet
  setRunning(true);
  setStatus('Running…');
  seen = 0;
  await new Promise(r => setTimeout(r, 30)); // let the browser paint first
  const t0 = performance.now(), j = job;
  let res = null;
  pyBusy = true;
  try {
    res = JSON.parse(await W.call('run', { files: j.files, main: j.main, mode: j.mode, answers: j.answers, seed: j.seed, mailbox: mailboxUrl(), locked: j.locked, opts: j.opts }));
  } catch (e) {
    if (e === STOPPED) return;
    out(String(e.message || e) + '\n', 'err');
  } finally {
    pyBusy = false;
  }
  if (job !== j) return;
  if (res?.need_input) { // (no service worker: the answer is collected, then the program runs again from the top)
    j.waiting = 'replay';
    setStatus('Waiting for your input…');
    showLine('', true);
    return;
  }
  finish(res, t0);
}
function finish(res, t0) { // a run ended: store its results, show the final values, jump to the file with the error if any
  const cover = job?.cover;
  job = null;
  setRunning(false);
  setStatus('Ready');
  if (res) { S.trace = res.files; S.tl = res.timeline; S.step = null; S.views = null; S.error = res.error; }
  if (cover && res?.cover) { S.cover = res.cover.files; out('\n' + res.cover.report + '\n'); }
  out(`\n[${res?.gui ? 'script finished, window still open (close it or press Run to end it)' : 'finished'} in ${Math.round(performance.now() - t0)} ms]\n`, 'dim');
  drainOut(); // a run has ended: whatever it printed is on the console now, not up to 30 ms later
  showIdle(); // ... and the >>> prompt is open on what it left behind
  const e = S.error;
  if (e && e.file !== S.active && S.files[e.file]) openFile(e.file); else { draw(); showMarks(); updateStepper(); }
  if (e && e.file === S.active) cm.scrollIntoView({ line: e.line - 1, ch: 0 }, 120);
}
function stop() { // kill the worker (the only way to interrupt Python), close any GUI windows and restart Python in the background
  if (!job) return;
  job = null;
  more = '';
  hideLine();
  PyLibs.closeViews();
  W.restart();
  out('\n■ stopped\n', 'dim');
  drainOut();
  setRunning(false);
  setStatus('Restarting Python…');
  W.ready.then(() => { setStatus('Ready'); refresh(); showIdle(); });
}
$('#run').onclick = () => run();
$('#cov').onclick = () => run('run', true);
// Grade (pynodesettings.py: `# grade tests.py`): run the student's file as a module, then that file's tests, and print the score
$('#grade').onclick = () => {
  const grade = cfg().grade || (GRADER in S.files ? GRADER : null);
  if (!grade) {
    clearOut();
    out('Nothing to grade yet: make a file named gradeuser.py (it starts as a grading template), or add a line\n# grade <file>\nto pynodesettings.py.\n', 'dim');
    return drainOut();
  }
  // the student's file: the open one if it is a student's .py file, else the first such file
  const main = isPy(S.active) && !isLocked(S.active) && ![SETTINGS, GRADER, 'education.py', grade].includes(S.active) ? S.active : studentFile();
  run('grade', false, { main: main || grade, grade, verbose: cfg().verbose });
};
$('#edu').onclick = () => openGuide('educators');
for (const m of PyLibs.modes()) { // the extra run buttons that libraries add (Doctest, Tests ...)
  const b = Object.assign(document.createElement('button'), { className: 'pri runmode', textContent: m.label, title: m.title, disabled: true });
  b.onclick = () => run(m.id);
  $('#modes').append(b);
}
$('#stop').onclick = stop;

// a tkinter window keeps running after the script returned; its callbacks update the node map's values
let liveT = 0;
function liveTrace(files) {
  if (job || !S.ranFiles) return;
  for (const [n, t] of Object.entries(files)) if (S.ranFiles[n] === S.files[n]) S.trace[n] = t;
  clearTimeout(liveT);
  liveT = setTimeout(() => { if (S.step == null) draw(); }, 120);
}
// A window event made while a run is executing goes into the mailbox (the program reads it at its next update()); at any other
// time it goes straight to the worker, which handles it between runs.
PyLibs.views().forEach(l => l.view.setSend(ev => {
  const sw = pyBusy && navigator.serviceWorker?.controller;
  if (sw) sw.postMessage({ lib: l.name, ev });
  else W.w.postMessage({ type: 'guievent', lib: l.name, ev });
}));

// ---- import / export / share
// Confirm a click for a moment: the button shows `text` and turns green, then goes back (a second click just restarts the timer)
const flash = (btn, text, ms = 1800) => {
  btn.dataset.label ||= btn.textContent.trim();
  clearTimeout(btn._flash);
  btn.textContent = text;
  btn.classList.add('done');
  btn._flash = setTimeout(() => { btn.textContent = btn.dataset.label; btn.classList.remove('done'); }, ms);
};
const download = (blob, name) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
};
const isFile = n => /\.(py|txt)$/i.test(n); // the kinds of file a project holds
const safeName = p => { // a file name from a path: spaces and odd characters become _, a .py can't start with a digit
  const base = p.split(/[\\/]/).pop(), txt = /\.txt$/i.test(base);
  const n = base.replace(/\.(py|txt)$/i, '').replace(txt ? /[^\w-]/g : /\W/g, '_') || 'file';
  return txt ? n + '.txt' : (/^\d/.test(n) ? '_' : '') + n + '.py';
};
function mergeFiles(got) { // adds the given files to the project, replacing those with the same name (but never a protected one)
  const names = Object.keys(got).filter(n => !isProtected(n));
  if (!names.length) return;
  names.forEach(n => { S.files[n] = got[n]; docs[n]?.setValue(got[n]); delete S.trace[n]; });
  S.tl = null; S.step = null; S.error = null; S.cover = null;
  applySettings();
  const first = names.find(n => isPy(n) && !isLocked(n)) ?? names.find(n => !isLocked(n));
  if (first) openFile(first); else chrome();
}
function replaceProject(got) { // a zip or a share link is a whole project: everything already in the explorer is removed
  if (job) stop();
  const names = Object.keys(got).sort();
  stopPlay();
  PyLibs.closeViews();
  W.w?.postMessage({ type: 'guireset' }); // a window left open by the old project would keep running (no worker yet on a first visit)
  S.files = { ...got };
  for (const n of Object.keys(docs)) delete docs[n];
  Object.assign(S, { trace: {}, graph: {}, key: {}, err: {}, hints: {}, fold: {}, tl: null, step: null, views: null, error: null, cover: null, ranFiles: null });
  S.unlocked = new Set(); // a different project: its locked files are locked again
  // open main.py if there is one, else a .py file (not the teacher's settings), else anything that may be opened
  let first = [...(names.includes('main.py') ? ['main.py'] : []), ...names.filter(n => isPy(n) && n !== SETTINGS), ...names].find(n => !isLocked(n));
  if (!first) { S.files['untitled.py'] = ''; first = 'untitled.py'; } // nothing but locked files
  S.open = [first];
  openFile(first);
  applySettings();
}
// What an import (files, a zip or a share link) would do, in a dialog: each file it brings and what happens to it, then the choice of
// replacing the whole project or adding these files to it. Resolves 'replace', 'add' or null (cancelled). With nothing to import it just
// shows `note`.
function askImport(got, how, note = '') {
  const dlg = $('#imp-dlg'), names = Object.keys(got).sort(), mine = Object.keys(S.files).filter(n => !isHidden(n));
  $('#imp-title').textContent = !names.length ? 'Nothing to import' : how === 'link' ? 'Open a shared project' : how === 'sample' ? 'Reset to the sample project'
    : `Import ${names.length} file${names.length === 1 ? '' : 's'}`;
  $('#imp-list').innerHTML = names.map(n => {
    const what = isHidden(n) ? 'kept as it is (hidden)' : !(n in S.files) ? 'new' : S.files[n] === got[n] ? 'same as yours' : isProtected(n) ? 'yours is kept (protected)' : 'replaces yours';
    return `<li><span>${n}</span><i>${what}</i></li>`;
  }).join('');
  const gone = mine.filter(n => !(n in got));
  $('#imp-note').textContent = note || (gone.length ? `Replace removes ${gone.length > 8 ? gone.slice(0, 8).join(', ') + ', …' : gone.join(', ')}. Add keeps them.` : '');
  $('#imp-add').hidden = $('#imp-replace').hidden = !names.length;
  $('#imp-cancel').textContent = names.length ? 'Cancel' : 'OK';
  const def = how === 'files' ? $('#imp-add') : $('#imp-replace'); // loose files usually join the project; a zip or a link is one
  $('#imp-add').classList.toggle('pri', def === $('#imp-add'));
  $('#imp-replace').classList.toggle('pri', def === $('#imp-replace'));
  dlg.returnValue = '';
  return new Promise(resolve => {
    dlg.onclose = () => resolve(['replace', 'add'].includes(dlg.returnValue) ? dlg.returnValue : null);
    dlg.showModal();
    (names.length ? def : $('#imp-cancel')).focus();
  });
}
async function bringIn(got, how) {
  const choice = await askImport(got, how);
  if (choice === 'replace') replaceProject(got);
  else if (choice === 'add') mergeFiles(got);
}
async function importFiles(list) { // .py / .txt files, or .zip files of them: the dialog asks whether they replace the project or join it
  const got = {};
  let zipped = false;
  for (const f of list) {
    if (/\.zip$/i.test(f.name)) {
      zipped = true;
      const z = await JSZip.loadAsync(f);
      for (const e of Object.values(z.files)) {
        if (!e.dir && isFile(e.name) && !/(^|\/)__MACOSX\//.test(e.name)) got[safeName(e.name)] = await e.async('string');
      }
    } else if (isFile(f.name)) got[safeName(f.name)] = await f.text();
  }
  if (!Object.keys(got).length) return askImport({}, 'files', 'There are no .py or .txt files in that.');
  return bringIn(got, zipped ? 'zip' : 'files');
}
$('#imp').onclick = () => $('#pick').click();
// Reset to sample (status bar): the project a new visitor starts with, through the same dialog (Replace, or Add the sample's files to
// yours). For anyone whose saved project dates from before the sample changed.
$('#reset').onclick = () => bringIn(STARTER, 'sample');
$('#pick').onchange = async e => { await importFiles([...e.target.files]); e.target.value = ''; };
$('#exp').onclick = async () => { // a zip with every file and, for each .py, a PNG of its node map (with the values of the last run)
  setStatus('Exporting…');
  const zip = new JSZip(), left = [];
  for (const [name, src] of Object.entries(S.files)) {
    if (isLocked(name) && !teacher()) { left.push(name); continue; } // a locked file is not handed out (unless you are the teacher)
    zip.file(name, src);
    if (!isPy(name) || isLocked(name)) continue;
    try {
      const g = JSON.parse(await W.call('analyze', { src, mods: modsOf() }));
      if (!g.error) zip.file(name.replace(/\.py$/, '') + '_nodemap.png', await NodeMap.png(g, S.trace[name], { light: P.light }));
    } catch {}
  }
  download(await zip.generateAsync({ type: 'blob' }), 'python_project.zip');
  setStatus(left.length ? `Exported (locked files left out: ${left.join(', ')})` : 'Ready');
};

// A share link is the project, deflated + base64url, in the #fragment (never sent to a server): '#p=' + 'z' + data, or
// 'r' + data when the browser has no CompressionStream (then it is just base64url of the JSON).
const b64u = u8 => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const pipe = async (bytes, Stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'))).arrayBuffer());
async function pack(files) {
  const raw = new TextEncoder().encode(JSON.stringify(files));
  return window.CompressionStream ? 'z' + b64u(await pipe(raw, CompressionStream)) : 'r' + b64u(raw);
}
async function unpack(s) {
  const raw = unb64u(s.slice(1));
  return JSON.parse(new TextDecoder().decode(s[0] === 'z' ? await pipe(raw, DecompressionStream) : raw));
}
$('#share').onclick = async () => {
  // Locked files are included on purpose: a share link is how an assignment with hidden tests is sent out. The `# pynodemap lock` line
  // travels inside the file, so whoever opens the link finds the file locked again.
  const url = location.href.split('#')[0] + '#p=' + await pack(S.files);
  try { await navigator.clipboard.writeText(url); setStatus(`Link copied (${url.length.toLocaleString()} characters)`); flash($('#share'), '✓ Link copied'); }
  catch { prompt('Copy this link:', url); }
  if (url.length > 8000) alert('This link is very long and some chat apps may cut it off. Use Export to send a zip instead.');
  else if (location.protocol === 'file:') alert('This page is opened from a file, so the link only works on this computer. Once it is hosted (GitHub Pages) the link works for everyone.');
};
async function loadShared() { // open a #p= share link (validated: file names, sizes) after asking; it replaces the whole project
  const m = /^#p=(.+)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.href.split('#')[0]);
  let files;
  try { files = await unpack(m[1]); } catch { return askImport({}, 'link', "That share link couldn't be read (it may have been cut off)."); }
  const names = Object.keys(files || {});
  if (!names.length || names.length > 50 || !names.every(n => okName(n) && typeof files[n] === 'string' && files[n].length < 500000)) {
    return askImport({}, 'link', "That share link doesn't contain a valid project.");
  }
  return bringIn(files, 'link');
}
addEventListener('hashchange', loadShared);

// ---- pop the node map out into a window of its own. Where the browser has Document Picture-in-Picture (Chrome, Edge) it floats above
// every other window, like a video; elsewhere it is an ordinary popup. The panel itself moves there (its buttons keep working, and `$`
// looks in that window too); closing the window, or ⤓ in it, puts it back.
function syncPip() { // the popped-out map follows the theme and font size
  if (!pipWin) return;
  pipWin.document.body.className = document.body.className + ' pip';
  pipWin.document.body.style.cssText = document.body.style.cssText;
}
async function popMap() {
  if (pipWin) return pipWin.close();
  let w = null;
  try { w = await window.documentPictureInPicture?.requestWindow({ width: 720, height: 560 }); } catch {} // (refused: try a popup)
  w ||= open('', 'pynodemap-map', 'popup,width=760,height=600');
  if (!w) return setStatus("The node map couldn't be popped out: the browser blocked the window.");
  const d = w.document, panel = $('#mapp');
  d.title = 'Node map · Python Nodemap';
  document.querySelectorAll('link[rel="stylesheet"], style').forEach(n => d.head.append(n.cloneNode(true)));
  pipWin = w;
  syncPip();
  d.body.append(panel);
  $('#vsplit').hidden = true;
  $('#pop').textContent = '⤓';
  $('#pop').title = 'Put the node map back in the page';
  w.addEventListener('pagehide', unpopMap);
  w.addEventListener('resize', applyZoom);
  cm.refresh();
  applyZoom();
}
function unpopMap() {
  if (!pipWin) return;
  const panel = pipWin.document.querySelector('#mapp');
  pipWin = null;
  $('#vsplit').after(panel);
  $('#vsplit').hidden = false;
  $('#pop').textContent = '⧉';
  $('#pop').title = 'Pop the node map out into its own window (it stays on top of other windows where the browser allows)';
  cm.refresh();
  applyZoom();
}
$('#pop').onclick = popMap;
addEventListener('pagehide', () => pipWin?.close());

// apply pynodesettings.py: hidden files leave the tabs, read-only ones can't be typed in, the Grade button appears
function applySettings() {
  S.open = S.open.filter(n => n in S.files && !isLocked(n));
  if (!S.open.length) S.open = [firstOpenable() || S.active];
  if (isLocked(S.active)) return openFile(S.open[0]);
  cm.setOption('readOnly', isReadOnly(S.active));
  chrome();
}

// ---- the Tutorial (everyone) and the Educator guide (shown while pynodesettings.py is open): pages in tutorial/, in a frame that
// follows the theme
function openGuide(which) {
  const url = `tutorial/${which}.html?theme=${P.light ? 'light' : 'dark'}`;
  $('#g-title').textContent = which === 'educators' ? 'Python Nodemap for educators' : 'How Python Nodemap works';
  $('#g-frame').src = url;
  $('#g-tab').href = url;
  $('#guide').showModal();
}
$('#tut').onclick = () => openGuide('tutorial');
$('#g-x').onclick = () => $('#guide').close();

// ---- resizable panels
// make a splitter bar draggable: fn(pointermove) sets the CSS variable that sizes the panel
const drag = (el, fn) => el.addEventListener('pointerdown', e => {
  el.setPointerCapture(e.pointerId);
  const up = () => { el.removeEventListener('pointermove', fn); el.removeEventListener('pointerup', up); cm.refresh(); applyZoom(); };
  el.addEventListener('pointermove', fn);
  el.addEventListener('pointerup', up);
});
drag($('#vsplit'), e => document.body.style.setProperty('--map-w', Math.max(240, innerWidth - e.clientX) + 'px'));
drag($('#hsplit'), e => document.body.style.setProperty('--con-h', Math.max(60, innerHeight - 22 - e.clientY) + 'px'));

// ---- go
$('#libs').textContent = 'Python · ' + PyLibs.names().join(', ');
cm.swapDoc(docOf(S.active));
cm.setOption('readOnly', isReadOnly(S.active));
chrome();
applyPrefs();
const setProgress = (pct, text) => {
  if ($('#pbar')) { $('#pbar').style.width = pct + '%'; $('#ptext').textContent = `${text} ${pct < 100 ? pct + '%' : ''}`; }
  setStatus(`Loading Python… ${pct}%`);
};
W.onProgress = (loaded, total) => { // download = 0-95%, then Pyodide starting up
  if (ready) return;
  setProgress(Math.min(95, Math.round((loaded / total) * 95)), loaded >= total ? 'Starting Python…' : 'Downloading Python…');
};
W.start();
W.ready.then(() => {
  ready = true;
  setProgress(100, 'Analyzing your code…');
  setRunning(false);
  setStatus('Ready');
  refresh();
  showIdle(false);
}, e => {
  setStatus('Python failed to load');
  const disk = location.protocol === 'file:';
  $('#map').innerHTML = `<div class="empty">${disk ? 'This page has to be served, not opened from disk (see the console).' : 'Could not load Python. Check your connection and reload.'}</div>`;
  out(`Could not load Python: ${e.message || e}\n`, 'err');
  out(disk ? 'You opened this page straight from disk, which the browser blocks. Serve the folder instead: run "python -m http.server" in it and open http://localhost:8000/ (see the README).\n'
    : 'This page needs internet access to cdn.jsdelivr.net (Pyodide) and cdnjs.cloudflare.com (editor, zip).\n', 'err');
});
loadShared();
