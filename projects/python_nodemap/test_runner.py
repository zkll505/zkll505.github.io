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


if __name__ == "__main__":
    runner.LIMIT = 20_000
    analyze()
    execute()
    print("ok")
