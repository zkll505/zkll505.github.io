/* Python backend for the node map, kept as a JS string so the page also works when opened straight from disk (file://),
   where the browser blocks fetch(). app.js runs it inside Pyodide. test_runner.py extracts and tests it. */
const RUNNER_PY = String.raw`"""Backend for the node map. Loaded into Pyodide by app.js.

analyze(src)               -> JSON {nodes, wires}: one node per statement, wires = data flow between them
run(files_json, main, mode) -> JSON trace: variable values / hit counts per line, from sys.settrace
"""
import ast, builtins, doctest, importlib, json, os, re, shutil, sys, tempfile, traceback, types

try:
    import js  # input() is a browser prompt
except ImportError:
    js = None

ALLOWED = ("random", "math", "time", "doctest")
MUTATORS = {"append", "extend", "insert", "remove", "pop", "clear", "sort", "reverse", "update", "add", "discard", "setdefault", "popitem"}
LIMIT = 1_500_000  # traced lines before we assume an infinite loop
FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)
KIND = {ast.FunctionDef: "def", ast.AsyncFunctionDef: "def", ast.ClassDef: "class", ast.For: "for", ast.AsyncFor: "for",
        ast.While: "while", ast.If: "if", ast.Try: "try", ast.ExceptHandler: "except", ast.With: "with", ast.AsyncWith: "with",
        ast.Return: "return", ast.Import: "import", ast.ImportFrom: "import", ast.Expr: "expr"}
OUT = ("id", "kind", "line", "end", "text", "parent", "kids", "show")


def params(a):
    return [x.arg for x in a.posonlyargs + a.args + a.kwonlyargs] + [x.arg for x in (a.vararg, a.kwarg) if x]


def own(s):
    """-> (expressions this statement itself evaluates, extra names it defines, names to show in the value box or None)"""
    t = type(s)
    if t in FUNCS:
        a = s.args
        ex = s.decorator_list + a.defaults + [d for d in a.kw_defaults if d] + [r for r in [s.returns] if r]
        return ex + [x.annotation for x in a.posonlyargs + a.args + a.kwonlyargs if x.annotation], [s.name], params(a)
    if t is ast.ClassDef:
        return s.decorator_list + s.bases + [k.value for k in s.keywords], [s.name], []
    if t in (ast.With, ast.AsyncWith):
        return [x for i in s.items for x in (i.context_expr, i.optional_vars) if x], [], None
    if t in (ast.Import, ast.ImportFrom):
        return [], [(a.asname or a.name).split(".")[0] for a in s.names], []
    if t is ast.ExceptHandler:
        return [s.type] if s.type else [], [s.name] if s.name else [], None
    return [c for c in ast.iter_child_nodes(s) if isinstance(c, ast.expr)], [], None


def scan(exprs, me, methods):
    """-> (names used, names defined, [(callee, label)]). 'me' is the method's self name: self.x becomes one name 'self.x'."""
    uses, defs, calls, bound, skip = {}, {}, [], set(), set()
    for m in [m for e in exprs for m in ast.walk(e)]:
        if isinstance(m, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            bound |= {t.id for g in m.generators for t in ast.walk(g.target) if isinstance(t, ast.Name)}
        elif isinstance(m, ast.Lambda):
            bound |= {x.arg for x in ast.walk(m.args) if isinstance(x, ast.arg)}
        elif isinstance(m, ast.Call):
            f, label = m.func, ast.unparse(m)
            label = label if len(label) <= 24 else label[:23] + "…"
            if isinstance(f, ast.Name):
                calls.append((f.id, label))
            elif isinstance(f, ast.Attribute):
                if f.attr in methods and not f.attr.startswith("__"):
                    calls.append(("." + f.attr, label))
                    skip |= {id(f), id(f.value)} if isinstance(f.value, ast.Name) and f.value.id == me else set()
                if f.attr in MUTATORS:  # lst.append(x) changes lst; self.lst.append(x) changes self.lst
                    v = f.value
                    if isinstance(v, ast.Name):
                        defs[v.id] = 1
                    elif isinstance(v, ast.Attribute) and isinstance(v.value, ast.Name) and v.value.id == me:
                        defs[f"{me}.{v.attr}"] = 1
        if isinstance(m, ast.Attribute) and id(m) not in skip and isinstance(m.value, ast.Name):
            if m.value.id == me:
                skip.add(id(m.value))
                (defs if isinstance(m.ctx, ast.Store) else uses)[f"{me}.{m.attr}"] = 1
            elif isinstance(m.ctx, ast.Store):
                defs[m.value.id] = 1  # obj.attr = v changes obj
        elif isinstance(m, ast.Subscript) and isinstance(m.ctx, ast.Store) and isinstance(m.value, ast.Name):
            defs[m.value.id] = 1  # a[i] = v changes a
        elif isinstance(m, ast.Name) and id(m) not in skip:
            (defs if isinstance(m.ctx, ast.Store) else uses)[m.id] = 1
    for b in bound:
        uses.pop(b, None), defs.pop(b, None)
    return list(uses), list(defs), calls


def analyze(src):
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return json.dumps({"error": f"line {e.lineno}: {e.msg}"})
    lines = src.splitlines()
    methods = {f.name for c in ast.walk(tree) if isinstance(c, ast.ClassDef) for f in c.body if isinstance(f, FUNCS)}
    nodes, tabs, glob, rets, by_method, init = [], {}, {}, set(), {}, {}  # tabs[scope][name] = ids of defining nodes

    def reg(scope, name, nid, cls):
        scope = cls if "." in name and cls is not None else -1 if name in glob.get(scope, ()) else scope
        tabs.setdefault(scope, {}).setdefault(name, []).append(nid)

    def add(kind, line, end, text, parent, scope, cls=None, name=None):
        n = dict(id=len(nodes), kind=kind, line=line, end=end, text=text, parent=parent, scope=scope, cls=cls,
                 kids=[], uses=[], calls=[], show=[], name=name)
        nodes.append(n)
        if parent is not None:
            nodes[parent]["kids"].append(n["id"])
        return n

    def build(stmts, parent, scope, me, cls):
        for s in stmts:
            visit(s, parent, scope, me, cls)

    def visit(s, parent, scope, me, cls):
        t = type(s)
        if isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant) and isinstance(s.value.value, str):
            return  # docstring
        if t in (ast.Global, ast.Nonlocal):
            glob.setdefault(scope, set()).update(s.names)
            return
        ex, edefs, show = own(s)
        uses, defs, calls = scan(ex, me, methods)
        if t is ast.AugAssign and isinstance(s.target, ast.Name):
            uses.append(s.target.id)
        defs = list(dict.fromkeys(defs + edefs))
        first = min([d.lineno for d in getattr(s, "decorator_list", [])] + [s.lineno])
        kind = KIND.get(t, "assign" if "Assign" in t.__name__ else "other")
        n = add(kind, first, s.end_lineno, lines[s.lineno - 1].strip(), parent, scope, cls,
                name=getattr(s, "name", None))
        n.update(uses=uses, calls=calls, show=defs if show is None else show)
        for d in defs:
            reg(scope, d, n["id"], cls)
        if t is ast.Return and s.value is not None and scope != -1 and nodes[scope]["kind"] == "def":
            rets.add(scope)
        inner, me2, cls2 = scope, me, cls
        if t in FUNCS:
            inner = n["id"]
            for p in params(s.args):
                reg(inner, p, inner, None)
            if scope != -1 and nodes[scope]["kind"] == "class":
                me2, cls2 = (params(s.args) or [None])[0], scope
                by_method.setdefault(s.name, []).append(inner)
                if s.name == "__init__":
                    init[scope] = inner
        elif t is ast.ClassDef:
            inner, me2, cls2 = n["id"], None, None
        build(getattr(s, "body", []), n["id"], inner, me2, cls2)
        if t is ast.Match:
            for c in s.cases:
                build(c.body, n["id"], inner, me2, cls2)
        for h in getattr(s, "handlers", []):
            visit(h, n["id"], inner, me2, cls2)
        elif_ = None
        for field, label in (("orelse", "else:"), ("finalbody", "finally:")):
            body = getattr(s, field, None)
            if not body:
                continue
            if t is ast.If and len(body) == 1 and isinstance(body[0], ast.If) and body[0].col_offset == s.col_offset:
                elif_ = body[0]
            else:
                p = add("else", body[0].lineno, body[-1].end_lineno, label, n["id"], inner)
                build(body, p["id"], inner, me2, cls2)
                p["last"] = len(nodes) - 1
        n["last"] = len(nodes) - 1
        if elif_:
            visit(elif_, parent, scope, me, cls)  # elif is a sibling of its if

    build(tree.body, None, -1, None, None)

    def loop_of(n):
        p = n["id"] if n["kind"] == "while" else n["parent"]
        while p is not None and nodes[p]["kind"] not in ("def", "class"):
            if nodes[p]["kind"] in ("for", "while"):
                return nodes[p]
            p = nodes[p]["parent"]

    def sources(n, name):
        """ids of nodes whose definition of 'name' reaches n.
        ponytail: flow-insensitive, nearest earlier definition (+ one loop-carried one); branches aren't merged."""
        if "." in name:
            chain = [n["cls"]]
        elif name in glob.get(n["scope"], ()):
            chain = [-1]
        else:
            chain, s = [], n["scope"]
            while True:
                if not chain or s == -1 or nodes[s]["kind"] != "class":
                    chain.append(s)
                if s == -1:
                    break
                s = nodes[s]["scope"]
        for sc in chain:
            ids = tabs.get(sc, {}).get(name)
            if ids:
                out = [i for i in ids if i < n["id"]][-1:] or ids[:1]
                lp = loop_of(n)
                if lp:
                    out += [i for i in ids if n["id"] < i <= lp["last"]][-1:]
                return list(dict.fromkeys(out))
        return []

    wires = {}

    def wire(a, b, kind, label, **kw):
        if a == b:
            return
        r = wires.get((b, a, kind, label))
        if r:
            r["two"] = True  # both directions -> one two-way wire
        else:
            wires.setdefault((a, b, kind, label), {"from": a, "to": b, "kind": kind, "label": label, **kw})

    for n in nodes:
        called = set()
        for name, label in n["calls"]:
            if name.startswith("."):
                targets = by_method.get(name[1:], [])[:3]
            else:
                targets = []
                for i in sources(n, name):
                    k = nodes[i]["kind"]
                    targets += [i] if k == "def" else [init.get(i, i)] if k == "class" else []
                if targets:
                    called.add(name)
            for t in targets:
                two = t in rets or nodes[t]["name"] == "__init__" or nodes[t]["kind"] == "class"
                wire(n["id"], t, "call", label, two=two)
        for name in n["uses"]:
            if name not in called:
                for i in sources(n, name):
                    wire(i, n["id"], "data", name, back=i > n["id"])
    return json.dumps({"nodes": [{k: n[k] for k in OUT} for n in nodes], "wires": list(wires.values())})


# ---------------------------------------------------------------- running

class StepLimit(BaseException):
    pass


def short(v, n=40, d=0):
    try:
        r = repr(v)
        if d < 1 and r.startswith("<") and " object at 0x" in r and hasattr(v, "__dict__"):
            r = f"{type(v).__name__}(" + ", ".join(f"{k}={short(x, 14, d + 1)}" for k, x in vars(v).items()) + ")"
        else:
            r = re.sub(r" at 0x[0-9a-f]+", "", r)
    except Exception:
        r = "<?>"
    return r if len(r) <= n else r[: n - 1] + "…"


def snap(frame, names, store, key):
    if not names:
        return
    loc, got = frame.f_locals, {}
    for nm in names:
        try:
            base, _, attr = nm.partition(".")
            v = loc[base] if base in loc else frame.f_globals[base]  # 'global x' names live in globals
            got[nm] = short(getattr(v, attr) if attr else v)
        except Exception:
            pass
    if got:
        store.setdefault(key, {}).update(got)


def run(files_json, main, mode="run"):
    """Run 'main' (as __main__, or as a module + doctest.testmod when mode == 'doctest') with line tracing."""
    files = json.loads(files_json)
    root = tempfile.mkdtemp()
    mods = {n[:-3] for n in files if n.endswith(".py")}
    info, T, step = {}, {}, [0]
    for name, src in files.items():
        path = os.path.join(root, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(src)
        a = json.loads(analyze(src))
        defs, prm = {}, {}
        for n in a.get("nodes", []):
            tgt = prm if n["kind"] == "def" else defs
            tgt.setdefault(n["line"], []).extend(n["show"])
        info[path] = (name, defs, prm)
        T[name] = {"vals": {}, "hits": {}, "calls": {}, "rets": {}, "params": {}}

    def trace(frame, event, arg):
        co = frame.f_code
        i = info.get(co.co_filename)
        if i is None:
            return None  # stdlib etc: don't trace
        name, defs, prm = i
        t, k, last = T[name], co.co_firstlineno, [0]
        if co.co_name != "<module>":
            t["calls"][k] = t["calls"].get(k, 0) + 1
            snap(frame, prm.get(k), t["params"], k)

        def local(frame, event, arg):
            ln = last[0]
            if event == "line":
                if ln:
                    snap(frame, defs.get(ln), t["vals"], ln)  # values after the previous line ran
                last[0] = ln = frame.f_lineno
                t["hits"][ln] = t["hits"].get(ln, 0) + 1
                step[0] += 1
                if step[0] > LIMIT:
                    raise StepLimit(f"Stopped after {LIMIT:,} lines - is there an infinite loop?")
            elif event == "return":
                if ln:
                    snap(frame, defs.get(ln), t["vals"], ln)
                if arg is not None:
                    t["rets"][ln] = t["rets"][k] = short(arg)
            return local

        return local

    real_import, real_input = builtins.__import__, builtins.input
    user = mods | {"__main__"}

    def guard(name, globals=None, locals=None, fromlist=(), level=0):
        if level == 0 and (globals is None or globals.get("__name__") in user):
            top = name.split(".")[0]
            if top not in ALLOWED and top not in mods:
                raise ImportError(f"'{top}' isn't available here. You can import: " + ", ".join(ALLOWED + tuple(sorted(mods - {main[:-3]}))))
        return real_import(name, globals, locals, fromlist, level)

    def ui_input(msg=""):
        sys.stdout.write(str(msg))
        sys.stdout.flush()
        try:
            v = js.prompt(str(msg))
        except Exception:
            raise EOFError("input() needs the browser's prompt dialog, which is blocked here") from None
        if v is None:
            raise EOFError("input cancelled")
        sys.stdout.write(v + "\n")
        return v

    class Scrub:  # hides the temp folder in anything printed (tracebacks, doctest reports)
        def __init__(self, f):
            self.f = f

        def write(self, s):
            return self.f.write(s.replace(root + os.sep, "").replace(root + "/", ""))

        def __getattr__(self, k):
            return getattr(self.f, k)

    def fail(e):
        te = traceback.TracebackException.from_exception(e)
        te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename != fail.__code__.co_filename])  # hide runner frames
        sys.stderr.write("".join(te.format()))

    saved = (sys.modules.get("__main__"), sys.path[:], os.getcwd(), sys.stdout, sys.stderr)
    for m in mods:
        sys.modules.pop(m, None)
    builtins.__import__, builtins.input = guard, ui_input
    sys.stdout, sys.stderr = Scrub(sys.stdout), Scrub(sys.stderr)
    sys.path.insert(0, root)
    os.chdir(root)
    importlib.invalidate_caches()
    try:
        path = os.path.join(root, main)
        mod = types.ModuleType("__main__" if mode == "run" else main[:-3])
        mod.__file__ = path
        sys.modules[mod.__name__] = mod
        sys.settrace(trace)
        exec(compile(files[main], path, "exec"), mod.__dict__)
        if mode == "doctest":
            r = doctest.testmod(mod, verbose=False)
            print(f"doctest: {r.attempted} run, {r.failed} failed" if r.attempted else "doctest: no >>> examples found in docstrings")
    except StepLimit as e:
        sys.stderr.write(f"{e}\n")
    except SystemExit:
        pass
    except BaseException as e:
        fail(e)
    finally:
        sys.settrace(None)
        builtins.__import__, builtins.input = real_import, real_input
        sys.path[:] = saved[1]
        os.chdir(saved[2])
        sys.stdout, sys.stderr = saved[3], saved[4]
        for m in mods | {"__main__"}:
            sys.modules.pop(m, None)
        if saved[0]:
            sys.modules["__main__"] = saved[0]
        shutil.rmtree(root, ignore_errors=True)
    return json.dumps({"files": T})
`;
