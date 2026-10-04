/* Autocomplete for the editor: keywords, built-ins, the four allowed modules, your other files, and names already in the code. */
const PyComplete = (() => {
  const w = s => s.split(' ');
  const KW = w('False None True and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield');
  const BUILTIN = w('abs all any bin bool chr dict divmod enumerate filter float format hex id input int isinstance iter len list map max min next object oct open ord pow print range repr reversed round set sorted str sum super tuple type zip Exception ValueError TypeError KeyError IndexError ZeroDivisionError NameError AttributeError StopIteration RuntimeError');
  const METHODS = w('append extend insert remove pop clear sort reverse index count join split strip lstrip rstrip replace upper lower title capitalize format startswith endswith find isdigit isalpha isupper islower keys values items get update copy add discard union intersection difference '
    + 'assertEqual assertNotEqual assertTrue assertFalse assertIs assertIsNot assertIsNone assertIsNotNone assertIn assertNotIn assertIsInstance assertRaises assertAlmostEqual assertGreater assertLess assertGreaterEqual assertLessEqual assertCountEqual assertRegex setUp tearDown setUpClass tearDownClass subTest fail skipTest '
    + 'pack grid place config configure bind bind_all after after_cancel destroy mainloop quit title geometry resizable protocol focus_set update update_idletasks winfo_width winfo_height columnconfigure rowconfigure pack_forget grid_forget '
    + 'create_line create_rectangle create_oval create_text create_polygon create_arc coords move itemconfig delete find_overlapping tag_bind add_command add_cascade add_separator invoke select deselect curselection selection_set');
  const MOD = {
    random: w('random randint randrange choice choices sample shuffle uniform gauss seed getrandbits triangular normalvariate expovariate'),
    math: w('pi e tau inf nan sqrt pow exp log log2 log10 sin cos tan asin acos atan atan2 sinh cosh tanh floor ceil trunc fabs factorial gcd lcm comb perm hypot isclose isnan isinf degrees radians fsum prod dist copysign fmod modf'),
    time: w('time sleep perf_counter monotonic process_time time_ns strftime localtime gmtime ctime asctime mktime'),
    doctest: w('testmod testfile run_docstring_examples ELLIPSIS NORMALIZE_WHITESPACE IGNORE_EXCEPTION_DETAIL DocTestSuite'),
    enum: w('Enum IntEnum Flag IntFlag StrEnum auto unique'),
    unittest: w('TestCase main TestSuite TextTestRunner TestLoader defaultTestLoader skip skipIf skipUnless expectedFailure mock'),
    tkinter: w('Tk Toplevel Frame LabelFrame Label Message Button Entry Text Checkbutton Radiobutton Scale Spinbox Listbox Canvas Scrollbar Menu OptionMenu StringVar IntVar DoubleVar BooleanVar mainloop messagebox simpledialog ttk font TclError Event '
      + 'END INSERT LEFT RIGHT TOP BOTTOM BOTH X Y N S E W NW NE SW SE NS EW NSEW CENTER NORMAL DISABLED ACTIVE READONLY HORIZONTAL VERTICAL RAISED SUNKEN FLAT GROOVE RIDGE SOLID WORD CHAR NONE YES NO ANCHOR ALL SINGLE BROWSE MULTIPLE EXTENDED'),
    messagebox: w('showinfo showwarning showerror askquestion askokcancel askyesno askyesnocancel askretrycancel'),
    simpledialog: w('askstring askinteger askfloat'),
    ttk: w('Button Label Entry Frame LabelFrame Checkbutton Radiobutton Scale Spinbox Combobox Progressbar Separator Style'),
    font: w('Font families'),
  };
  const IMPORTABLE = w('random math time doctest tkinter unittest enum');
  const top = src => [...src.matchAll(/^(?:def|class)\s+(\w+)|^(\w+)\s*=(?!=)/gm)].map(m => m[1] || m[2]);
  const methodsOf = src => [...src.matchAll(/^\s+def\s+(\w+)\s*\(\s*self/gm)].map(m => m[1]);

  /** CodeMirror hint function. files = { 'name.py': source } */
  function hint(cm, files) {
    const cur = cm.getCursor(), line = cm.getLine(cur.line).slice(0, cur.ch);
    const proj = Object.fromEntries(Object.entries(files).map(([n, s]) => [n.replace(/\.py$/, ''), s]));
    const alias = {};
    for (const a of cm.getValue().matchAll(/^\s*(?:import\s+([\w.]+)\s+as\s+(\w+)|from\s+tkinter\s+import\s+(\w+)\s+as\s+(\w+))/gm)) {
      if (a[1]) alias[a[2]] = a[1].split('.').pop(); else alias[a[4]] = a[3]; // import tkinter as tk / from tkinter import ttk as t
    }
    const members = m => MOD[alias[m] || m] || (proj[m] ? top(proj[m]) : null);
    let m, prefix, list;
    if ((m = /^\s*from\s+(\w+)\s+import\s+(?:\w+\s*,\s*)*(\w*)$/.exec(line))) { prefix = m[2]; list = members(m[1]) || []; }
    else if ((m = /^\s*(?:from|import)\s+(\w*)$/.exec(line))) { prefix = m[1]; list = [...IMPORTABLE, ...Object.keys(proj)]; }
    else if ((m = /([A-Za-z_]\w*)\.(\w*)$/.exec(line))) { prefix = m[2]; list = members(m[1]) || [...Object.values(proj).flatMap(methodsOf), ...METHODS]; }
    else if ((m = /[A-Za-z_]\w*$/.exec(line))) {
      prefix = m[0];
      list = [...KW, ...BUILTIN, ...IMPORTABLE, ...Object.keys(alias), ...(cm.getValue().match(/[A-Za-z_]\w*/g) || []), ...Object.values(proj).flatMap(top)];
    } else return null;
    const p = prefix.toLowerCase();
    const out = [...new Set(list)].filter(x => x.toLowerCase().startsWith(p) && x !== prefix).sort((a, b) => a.localeCompare(b)).slice(0, 40);
    return out.length ? { list: out, from: CodeMirror.Pos(cur.line, cur.ch - prefix.length), to: cur } : null;
  }

  return { hint };
})();
