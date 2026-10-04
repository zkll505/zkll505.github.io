"""Self-check for the Python backend inside runner.js. Run: python test_runner.py"""
import io, json, contextlib, pathlib, re, types

js = pathlib.Path(__file__).with_name("runner.js").read_text(encoding="utf-8")
runner = types.ModuleType("runner")
exec(compile(re.search(r"String\.raw`(.*)`;", js, re.S).group(1), "runner.js", "exec"), runner.__dict__)
TK_SRC = re.search(r"String\.raw`(.*)`;", pathlib.Path(__file__).with_name("tkshim.js").read_text(encoding="utf-8"), re.S).group(1)
runner.tk_install(TK_SRC)
POSTS = []  # trees the page would receive while a script is running
runner.TK["set_post"](lambda s: POSTS.append(json.loads(s)))

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
    g = json.loads(runner.analyze(SRC))
    N, text = g["nodes"], lambda s: next(n["id"] for n in g["nodes"] if n["text"].startswith(s))
    W = lambda a, b, kind, label=None: [w for w in g["wires"] if (w["from"], w["to"], w["kind"]) == (text(a), text(b), kind) and label in (None, w["label"])]
    assert W("total = add", "total = add", "data") == [], "no self wire"
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
    ev = lambda **e: json.loads(runner.tk_event(json.dumps(e)))
    with contextlib.redirect_stdout(io.StringIO()) as o:
        ev(t="value", id=entry["id"], v="abc")
        out = ev(t="click", id=btn["id"])
        ev(t="ev", id=win["id"], k="key", keysym="a", char="a")
        t = json.loads(runner.tk_tick())
        import time as _t
        _t.sleep(0.02)
        runner.tk_tick()
    assert "entry says abc" in o.getvalue() and "key a" in o.getvalue() and "timer fired" in o.getvalue(), o.getvalue()
    assert out["tree"]["wins"][0]["k"][0]["o"]["text"] == "clicked 1", "a callback's change reaches the page"
    assert out["files"]["main.py"]["vals"], "the node map gets fresh values after a callback"
    assert out["alive"] and runner._LIVE
    out = ev(t="close", id=win["id"])
    assert not out["alive"] and not runner._LIVE, "closing the window ends the program"

    POSTS.clear()  # a script that never calls mainloop(): the window is shown by update() and closes when the script ends
    with contextlib.redirect_stdout(io.StringIO()):
        r = json.loads(runner.run(json.dumps({"a.py": "import tkinter as tk\nr = tk.Tk()\ntk.Label(r, text='x').pack()\nr.update()\n"}), "a.py"))
    assert not r["gui"] and len(POSTS[0]["wins"]) == 1 and POSTS[-1]["wins"] == [], POSTS


def tkinter_widgets():
    POSTS.clear()
    with contextlib.redirect_stdout(io.StringIO()):
        runner.run(json.dumps({"w.py": TKWIDGETS}), "w.py")
    win = POSTS[-1]["wins"][0]
    by = {}
    for n in _walk(win):
        by.setdefault(n["t"], []).append(n)
    ev = lambda **e: json.loads(runner.tk_event(json.dumps(e)))
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
    assert "Exception in Tkinter callback" in se.getvalue() and "ZeroDivisionError" in se.getvalue() and "tkshim" not in se.getvalue(), se.getvalue()
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
    ev = lambda **e: json.loads(runner.tk_event(json.dumps(e)))
    with contextlib.redirect_stdout(io.StringIO()) as o:
        out = ev(t="click", id=by["button"][0]["id"])
    assert "combo: y 1" in o.getvalue(), o.getvalue()
    n = {k["t"]: k for k in _walk(out["tree"]["wins"][0])}
    assert n["label"]["o"]["text"] == "1" and n["progressbar"]["v"] == 1
    ev(t="close", id=win["id"])


def tkinter_star_import():
    star = ("from tkinter import *\nfrom tkinter import messagebox, ttk\nroot = Tk()\nLabel(root, text='hi').pack(side=LEFT, fill=X)\n"
            "v = StringVar(value='x')\nttk.Label(root, text=v.get()).pack()\nroot.mainloop()\n")
    POSTS.clear()
    with contextlib.redirect_stdout(io.StringIO()):
        r = json.loads(runner.run(json.dumps({"s.py": star}), "s.py"))
    assert r["gui"] and r["error"] is None, r
    labels = [n for n in _walk(POSTS[-1]["wins"][0]) if n["t"] == "label"]
    assert [n["o"]["text"] for n in labels] == ["hi", "x"]
    runner.TK["dispatch"]({"t": "close", "id": POSTS[-1]["wins"][0]["id"]})
    # the real module doesn't hand out ttk-only names or submodules through *
    bad = "from tkinter import *\nprint(Combobox)\n"
    with contextlib.redirect_stderr(io.StringIO()) as se:
        runner.run(json.dumps({"b.py": bad}), "b.py")
    assert "NameError" in se.getvalue(), se.getvalue()


def enum_and_unittest():
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


if __name__ == "__main__":
    runner.LIMIT = 20_000
    analyze()
    execute()
    hints()
    timeline()
    input_and_errors()
    tkinter_app()
    tkinter_widgets()
    tkinter_classes()
    tkinter_star_import()
    enum_and_unittest()
    print("ok")
