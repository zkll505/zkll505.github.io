"""Backend self-check: runner.py plus every library, loaded the way the page loads them. Run: python tests/test_backend.py

No dependencies and no browser: it imports runner.py, registers the libraries listed in index.html, and drives analyze() / run()
and the GUI hooks directly, the same calls the worker makes. Each check below is a plain function full of asserts; the file
ends by calling them all and printing "ok". To add one, write a function that runs a small student program with
runner.run(json.dumps({"main.py": SOURCE}), "main.py") and asserts on the output, the returned JSON, or (for GUI libraries) the
frames collected in POSTS, then call it from the bottom of the file. What this does not cover is drawing and layout in the page;
for that, try the change in a browser (docs/ARCHITECTURE.md lists what is easy to break)."""
import contextlib, importlib.util, io, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("runner", ROOT / "runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

# same libraries, same order as the <script> tags in index.html
dirs = re.findall(r"libs/(\w+)/lib\.js", (ROOT / "index.html").read_text(encoding="utf-8"))
names = [n for d in dirs for n in re.findall(r"name: '(\w+)'", (ROOT / "libs" / d / "lib.js").read_text(encoding="utf-8"))]
runner.configure(json.dumps(names))
for d in dirs:
    if (ROOT / "libs" / d / "lib.py").exists():
        runner.load_lib(d, (ROOT / "libs" / d / "lib.py").read_text(encoding="utf-8"))
POSTS = []  # the GUI frames (widget trees) the page would receive while a script is running
runner.GUI["tkinter"]["set_post"](lambda s: POSTS.append(json.loads(s)))

# the program most checks run: a function with a doctest, a class, loops, if/elif/else and an import of a second file (HELPERS)
SRC = '''import math
from helpers import twice

def add(a, b):
    """>>> add(1, 2)
    3
    """
    return a + b

class Dog:
    def __init__(self, name):
        self.name = name
        self.tricks = []

    def learn(self, t):
        self.tricks.append(t)

    def show(self):
        return self.name + str(len(self.tricks))

total = 0
for i in range(3):
    total = add(total, i)
rex = Dog("Rex")
rex.learn("sit")
n = 3
while n > 0:
    print(n)
    n -= 1
if total > 99:
    print("big")
elif total > 1:
    print(twice(total), rex.show(), math.sqrt(4))
else:
    print("small")
'''
HELPERS = "def twice(x):\n    return x * 2\n"


def analyze():
    """Static analysis: data, call, two-way and loop-carried wires; methods and self.attributes; elif as a sibling; syntax errors."""
    g = json.loads(runner.analyze(SRC))
    N, text = g["nodes"], lambda s: next(n["id"] for n in g["nodes"] if n["text"].startswith(s))
    W = lambda a, b, kind, label=None: [w for w in g["wires"] if (w["from"], w["to"], w["kind"]) == (text(a), text(b), kind) and label in (None, w["label"])]
    selfw = W("total = add", "total = add", "data", "total")
    assert len(selfw) == 1 and selfw[0]["back"], "in a loop, an accumulator feeds itself on the next repeat (a loop-carried wire from the box to itself)"
    assert not [w for w in json.loads(runner.analyze("x = 1\nx = x + 1\nprint(x)\n"))["wires"] if w["from"] == w["to"]], "no self wire outside a loop"
    wl = json.loads(runner.analyze("n = 3\nwhile n > 0:\n    n -= 1\n"))
    assert any(w["from"] == w["to"] and w["back"] and w["label"] == "n" for w in wl["wires"]), "n -= 1 loops back into itself"
    nested = json.loads(runner.analyze("i = 0\nwhile i < 3:\n    for j in range(2):\n        print(i, j)\n    i += 1\n"))
    texts = {n["id"]: n["text"] for n in nested["nodes"]}
    assert any(w["back"] and texts[w["from"]] == "i += 1" and texts[w["to"]] == "print(i, j)" for w in nested["wires"]), "a value changed by the OUTER loop reaches the inner loop"
    assert W("total = 0", "for i", "data") == [] and W("total = 0", "total = add", "data", "total")
    assert W("for i", "total = add", "data", "i")                       # loop var flows into body
    w = W("total = add", "def add", "call")[0]
    assert w["two"], "call to function with return value is two-way"
    assert W("rex = Dog", "def __init__", "call")                      # class call -> __init__
    assert W("rex.learn", "def learn", "call")                         # method call
    assert W("self.name = name", "return self.name", "data", "self.name")   # attribute flows across methods
    assert W("self.tricks.append", "return self.name", "data", "self.tricks")
    assert any(w["back"] for w in g["wires"] if w["label"] == "n" and w["to"] == text("print(n)"))   # loop-carried
    assert text("elif") and next(n for n in N if n["text"].startswith("elif"))["parent"] is None   # elif = sibling
    assert "error" in json.loads(runner.analyze("def f(:\n"))


def execute():
    """Running: output, values per line, parameters / call counts / returns, `global`, the import guard, the infinite-loop cutoff, tracebacks, doctest mode."""
    files = json.dumps({"main.py": SRC, "helpers.py": HELPERS})
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        t = json.loads(runner.run(files, "main.py"))["files"]
    assert out.getvalue() == "3\n2\n1\n6 Rex1 2.0\n", out.getvalue()
    m = t["main.py"]
    ln = lambda s: next(i for i, l in enumerate(SRC.splitlines(), 1) if s in l)
    assert m["vals"][str(ln("total = add"))] == {"total": "3"}
    assert m["vals"][str(ln("rex = Dog"))] == {"rex": "Dog(name='Rex', tricks=[])"}   # snapshot right after that line ran
    assert m["params"][str(ln("def add"))] == {"a": "1", "b": "2"} and m["calls"][str(ln("def add"))] == 3
    assert m["hits"].get(str(ln('print("big")'))) is None, "unreached line has no hits"
    assert t["helpers.py"]["rets"]["1"] == "6"

    g = json.loads(runner.run(json.dumps({"g.py": "n = 0\ndef f():\n    global n\n    n += 1\nf()\n"}), "g.py"))["files"]["g.py"]
    assert g["vals"]["4"] == {"n": "1"}, "global assigned inside a function"

    for bad in ("import os\n", "x = __import__('os')\n"):
        with contextlib.redirect_stderr(io.StringIO()) as e:
            runner.run(json.dumps({"a.py": bad}), "a.py")
        assert "isn't available" in e.getvalue(), e.getvalue()
    with contextlib.redirect_stderr(io.StringIO()) as e:
        runner.run(json.dumps({"a.py": "while True:\n    pass\n"}), "a.py")
    assert "infinite loop" in e.getvalue()
    with contextlib.redirect_stderr(io.StringIO()) as e:
        runner.run(json.dumps({"a.py": "x = 1\nprint(1 / 0)\n"}), "a.py")
    assert e.getvalue().startswith("Traceback") and 'File "a.py", line 2' in e.getvalue(), e.getvalue()

    with contextlib.redirect_stdout(io.StringIO()) as o:
        runner.run(json.dumps({"main.py": SRC, "helpers.py": HELPERS}), "main.py", "doctest")
    assert "doctest: 1 run, 0 failed" in o.getvalue(), o.getvalue()
    with contextlib.redirect_stdout(io.StringIO()) as o:
        runner.run(json.dumps({"m.py": 'def f():\n    """>>> f()\n    2\n    """\n    return 1\n'}), "m.py", "doctest")
    assert "1 failed" in o.getvalue()


def hints():
    """Beginner hints (unavailable import, shared default, unused or unassigned names, missing return, shadowed built-ins ...); a clean program has none."""
    src = ("import os\nimport math\ndef f(a, items=[]):\n    unused = 1\n    return a\n    print('x')\n"
           "def g():\n    pass\nx = g()\nlist = [1]\nx == 3\nprint(y)\ny = 2\nf\nfor i in range(3):\n    t = t + i\n")
    h = json.loads(runner.analyze(src))["hints"]
    by = {x["line"]: x["msg"] for x in h}
    assert by[1].startswith("'os' isn't available") and 2 not in by
    assert "shared by every call" in by[3]
    assert "never used" in by[4] and "can never run" in by[6]
    assert "no return statement" in by[9] and "built-in" in by[10] and "comparison" in by[11]
    assert "before it has been given a value" in by[12] and "does nothing" in by[14]
    assert "before it has been given a value" in by[16]
    ok = json.loads(runner.analyze(SRC, json.dumps(["helpers"])))["hints"]
    assert ok == [], ok  # the starter-style program is clean
    assert json.loads(runner.analyze("def f(:\n"))["line"] == 1


def timeline():
    """The step timeline: its length matches the hit counts, and replaying every fact reproduces the final values."""
    files = json.dumps({"main.py": SRC, "helpers.py": HELPERS})
    with contextlib.redirect_stdout(io.StringIO()):
        res = json.loads(runner.run(files, "main.py"))
    tl, agg = res["timeline"], res["files"]
    assert tl["files"] == ["main.py", "helpers.py"] and not tl["trunc"]
    n = len(tl["steps"]) // 2
    assert n == sum(sum(f["hits"].values()) for f in agg.values())
    last = {}  # replaying every fact gives the same final values as the aggregate
    for idx, f, kind, line, data in tl["facts"]:
        assert 0 <= idx <= n
        if kind == "v":
            last.setdefault((tl["files"][f], str(line)), {}).update(data)
    for (name, line), vals in last.items():
        assert agg[name]["vals"][line] == vals
    assert any(k == "p" for _, _, k, _, _ in tl["facts"]) and any(k == "r" for _, _, k, _, _ in tl["facts"])


def input_and_errors():
    """input() asks, then the re-run replays the answers with the same random seed; error locations; the output cap."""
    prog = json.dumps({"a.py": 'import random\nn = input("Name? ")\nprint("hi", n, random.randint(1, 10**9))\n'})
    with contextlib.redirect_stdout(io.StringIO()) as o:
        r = json.loads(runner.run(prog, "a.py", "run", "[]", 7))
    assert r["need_input"] and o.getvalue() == "Name? ", o.getvalue()
    outs = []
    for _ in range(2):  # same seed + same answers -> identical output
        with contextlib.redirect_stdout(io.StringIO()) as o:
            r = json.loads(runner.run(prog, "a.py", "run", '["Bo"]', 7))
        outs.append(o.getvalue())
    assert not r["need_input"] and outs[0] == outs[1] and outs[0].startswith("Name? Bo\nhi Bo "), outs
    with contextlib.redirect_stderr(io.StringIO()):
        e = json.loads(runner.run(json.dumps({"a.py": "x = 1\ndef f():\n    return 1 / 0\nf()\n"}), "a.py"))["error"]
        assert (e["file"], e["line"]) == ("a.py", 3) and "ZeroDivisionError" in e["msg"], e
        e = json.loads(runner.run(json.dumps({"a.py": "x = (\n"}), "a.py"))["error"]
        assert e["file"] == "a.py" and "SyntaxError" in e["msg"], e
        e = json.loads(runner.run(json.dumps({"a.py": "while True:\n    pass\n"}), "a.py"))["error"]
        assert e["line"] in (1, 2) and "infinite loop" in e["msg"], e   # the line it was on when cut off
    runner.OUTLIM = 50
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as se:
        runner.run(json.dumps({"a.py": "while True:\n    print('spam spam spam')\n"}), "a.py")
    assert "characters of output" in se.getvalue()
    runner.OUTLIM = 400_000


TKAPP = '''import tkinter as tk
from tkinter import messagebox

clicks = tk.IntVar(value=0)

def bump():
    clicks.set(clicks.get() + 1)
    status.config(text="clicked %d" % clicks.get())
    print("entry says", entry.get())

def on_key(event):
    print("key", event.keysym)

root = tk.Tk()
root.title("Demo")
root.geometry("300x200")
status = tk.Label(root, text="ready", bg="gray50")
status.pack(side=tk.TOP, fill=tk.X, padx=(5, 7))
frame = tk.Frame(root)
frame.pack(fill=tk.BOTH, expand=True)
entry = tk.Entry(frame, width=12)
entry.grid(row=0, column=0, sticky="ew")
btn = tk.Button(frame, text="Click me", command=bump)
btn.grid(row=0, column=1)
frame.columnconfigure(0, weight=1)
canvas = tk.Canvas(root, width=100, height=50)
canvas.pack()
oval = canvas.create_oval(10, 10, 30, 30, fill="red")
root.bind("<Key>", on_key)
root.after(5, lambda: print("timer fired"))
messagebox.showinfo("Hi", "there")
root.mainloop()
print("after mainloop")
'''

TKWIDGETS = '''import tkinter as tk
root = tk.Tk()
t = tk.Text(root); t.pack()
t.insert(tk.END, "hello\\nworld")
v = tk.BooleanVar(); cb = tk.Checkbutton(root, text="x", variable=v); cb.pack()
sv = tk.StringVar(value="b"); r1 = tk.Radiobutton(root, text="a", variable=sv, value="a"); r1.pack()
lb = tk.Listbox(root); lb.pack(); lb.insert(tk.END, "one", "two", "three")
sc = tk.Scale(root, from_=0, to=10); sc.pack()
def show():
    print(repr(t.get("1.0", tk.END)), v.get(), sv.get(), lb.curselection(), sc.get())
def boom():
    1 / 0
tk.Button(root, text="show", command=show).pack()
tk.Button(root, text="boom", command=boom).pack()
root.mainloop()
'''


def _walk(node):
    yield node
    for k in node.get("k", []):
        yield from _walk(k)


def tkinter_app():
    """A tkinter program end to end: the widget tree, pack/grid options, then events (typing, click, key, timer) and closing; and
    when a window stays open after the script (shown) versus is dropped (never shown)."""
    POSTS.clear()
    with contextlib.redirect_stdout(io.StringIO()) as o:
        r = json.loads(runner.run(json.dumps({"main.py": TKAPP}), "main.py"))
    assert r["gui"] and r["error"] is None, r
    assert "after mainloop" not in o.getvalue(), "code after mainloop() must not run"
    win = POSTS[-1]["wins"][0]
    assert win["t"] == "tk" and win["o"]["title"] == "Demo" and win["geom"] == "300x200", win["o"]
    label, frame, canvas = win["k"]  # in pack order
    assert label["m"]["side"] == "top" and label["m"]["fill"] == "x" and label["m"]["padx"] == [5, 7] and label["o"]["bg"] == "#808080"
    assert frame["m"]["expand"] is True and frame["cw"]["c"]["0"]["weight"] == 1
    entry, btn = frame["k"]
    assert entry["m"] == {"k": "grid", "row": 0, "column": 0, "rowspan": 1, "columnspan": 1, "sticky": "ew", "padx": [0, 0], "pady": [0, 0], "ipadx": 0, "ipady": 0}
    assert btn["m"]["column"] == 0 or btn["m"]["row"] == 0  # second grid() call reuses row 0
    assert canvas["items"][0]["t"] == "oval" and canvas["items"][0]["o"]["fill"] == "red"
    assert POSTS[-1]["dialogs"][0]["msg"] == "there" and POSTS[-1]["wants"] == ["key"]
    ev = lambda **e: json.loads(runner.gui_event("tkinter", json.dumps(e)))
    with contextlib.redirect_stdout(io.StringIO()) as o:
        ev(t="value", id=entry["id"], v="abc")
        out = ev(t="click", id=btn["id"])
        ev(t="ev", id=win["id"], k="key", keysym="a", char="a")
        t = json.loads(runner.gui_tick("tkinter"))
        import time as _t
        _t.sleep(0.02)
        runner.gui_tick("tkinter")
    assert "entry says abc" in o.getvalue() and "key a" in o.getvalue() and "timer fired" in o.getvalue(), o.getvalue()
    assert out["tree"]["wins"][0]["k"][0]["o"]["text"] == "clicked 1", "a callback's change reaches the page"
    assert out["files"]["main.py"]["vals"], "the node map gets fresh values after a callback"
    assert out["alive"] and runner._LIVE
    out = ev(t="close", id=win["id"])
    assert not out["alive"] and not runner._LIVE, "closing the window ends the program"

    POSTS.clear()  # a script that never calls mainloop() but showed a window (update()): the window stays open, like in IDLE
    with contextlib.redirect_stdout(io.StringIO()):
        r = json.loads(runner.run(json.dumps({"a.py": "import tkinter as tk\nr = tk.Tk()\ntk.Label(r, text='x').pack()\nr.update()\n"}), "a.py"))
    assert r["gui"] and len(POSTS[0]["wins"]) == 1, POSTS
    runner.gui_stop()
    POSTS.clear()  # ... but a window that was never shown (no update/mainloop) is just dropped
    with contextlib.redirect_stdout(io.StringIO()):
        r = json.loads(runner.run(json.dumps({"a.py": "import tkinter as tk\nr = tk.Tk()\ntk.Label(r, text='x').pack()\n"}), "a.py"))
    assert not r["gui"] and not POSTS, POSTS


def tkinter_widgets():
    """Each widget kind reports the user's input back to Python; an exception inside a callback is printed, not fatal."""
    POSTS.clear()
    with contextlib.redirect_stdout(io.StringIO()):
        runner.run(json.dumps({"w.py": TKWIDGETS}), "w.py")
    win = POSTS[-1]["wins"][0]
    by = {}
    for n in _walk(win):
        by.setdefault(n["t"], []).append(n)
    ev = lambda **e: json.loads(runner.gui_event("tkinter", json.dumps(e)))
    show, boom = by["button"]
    with contextlib.redirect_stdout(io.StringIO()) as o, contextlib.redirect_stderr(io.StringIO()) as se:
        ev(t="value", id=by["text"][0]["id"], v="new text")
        ev(t="check", id=by["checkbutton"][0]["id"], v=True)
        ev(t="radio", id=by["radiobutton"][0]["id"])
        ev(t="sel", id=by["listbox"][0]["id"], sel=[1])
        ev(t="value", id=by["scale"][0]["id"], v="7")
        ev(t="click", id=show["id"])
        out = ev(t="click", id=boom["id"])
        ev(t="click", id=show["id"])
    assert o.getvalue().count("'new text\\n' True a (1,) 7") == 2, o.getvalue()
    assert "Exception in Tkinter callback" in se.getvalue() and "ZeroDivisionError" in se.getvalue() and "<lib" not in se.getvalue(), se.getvalue()
    assert by["text"][0]["v"] == "hello\nworld" and by["listbox"][0]["items"] == ["one", "two", "three"]
    ev(t="close", id=win["id"])


TKCLASS = '''import tkinter as tk
from tkinter import ttk

class Counter(tk.Frame):
    def __init__(self, master):
        super().__init__(master, bg="white")
        self.n = 0
        self.label = tk.Label(self, text="0", font=("Arial", 14, "bold italic"))
        self.label.pack()
        ttk.Button(self, text="+", command=self.inc).pack()
        self.combo = ttk.Combobox(self, values=["x", "y"])
        self.combo.pack()
        self.combo.set("y")
        self.bar = ttk.Progressbar(self, maximum=10)
        self.bar.pack()

    def inc(self):
        self.n += 1
        self.label.config(text=str(self.n))
        self.bar["value"] = self.n
        print("combo:", self.combo.get(), self.combo.current())

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Class app")
        Counter(self).pack()

App().mainloop()
'''


def tkinter_classes():
    """Subclassing Frame / Tk (the usual class-based app), fonts, ttk widgets, widget options changed from a callback."""
    POSTS.clear()
    with contextlib.redirect_stdout(io.StringIO()):
        r = json.loads(runner.run(json.dumps({"c.py": TKCLASS}), "c.py"))
    assert r["gui"] and r["error"] is None, r
    win = POSTS[-1]["wins"][0]
    by = {}
    for n in _walk(win):
        by.setdefault(n["t"], []).append(n)
    assert win["o"]["title"] == "Class app" and by["frame"][0]["o"]["bg"] == "white"
    assert by["label"][0]["o"]["font"] == {"f": "Arial", "s": 14, "px": False, "b": True, "i": True, "u": False, "o": False}, by["label"][0]["o"]
    assert by["combobox"][0]["v"] == "y" and by["combobox"][0]["items"] == ["x", "y"] and by["progressbar"][0]["max"] == 10
    ev = lambda **e: json.loads(runner.gui_event("tkinter", json.dumps(e)))
    with contextlib.redirect_stdout(io.StringIO()) as o:
        out = ev(t="click", id=by["button"][0]["id"])
    assert "combo: y 1" in o.getvalue(), o.getvalue()
    n = {k["t"]: k for k in _walk(out["tree"]["wins"][0])}
    assert n["label"]["o"]["text"] == "1" and n["progressbar"]["v"] == 1
    ev(t="close", id=win["id"])


def tkinter_star_import():
    """`from tkinter import *` exports the constants and widgets like the real module (but not ttk-only names)."""
    star = ("from tkinter import *\nfrom tkinter import messagebox, ttk\nroot = Tk()\nLabel(root, text='hi').pack(side=LEFT, fill=X)\n"
            "v = StringVar(value='x')\nttk.Label(root, text=v.get()).pack()\nroot.mainloop()\n")
    POSTS.clear()
    with contextlib.redirect_stdout(io.StringIO()):
        r = json.loads(runner.run(json.dumps({"s.py": star}), "s.py"))
    assert r["gui"] and r["error"] is None, r
    labels = [n for n in _walk(POSTS[-1]["wins"][0]) if n["t"] == "label"]
    assert [n["o"]["text"] for n in labels] == ["hi", "x"]
    runner.GUI["tkinter"]["dispatch"]({"t": "close", "id": POSTS[-1]["wins"][0]["id"]})
    # the real module doesn't hand out ttk-only names or submodules through *
    bad = "from tkinter import *\nprint(Combobox)\n"
    with contextlib.redirect_stderr(io.StringIO()) as se:
        runner.run(json.dumps({"b.py": bad}), "b.py")
    assert "NameError" in se.getvalue(), se.getvalue()


def enum_and_unittest():
    """`enum` works, and the unittest report (plain Run and the Tests button) goes to stdout with the temp folder scrubbed out."""
    enum_src = ("from enum import Enum, auto\nclass Color(Enum):\n    RED = 1\n    GREEN = auto()\n"
                "c = Color.GREEN\nprint(c, c.value, Color(1).name, [x.name for x in Color])\n")
    with contextlib.redirect_stdout(io.StringIO()) as o:
        r = json.loads(runner.run(json.dumps({"e.py": enum_src}), "e.py"))
    assert o.getvalue() == "Color.GREEN 2 RED ['RED', 'GREEN']\n" and r["error"] is None, (o.getvalue(), r["error"])
    assert "<Color.GREEN: 2>" in json.dumps(r["files"]["e.py"]["vals"])
    ut = ("import unittest\n\ndef add(a, b):\n    return a + b\n\nclass T(unittest.TestCase):\n    def test_ok(self):\n"
          "        self.assertEqual(add(1, 2), 3)\n    def test_bad(self):\n        self.assertEqual(add(1, 2), 4)\n\n"
          "if __name__ == '__main__':\n    unittest.main()\n")
    for mode in ("run", "unittest"):
        with contextlib.redirect_stdout(io.StringIO()) as o, contextlib.redirect_stderr(io.StringIO()) as se:
            r = json.loads(runner.run(json.dumps({"t.py": ut}), "t.py", mode))
        out = o.getvalue()
        assert "FAILED (failures=1)" in out and "Ran 2 tests" in out and (mode == "run" or "... ok" in out), (mode, out)  # the Tests button is verbose
        assert 'File "t.py"' in out and "tmp" not in out.lower().replace("attempt", ""), out  # temp folder scrubbed
        assert se.getvalue() == "", se.getvalue()  # nothing red: unittest's report goes to stdout


TURTLE = '''import turtle
t = turtle.Turtle()
t.speed(0)
t.forward(100)
t.left(90)
t.forward(50)
print(t.pos(), t.heading(), t.xcor(), t.ycor(), round(t.distance(0, 0), 3))
t.penup()
t.goto(10, 20)
t.pendown()
t.color("red", "yellow")
t.begin_fill()
for _ in range(3):
    t.forward(40)
    t.left(120)
t.end_fill()
t.dot(8, "blue")
t.write("hi", font=("Arial", 12, "bold"))
turtle.colormode(255)
t.pencolor((255, 0, 0))
print(t.pencolor(), turtle.Vec2D(1, 2) + turtle.Vec2D(3, 4))
turtle.bgcolor("lightgray")
turtle.title("Square")
screen = turtle.Screen()
screen.onclick(lambda x, y: print("click", x, y))
screen.onkey(lambda: print("key up"), "Up")
screen.ontimer(lambda: print("timer"), 5)
screen.listen()
turtle.done()
print("never")
'''


def turtle_lib():
    """The turtle library: drawing as canvas items (origin in the middle, y up), colours, fill, key / click / timer events, animation
    frames, and that a second run gets a fresh window instead of the previous one."""
    POSTS.clear()
    with contextlib.redirect_stdout(io.StringIO()) as o:
        r = json.loads(runner.run(json.dumps({"t.py": TURTLE}), "t.py"))
    assert r["gui"] and r["error"] is None, r
    assert o.getvalue() == "(100.00,50.00) 90.0 100.0 50.0 111.803\n#ff0000 (4.00,6.00)\n", o.getvalue()  # and "never" didn't print
    win = POSTS[-1]["wins"][0]
    cv = next(n for n in _walk(win) if n["t"] == "canvas")
    items = cv["items"]
    assert win["o"]["title"] == "Square" and cv["o"]["bg"] == "lightgray"
    lines = [i for i in items if i["t"] == "line"]
    assert lines[0]["c"] == [360, 270, 460, 270] and lines[1]["c"] == [460, 270, 460, 220], lines[:2]  # canvas centre is the origin, y points up
    assert [i["o"]["fill"] for i in items if i["t"] == "oval"] == ["blue"] and [i["o"]["text"] for i in items if i["t"] == "text"] == ["hi"]
    polys = [i for i in items if i["t"] == "polygon"]
    assert any(p["o"].get("outline") == "" and p["o"]["fill"] == "yellow" and len(p["c"]) == 8 for p in polys), polys  # the filled triangle (+ its start point)
    assert items[-1]["t"] == "polygon" and items[-1]["o"]["outline"] == "#ff0000", "the turtle itself is drawn on top"
    assert POSTS[-1]["wants"] == ["keyup", "press"]
    ev = lambda **e: json.loads(runner.gui_event("tkinter", json.dumps(e)))
    with contextlib.redirect_stdout(io.StringIO()) as o:
        ev(t="ev", id=cv["id"], k="press", num=1, x=460, y=270)
        ev(t="ev", id=cv["id"], k="keyup", keysym="Up")
        import time as _t
        _t.sleep(0.02)
        runner.gui_tick("tkinter")
    assert o.getvalue() == "click 100.0 0.0\nkey up\ntimer\n", o.getvalue()
    ev(t="close", id=win["id"])

    POSTS.clear()  # animation: a move at the default speed is posted as several frames, the line growing toward its end
    with contextlib.redirect_stdout(io.StringIO()):
        r = json.loads(runner.run(json.dumps({"a.py": "import turtle\nturtle.forward(100)\n"}), "a.py"))
    ends = []
    for tree in POSTS:
        if tree["wins"]:
            cv = next(n for n in _walk(tree["wins"][0]) if n["t"] == "canvas")
            ends += [i["c"][2] for i in cv["items"] if i["t"] == "line"]
    assert r["gui"], "no done(): the drawing stays on screen after the script ends"
    final = json.loads(runner.gui_pump("tkinter"))["tree"]  # the page asks for the last frame right after run() (worker.js)
    ends += [i["c"][2] for i in next(n for n in _walk(final["wins"][0]) if n["t"] == "canvas")["items"] if i["t"] == "line"]
    assert ends == sorted(ends) and len(set(ends)) >= 3 and ends[-1] == 460, ends
    runner.gui_stop()

    with contextlib.redirect_stderr(io.StringIO()) as se:
        e = json.loads(runner.run(json.dumps({"b.py": "import turtle\nturtle.shape('nope')\n"}), "b.py"))["error"]
    assert "TurtleGraphicsError" in e["msg"] and "<lib" not in se.getvalue(), (e, se.getvalue())

    two = json.dumps({"c.py": "import turtle\nturtle.forward(10)\nturtle.done()\n"})  # run again while the first window is still open
    for _ in range(2):
        POSTS.clear()
        with contextlib.redirect_stdout(io.StringIO()):
            assert json.loads(runner.run(two, "c.py"))["gui"]
        assert POSTS and POSTS[-1]["wins"], "the second run must get its own window"
    runner.gui_stop()


def example_library():
    """docs/examples/clicker is the library ADDING_A_LIBRARY.md walks through, so it has to really work."""
    runner.configure(json.dumps(names + ["clicker"]))
    runner.load_lib("clicker", (ROOT / "docs" / "examples" / "clicker" / "lib.py").read_text(encoding="utf-8"))
    posts = []
    runner.GUI["clicker"]["set_post"](posts.append)
    with contextlib.redirect_stdout(io.StringIO()) as o:
        r = json.loads(runner.run(json.dumps({"c.py": "import clicker\nclicker.show()\nclicker.mainloop()\nprint('never')\n"}), "c.py"))
    assert r["gui"] and r["error"] is None and o.getvalue() == "", (r, o.getvalue())
    assert json.loads(posts[0]) == {"count": 0, "open": True}
    out = json.loads(runner.gui_event("clicker", json.dumps({"type": "click"})))
    assert out["tree"] == {"count": 1, "open": True} and out["lib"] == "clicker" and out["alive"], out
    out = json.loads(runner.gui_event("clicker", json.dumps({"type": "close"})))
    assert not out["alive"] and out["tree"]["open"] is False and not runner._LIVE
    del runner.GUI["clicker"]
    runner.configure(json.dumps(names))


PATHLIB = '''from pathlib import Path
p = Path("notes.txt")
p.write_text("hi")
print(p.read_text(), p.exists(), p.suffix, Path(__file__).name, Path("a/b.py").parent)
'''
TELEPORT = '''import turtle
t = turtle.Turtle()
t.speed(0)
t.teleport(10, 20)
t.teleport(y=5)
print(t.pos(), t.isdown())
turtle.teleport(-3, 4)
print(turtle.pos())
'''


def last_tree():
    """The newest frame the page would have: the worker asks for the final one right after run() (a frame can be throttled before that)."""
    return json.loads(runner.gui_pump("tkinter")).get("tree") or POSTS[-1]


def pathlib_and_teleport():
    """pathlib works on the run's temporary folder (the working directory); turtle.teleport moves without drawing, whatever the pen does."""
    with contextlib.redirect_stdout(io.StringIO()) as o:
        r = json.loads(runner.run(json.dumps({"main.py": PATHLIB}), "main.py"))
    assert o.getvalue() == "hi True .txt main.py a\n" and r["error"] is None, (o.getvalue(), r["error"])
    POSTS.clear()
    with contextlib.redirect_stdout(io.StringIO()) as o:
        runner.run(json.dumps({"t.py": TELEPORT}), "t.py")
    assert o.getvalue() == "(10.00,5.00) True\n(-3.00,4.00)\n", o.getvalue()
    canvas = next(n for n in _walk(last_tree()["wins"][0]) if n["t"] == "canvas")
    assert not [i for i in canvas["items"] if i["t"] == "line"], "teleport draws no line even with the pen down"
    runner.gui_stop()


KEYLOOP = '''import tkinter as tk
import time
root = tk.Tk()
seen = []
root.bind("<KeyRelease-Left>", lambda e: seen.append(e.keysym))
n = 0
while len(seen) < 2 and n < 100:
    root.update()
    time.sleep(0.02)
    n += 1
print(seen)
'''
FOREVER = '''import time
import tkinter as tk
root = tk.Tk()
while True:
    root.update()
    time.sleep(0.02)
'''
TURTLE_FOREVER = '''import time
import turtle
turtle.speed(0)
while True:
    turtle.forward(1)
    turtle.update()
    time.sleep(0.02)
'''
BEAT = '''import tkinter as tk
root = tk.Tk()
for i in range(15000):
    root.update()
print("done")
'''


def window_events():
    """Events made while a script is busy reach it through the mailbox (that is what lets arrow keys steer an animation loop); a window
    closed mid-run ends the script (TclError / turtle.Terminator); a program that keeps updating its window is not an infinite loop."""
    real, sent = runner.mailbox, []

    def run(src, make):  # runs src; make(window id) is what the stand-in mailbox delivers once the program has shown its window
        def fake(lib):
            if lib == "tkinter" and POSTS and POSTS[-1]["wins"] and not sent:
                sent.append(1)
                return make(POSTS[-1]["wins"][0]["id"])
            return []
        POSTS.clear()
        sent.clear()
        runner.mailbox = fake
        try:
            with contextlib.redirect_stdout(io.StringIO()) as o, contextlib.redirect_stderr(io.StringIO()):
                r = json.loads(runner.run(json.dumps({"m.py": src}), "m.py"))
        finally:
            runner.mailbox = real
        return r, o.getvalue()

    close = lambda w: [{"t": "close", "id": w}]
    r, out = run(KEYLOOP, lambda w: [{"t": "ev", "id": w, "k": "keyup", "keysym": "Left"}] * 2)
    assert out == "['Left', 'Left']\n" and r["error"] is None, (out, r["error"])
    runner.gui_stop()
    r, out = run(FOREVER, close)
    assert r["error"] and "application has been destroyed" in r["error"]["msg"] and not r["gui"], r
    r, out = run(TURTLE_FOREVER, close)
    assert r["error"] and "Terminator" in r["error"]["msg"], r
    r, out = run("import turtle\nturtle.forward(5)\n", lambda w: [])  # the call after Terminator opens a fresh window
    assert r["error"] is None and r["gui"], r
    runner.gui_event("tkinter", json.dumps({"t": "close", "id": last_tree()["wins"][0]["id"]}))  # closed AFTER the script ended ...
    r, out = run("import turtle\nturtle.forward(5)\n", lambda w: [])
    assert r["error"] is None and r["gui"], "... must not make the next run raise Terminator"
    runner.gui_stop()
    r, out = run(BEAT, lambda w: [])  # 30,000 traced lines but LIMIT is 20,000: update() is a heartbeat
    assert out == "done\n" and r["error"] is None, (out, r["error"])
    runner.gui_stop()


SOLUTION = "def add(a, b):\n    return a + b\n"
HIDDEN_TESTS = '''# pynodemap lock secret
import unittest
from solution import add


class Hidden(unittest.TestCase):
    def test_adds(self):
        self.assertEqual(add(2, 3), 99)  # SECRET_EXPECTED_VALUE
'''
RUN_HIDDEN = "import unittest\nimport t_hidden\nunittest.main(module=t_hidden, exit=False)\n"


def locked_files():
    """A locked file still runs (import it, or press Tests) but is served from memory and untraced: no file for open() to read, no
    source lines in tracebacks, nothing in the trace or the step timeline."""
    files = {"solution.py": SOLUTION, "t_hidden.py": HIDDEN_TESTS}

    def go(files, main, mode="run", locked=("t_hidden.py",)):
        with contextlib.redirect_stdout(io.StringIO()) as o, contextlib.redirect_stderr(io.StringIO()) as e:
            r = json.loads(runner.run(json.dumps(files), main, mode, "[]", 0, "", json.dumps(list(locked))))
        return r, o.getvalue() + e.getvalue()

    r, out = go(files, "solution.py", "unittest")  # the Tests button on the student's file also runs the hidden tests
    assert "FAIL: test_adds" in out and "Ran 1 test" in out and "AssertionError: 5 != 99" in out, out
    assert "SECRET_EXPECTED_VALUE" not in out and "assertEqual(add(2, 3), 99)" not in out, "no source line of a locked file in the report:\n" + out
    assert 't_hidden.py", line 8' in out, out  # the file name and line are still given
    r, out = go({**files, "main.py": RUN_HIDDEN}, "main.py")  # importing it works too
    assert "FAIL: test_adds" in out and "SECRET_EXPECTED_VALUE" not in out, out
    r, out = go({**files, "main.py": RUN_HIDDEN}, "main.py", locked=())  # control: unlocked, the same report quotes the source
    assert "SECRET_EXPECTED_VALUE" in out and "Ran 1 test" in out, out
    peek = "try:\n    print(open('t_hidden.py').read())\nexcept FileNotFoundError:\n    print('no such file')\n"
    r, out = go({**files, "main.py": peek}, "main.py")
    assert out.strip() == "no such file", out
    r, out = go({**files, "main.py": RUN_HIDDEN}, "main.py")
    tl = r["timeline"]
    assert "t_hidden.py" not in r["files"] and tl["files"].index("t_hidden.py") not in tl["steps"][0::2], "a locked file is not traced"
    boom = {"main.py": "x = 1\nimport boom\n", "boom.py": "# pynodemap lock\nraise ValueError('hidden')\n"}
    r, out = go(boom, "main.py", locked=("boom.py",))
    assert (r["error"]["file"], r["error"]["line"]) == ("main.py", 2) and "ValueError: hidden" in r["error"]["msg"], r["error"]  # blamed on the student's line


if __name__ == "__main__":
    runner.LIMIT = 20_000  # a smaller cutoff keeps the infinite-loop checks fast
    analyze()
    execute()
    hints()
    timeline()
    input_and_errors()
    tkinter_app()
    tkinter_widgets()
    tkinter_classes()
    tkinter_star_import()
    turtle_lib()
    example_library()
    pathlib_and_teleport()
    window_events()
    locked_files()
    enum_and_unittest()
    print("ok")
