"""Self-check for the Python backend inside runner.js. Run: python test_runner.py"""
import io, json, contextlib, pathlib, re, types

js = pathlib.Path(__file__).with_name("runner.js").read_text(encoding="utf-8")
runner = types.ModuleType("runner")
exec(compile(re.search(r"String\.raw`(.*)`;", js, re.S).group(1), "runner.js", "exec"), runner.__dict__)

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


if __name__ == "__main__":
    runner.LIMIT = 20_000
    analyze()
    execute()
    hints()
    timeline()
    input_and_errors()
    print("ok")
