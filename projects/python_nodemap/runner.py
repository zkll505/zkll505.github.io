"""Backend for the node map. Runs inside Pyodide in a Web Worker (see worker.js).

Two jobs, and neither knows about any particular library (tkinter, turtle, doctest ... live in libs/<name>/lib.py):
  1. STATIC  analyze() parses the code with `ast` and never runs it, so the map can update while you type.
  2. DYNAMIC run() executes the program under sys.settrace and records what happened, line by line.

configure(allowed_json)  -> set the import allow-list (the names of the registered libraries)
load_lib(name, src)      -> run a library's lib.py (it may add run modes and a GUI backend; docs/ADDING_A_LIBRARY.md)
analyze(src, mods_json)  -> JSON {nodes, wires, hints}: one node per statement, wires = data flow, hints = beginner lint
run(files_json, main, mode, answers_json, seed)
                         -> JSON {files, timeline, error, need_input, gui}: values / hit counts per line plus a step timeline,
                            recorded with sys.settrace
gui_event / gui_tick / gui_pump / gui_stop / gui_libs
                         -> the page talking to a GUI library's window (tkinter, turtle) after run() returned

Data shapes (plain JSON, handed to nodemap.js / app.js unchanged):
  node  {id, kind, line, end, text, parent, kids, show}
        One per statement. Ids are numbered in pre-order (a statement before the statements inside it). `kind` is def, class,
        for, while, if, else, try, except, with, return, import, expr, assign or other. `show` = the names its value box lists.
  wire  {from, to, kind, label, two?, back?}
        kind "data": a value flows from node `from` to node `to` (label = the variable name; back = it comes from a later line
        of the same loop). kind "call": `to` is the function/class/method called (label = the call text; two = it returns a value).
  hint  {line, msg, kind}   kind is "warn" or "error"; the editor draws these as squiggles.
  run   {files, error, need_input, gui, timeline}
        files[name] = {vals, hits, calls, rets, params}, each keyed by line number (the aggregate shown when the run is finished).
        timeline = {files, steps, facts, trunc}: steps = [file index, line, file index, line, ...] for every executed line;
        facts = [[step, file index, "v"|"p"|"r", line, data], ...], values that became known right before step number `step`
        (v = variable values after a line, p = parameters at a call, r = a return value). NodeMap.viewAt() replays them.

Events while a program runs: a busy worker can't receive messages, so the page puts window events (key presses, clicks, the
close button) in a service worker's mailbox and the running program reads them with a synchronous request, mailbox(). A library
polls it from its update(); see sw.js and docs/ARCHITECTURE.md. gui_pump() hands over whatever is left when the program ends.

How tracing works: a "line" event fires BEFORE the line runs, so what a statement produced is snapshotted at the next line
event of the same frame (or at its "return"). That is why `last` remembers the previous line of each frame.
Safety limits (constants below): LIMIT traced lines (assumed infinite loop), MAXSTEPS / MAXFACTS timeline entries, OUTLIM output.
"""
import ast, builtins, importlib, json, os, random, re, shutil, sys, tempfile, traceback, types

try:
    import js  # only inside Pyodide: used to hand GUI windows to the page
except ImportError:
    js = None

ALLOWED = ()  # import names of the registered libraries, set by configure()
MODES = {}  # run modes added by libraries: id -> fn(module)
GUI = {}  # GUI backends added by libraries: lib name -> hooks (reset, finish, active, dispatch, tick, pump, set_post, exit)
# method names that change the object they are called on: `lst.append(x)` counts as a new definition of `lst`
MUTATORS = {"append", "extend", "insert", "remove", "pop", "clear", "sort", "reverse", "update", "add", "discard", "setdefault", "popitem"}
# built-in names that beginners overwrite by accident (`list = [1, 2]`); assigning one of them triggers a hint
SHADOW = {"list", "dict", "set", "str", "int", "float", "sum", "max", "min", "len", "input", "print", "range", "type", "id", "sorted",
          "abs", "round", "all", "any", "map", "filter", "zip", "open", "next", "iter", "format", "tuple", "bool", "object", "chr", "ord"}
LIMIT = 1_500_000  # traced lines before we assume an infinite loop
MAXSTEPS, MAXFACTS = 30_000, 120_000  # timeline size caps
OUTLIM = 400_000  # characters of output
FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)
# statement type -> node kind. Assign / AugAssign / AnnAssign become "assign"; anything not listed here becomes "other".
KIND = {ast.FunctionDef: "def", ast.AsyncFunctionDef: "def", ast.ClassDef: "class", ast.For: "for", ast.AsyncFor: "for",
        ast.While: "while", ast.If: "if", ast.Try: "try", ast.ExceptHandler: "except", ast.With: "with", ast.AsyncWith: "with",
        ast.Return: "return", ast.Import: "import", ast.ImportFrom: "import", ast.Expr: "expr"}
# the node fields sent to the page; the rest (scope, cls, uses, calls, ...) is bookkeeping only analyze() needs
OUT = ("id", "kind", "line", "end", "text", "parent", "kids", "show")


def params(a):
    """Every parameter name of an ast.arguments, including *args and **kwargs."""
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


def analyze(src, mods_json="[]"):
    """Static analysis of one file -> JSON {nodes, wires, hints}, or {error, line, msg} for a syntax error.
    mods_json = names of the project's other files (importable, so `import helpers` is not flagged).
    Steps: 1) visit() turns every statement into a node and records which node defines which name; 2) sources() resolves each
    use of a name to the node(s) that defined it, which gives the wires; 3) the hints that need those tables are added last."""
    mods = set(json.loads(mods_json))  # names of the project's other files (importable)
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return json.dumps({"error": f"line {e.lineno}: {e.msg}", "line": e.lineno or 1, "msg": e.msg})
    lines = src.splitlines()
    methods = {f.name for c in ast.walk(tree) if isinstance(c, ast.ClassDef) for f in c.body if isinstance(f, FUNCS)}
    # nodes: every node dict. tabs[scope][name] = ids of the nodes defining `name` in `scope` (-1 = module level, else the id of
    # the def/class node). glob[scope] = names declared `global`/`nonlocal` there. rets = ids of defs that `return` a value,
    # gens = ids of generator defs, by_method[name] = ids of methods with that name, init[class id] = id of its __init__.
    nodes, tabs, glob, rets, gens, by_method, init, hints = [], {}, {}, set(), set(), {}, {}, []  # tabs[scope][name] = ids of defining nodes

    def hint(line, msg, kind="warn"):
        hints.append({"line": line, "msg": msg, "kind": kind})

    def reg(scope, name, nid, cls):
        """Record that node nid defines `name`. `self.x` names go to the class's table (all its methods share them); a name
        declared global/nonlocal goes to the module table."""
        scope = cls if "." in name and cls is not None else -1 if name in glob.get(scope, ()) else scope
        tabs.setdefault(scope, {}).setdefault(name, []).append(nid)

    def add(kind, line, end, text, parent, scope, cls=None, name=None):
        """Create a node. scope = id of the enclosing def/class node (-1 at module level), cls = the class whose `self` is in use."""
        n = dict(id=len(nodes), kind=kind, line=line, end=end, text=text, parent=parent, scope=scope, cls=cls,
                 kids=[], uses=[], calls=[], show=[], name=name)
        nodes.append(n)
        if parent is not None:
            nodes[parent]["kids"].append(n["id"])
        return n

    def build(stmts, parent, scope, me, cls):
        """Visit a list of statements (`me` = the name of `self` inside a method) and flag code after return/break/continue/raise."""
        for i, s in enumerate(stmts):
            visit(s, parent, scope, me, cls)
            if isinstance(s, (ast.Return, ast.Break, ast.Continue, ast.Raise)) and i + 1 < len(stmts):
                hint(stmts[i + 1].lineno, f"This line can never run: it comes right after a {type(s).__name__.lower()}.")

    def lint(s, t, ex_defs):
        """Beginner hints that only need the statement itself (the ones that need the name tables come after the wires)."""
        if t in (ast.Import, ast.ImportFrom):
            tops = [a.name.split(".")[0] for a in s.names] if t is ast.Import else [] if s.level else [(s.module or "").split(".")[0]]
            for top in tops:
                if top not in ALLOWED and top not in mods:
                    hint(s.lineno, f"'{top}' isn't available here. You can import: " + ", ".join(ALLOWED + tuple(sorted(mods))), "error")
        elif t is ast.Expr and isinstance(s.value, (ast.Name, ast.Attribute)):
            hint(s.lineno, f"'{ast.unparse(s.value)}' on its own does nothing. To call a function add (), to show a value use print().")
        elif t is ast.Expr and isinstance(s.value, ast.Compare):
            hint(s.lineno, "The result of this comparison is thrown away. Did you mean = to assign a value?")
        elif t in FUNCS and any(isinstance(d, (ast.List, ast.Dict, ast.Set)) for d in s.args.defaults + [d for d in s.args.kw_defaults if d]):
            hint(s.lineno, "A list/dict/set default value is shared by every call. Use None and create it inside the function.")
        if t not in (ast.Import, ast.ImportFrom):
            for d in ex_defs:
                if d in SHADOW:
                    hint(s.lineno, f"'{d}' is already a built-in Python name. Reusing it hides the built-in, so pick another name.")

    def visit(s, parent, scope, me, cls):
        """One statement -> one node, then its children. Compound statements recurse through build(); `elif` is visited as a
        sibling of its `if`, and `else:` / `finally:` get a small pseudo-node of their own."""
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
        lint(s, t, set(defs) | set(show or []) if t in FUNCS else defs if "Assign" in t.__name__ or t in (ast.For, ast.AsyncFor) else [])
        first = min([d.lineno for d in getattr(s, "decorator_list", [])] + [s.lineno])
        kind = KIND.get(t, "assign" if "Assign" in t.__name__ else "other")
        n = add(kind, first, s.end_lineno, lines[s.lineno - 1].strip(), parent, scope, cls,
                name=getattr(s, "name", None))
        n.update(uses=uses, calls=calls, show=defs if show is None else show)
        if t is ast.Assign and isinstance(s.value, ast.Call) and isinstance(s.value.func, ast.Name):
            n["rcall"] = s.value.func.id
        for d in defs:
            reg(scope, d, n["id"], cls)
        if t is ast.Return and s.value is not None and scope != -1 and nodes[scope]["kind"] == "def":
            rets.add(scope)
        inner, me2, cls2 = scope, me, cls
        if t in FUNCS:
            inner = n["id"]
            if any(isinstance(m, (ast.Yield, ast.YieldFrom)) for m in ast.walk(s)):
                gens.add(inner)
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

    def loops_of(n):
        """Every for/while loop around node n inside its own function, innermost first (a while loop is around its own header)."""
        p = n["id"] if n["kind"] == "while" else n["parent"]
        found = []
        while p is not None and nodes[p]["kind"] not in ("def", "class"):
            if nodes[p]["kind"] in ("for", "while"):
                found.append(nodes[p])
            p = nodes[p]["parent"]
        return found

    def loop_of(n):
        """The innermost loop around node n (None if there is none)."""
        return next(iter(loops_of(n)), None)

    def sources(n, name):
        """ids of nodes whose definition of 'name' reaches n.
        ponytail: flow-insensitive, nearest earlier definition (+ a loop-carried one per enclosing loop, which may be n itself: `total = add(total, i)`
        in a loop feeds itself on the next repeat); branches aren't merged."""
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
                for lp in loops_of(n):  # a value made later in ANY enclosing loop reaches n on that loop's next repeat
                    out += [i for i in ids if n["id"] <= i <= lp["last"]][-1:]  # (<=: a statement can feed itself on the next repeat)
                return list(dict.fromkeys(out))
        return []

    wires = {}

    def wire(a, b, kind, label, **kw):
        """Add a wire a -> b. The same wire in the opposite direction merges into one two-way wire."""
        if a == b and not kw.get("back"):  # only a loop-carried value may come back to the statement that made it
            return
        r = wires.get((b, a, kind, label)) if a != b else None
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
                    if i == n["id"] and not loop_of(n):
                        continue  # outside a loop, a statement's own "earlier" value is just a use before assignment (hinted below)
                    wire(i, n["id"], "data", name, back=i >= n["id"])

    # beginner hints that need the definition tables
    for n in nodes:
        if n.get("rcall"):
            for i in sources(n, n["rcall"]):
                if nodes[i]["kind"] == "def" and i not in rets and i not in gens:
                    hint(n["line"], f"{n['rcall']}() has no return statement, so this assigns None. Add 'return <value>' to the function.")
        sc = n["scope"]
        if sc == -1 or nodes[sc]["kind"] == "def":
            for name in n["uses"]:
                ids = tabs.get(sc, {}).get(name)
                if "." in name or not ids or name in glob.get(sc, ()):
                    continue
                lp = loop_of(n)
                if not [i for i in ids if i < n["id"]] and not (lp and any(n["id"] < i <= lp["last"] for i in ids)):
                    hint(n["line"], f"'{name}' is used here before it has been given a value.")
    for f in nodes:
        if f["kind"] != "def":
            continue
        used = {u for m in nodes[f["id"] + 1: f["last"] + 1] for u in m["uses"]}
        for name, ids in tabs.get(f["id"], {}).items():
            if "." in name or name.startswith("_") or f["id"] in ids or name in used:
                continue
            if nodes[ids[0]]["kind"] == "assign":
                hint(nodes[ids[0]]["line"], f"'{name}' is given a value but never used.")

    hints = sorted({(h["line"], h["msg"]): h for h in hints}.values(), key=lambda h: h["line"])
    return json.dumps({"nodes": [{k: n[k] for k in OUT} for n in nodes], "wires": list(wires.values()), "hints": hints})


# ---------------------------------------------------------------- running

# The three exceptions below derive from BaseException so a student's `except Exception:` cannot swallow them.
class StepLimit(BaseException):  # too many traced lines: probably an infinite loop
    pass


class OutputLimit(BaseException):  # more than OUTLIM characters printed
    pass


class NeedInput(BaseException):  # input() with no queued answer: the page asks the user, then re-runs with the answers
    pass


def short(v, n=40, d=0):
    """A value as shown in a node's value box: repr, trimmed to n characters. Objects show their fields one level deep
    (Dog(name='Rex', tricks=[...])) and library objects (a turtle, a widget) only their class name."""
    try:
        r = repr(v)
        if r.startswith("<") and " object at 0x" in r and type(v).__module__.endswith("_lib"):
            r = f"<{type(v).__name__}>"  # an object from a library (turtle, tkinter widget): its internals are noise
        elif d < 1 and r.startswith("<") and " object at 0x" in r and hasattr(v, "__dict__"):
            r = f"{type(v).__name__}(" + ", ".join(f"{k}={short(x, 14, d + 1)}" for k, x in vars(v).items()) + ")"
        else:
            r = re.sub(r" at 0x[0-9a-f]+", "", r)
    except Exception:
        r = "<?>"
    return r if len(r) <= n else r[: n - 1] + "…"


def snap(frame, names, store, key):
    """Record the current value of 'names' under store[key]; returns what was recorded."""
    got = {}
    if not names:
        return got
    loc = frame.f_locals
    for nm in names:
        try:
            base, _, attr = nm.partition(".")
            v = loc[base] if base in loc else frame.f_globals[base]  # 'global x' names live in globals
            got[nm] = short(getattr(v, attr) if attr else v)
        except Exception:
            pass
    if got:
        store.setdefault(key, {}).update(got)
    return got


# A GUI window outlives run(): its callbacks run later, so the sandbox pieces they need are kept here (see gui_call):
# enter / leave (install / remove the sandbox), reset (zero the step and output counters), T (the traces being updated),
# step, root (the temp folder holding the project files) and mods (the project module names to remove from sys.modules).
_LIVE = {}


_MAIL = {"url": "", "ok": True}  # where the service worker's mailbox is ("" = none), and whether it has answered so far
_BEAT = [lambda: None]  # heartbeat(): set by run() to reset the traced-line counter (see load_lib)


def mailbox(lib):
    """The events the page left in the mailbox for library `lib` while the program was running: a list of dicts (what the view
    passed to send()). [] when there is no mailbox. One synchronous request, so it costs a moment: call it at most a few dozen
    times a second."""
    if js is None or not _MAIL["url"] or not _MAIL["ok"]:
        return []
    try:
        x = js.XMLHttpRequest.new()
        x.open("GET", f"{_MAIL['url']}?lib={lib}", False)
        x.send()
        if x.status == 200:
            return json.loads(x.responseText)
    except Exception:
        pass
    _MAIL["ok"] = False  # nothing answered (this worker isn't controlled by the service worker): stop asking, each try is a network round trip
    return []


def configure(allowed_json):
    """Set the import allow-list: the names of the registered libraries (PyLibs.names() in the page)."""
    global ALLOWED
    ALLOWED = tuple(json.loads(allowed_json))


def load_lib(name, src):
    """Run a library's lib.py once, at start-up (docs/ADDING_A_LIBRARY.md). Picks up the names it may define: install(),
    run_modes (-> MODES) and gui_hooks (-> GUI). Its frames are hidden from students' tracebacks (the "<lib name>" filename)."""
    # _mailbox() and _heartbeat() are handed to every library (docs/ADDING_A_LIBRARY.md): events that arrived while the program was
    # busy, and "I am still making progress" (an animation that keeps updating its window is not an infinite loop)
    ns = {"__name__": name + "_lib", "_mailbox": lambda: mailbox(name), "_heartbeat": lambda: _BEAT[0]()}
    exec(compile(src, f"<lib {name}>", "exec"), ns)
    if "install" in ns:
        ns["install"]()  # e.g. register fake modules in sys.modules
    MODES.update(ns.get("run_modes", {}))
    hooks = ns.get("gui_hooks")
    if hooks:
        GUI[name] = hooks
        if js is not None:
            hooks["set_post"](lambda s: js.guiPost(name, s))


def gui_cleanup():
    """The last GUI window is gone: delete the temp project folder and the project modules kept alive for its callbacks."""
    if _LIVE:
        shutil.rmtree(_LIVE.get("root"), ignore_errors=True)
        for m in _LIVE.get("mods", ()):
            sys.modules.pop(m, None)
        _LIVE.clear()


def run(files_json, main, mode="run", answers_json="[]", seed=0, mailbox_url=""):
    """Run 'main' with line tracing: as __main__, or (for a mode added by a library, e.g. doctest) as a module handed to that mode."""
    files, answers = json.loads(files_json), json.loads(answers_json)
    _MAIL.update(url=mailbox_url, ok=True)
    random.seed(seed)  # same seed on every re-run, so replaying input() answers repeats the same random numbers
    for g in GUI.values():
        g["reset"]()  # closes any window left by the previous run
    gui_cleanup()
    root = tempfile.mkdtemp()
    mods = {n[:-3] for n in files if n.endswith(".py")}
    names = list(files)
    fid = {n: i for i, n in enumerate(names)}
    info, T, step = {}, {}, [0]
    _BEAT[0] = lambda: step.__setitem__(0, 0)  # a library calls this when the program shows it is alive: restart the infinite-loop count
    # timeline: steps = [file index, line, ...], facts as described in the module docstring; over[0] = the step cap was hit;
    # cur = (file, line) being executed (to place an error at the right spot); outn / outover count the output against OUTLIM
    steps, facts, over, cur, outn, outover = [], [], [False], [None, 0], [0], [False]  # timeline: steps = [file, line, ...]
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

    def fact(name, kind, line, data):  # something that became known right before step number len(steps)/2
        if len(steps) < 2 * MAXSTEPS and len(facts) < MAXFACTS:
            facts.append([len(steps) // 2, fid[name], kind, line, data])

    def trace(frame, event, arg):  # sys.settrace callback: runs once per new call frame
        co = frame.f_code
        i = info.get(co.co_filename)
        if i is None:
            return None  # stdlib etc: don't trace
        name, defs, prm = i
        t, k, last, fi = T[name], co.co_firstlineno, [0], fid[name]
        if co.co_name != "<module>":
            t["calls"][k] = t["calls"].get(k, 0) + 1
            fact(name, "p", k, snap(frame, prm.get(k), t["params"], k))

        def local(frame, event, arg):  # the per-line tracer of this one frame; last[0] = the line that just finished
            ln = last[0]
            if event == "line":
                if ln:
                    g = snap(frame, defs.get(ln), t["vals"], ln)  # values after the previous line ran
                    if g:
                        fact(name, "v", ln, g)
                last[0] = ln = frame.f_lineno
                cur[0], cur[1] = name, ln
                t["hits"][ln] = t["hits"].get(ln, 0) + 1
                if len(steps) < 2 * MAXSTEPS:
                    steps.append(fi)
                    steps.append(ln)
                else:
                    over[0] = True
                step[0] += 1
                if step[0] > LIMIT:
                    raise StepLimit(f"Stopped after {LIMIT:,} lines - is there an infinite loop?")
            elif event == "return":
                if ln:
                    g = snap(frame, defs.get(ln), t["vals"], ln)
                    if g:
                        fact(name, "v", ln, g)
                if arg is not None:
                    v = t["rets"][ln] = t["rets"][k] = short(arg)
                    fact(name, "r", ln, v)
                    fact(name, "r", k, v)
            return local

        return local

    user = mods | {"__main__"}
    real_import, real_input = builtins.__import__, builtins.input

    def guard(name, globals=None, locals=None, fromlist=(), level=0):  # replaces __import__ while the program runs
        if level == 0 and (globals is None or globals.get("__name__") in user):
            top = name.split(".")[0]
            if top not in ALLOWED and top not in mods and top != "__main__":  # unittest.main() imports __main__
                raise ImportError(f"'{top}' isn't available here. You can import: " + ", ".join(ALLOWED + tuple(sorted(mods - {main[:-3]}))))
        return real_import(name, globals, locals, fromlist, level)

    def ui_input(msg=""):  # replaces input(): answers come from the page, which re-runs the program when one is missing
        sys.stdout.write(str(msg))
        sys.stdout.flush()
        if not answers:
            raise NeedInput(str(msg))
        v = str(answers.pop(0))
        sys.stdout.write(v + "\n")
        return v

    class Scrub:  # hides the temp folder in anything printed (tracebacks, doctest reports) and caps the output
        def __init__(self, f):
            self.f = f

        def write(self, s):
            outn[0] += len(s)
            if outn[0] > OUTLIM and not outover[0]:
                outover[0] = True
                raise OutputLimit(f"Stopped: more than {OUTLIM:,} characters of output.")
            return self.f.write(s.replace(root + os.sep, "").replace(root + "/", ""))

        def __getattr__(self, k):
            return getattr(self.f, k)

    def fail(e):
        """Print the traceback (without our own frames) to stderr and return {file, line, msg} for the innermost user frame."""
        te = traceback.TracebackException.from_exception(e)
        me = analyze.__code__.co_filename
        te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename != me and not f.filename.startswith("<lib ")])  # hide our own frames
        sys.stderr.write("".join(te.format()))
        loc = None
        for fr, ln in traceback.walk_tb(e.__traceback__):
            if fr.f_code.co_filename in info:
                loc = (info[fr.f_code.co_filename][0], ln)
        if isinstance(e, SyntaxError) and e.filename in info:
            loc = (info[e.filename][0], e.lineno or 1)
        msg = "".join(traceback.format_exception_only(type(e), e)).strip().splitlines()[-1]
        return {"file": loc[0], "line": loc[1], "msg": msg} if loc else None

    mod = types.ModuleType("__main__" if mode == "run" else main[:-3])
    mod.__file__ = os.path.join(root, main)
    saved = {}

    def enter():  # install the sandbox: import guard, traced execution, our own stdout, project files on the path
        saved.update(main=sys.modules.get("__main__"), path=sys.path[:], cwd=os.getcwd(), out=sys.stdout, err=sys.stderr)
        builtins.__import__, builtins.input = guard, ui_input
        sys.stdout, sys.stderr = Scrub(sys.stdout), Scrub(sys.stderr)
        sys.path.insert(0, root)
        os.chdir(root)
        importlib.invalidate_caches()
        sys.modules[mod.__name__] = mod
        sys.settrace(trace)

    def leave():
        sys.settrace(None)
        builtins.__import__, builtins.input = real_import, real_input
        sys.path[:] = saved["path"]
        os.chdir(saved["cwd"])
        sys.stdout, sys.stderr = saved["out"], saved["err"]
        sys.modules.pop("__main__", None)
        if saved["main"]:
            sys.modules["__main__"] = saved["main"]

    for m in mods:
        sys.modules.pop(m, None)
    err, need, gui = None, False, False
    enter()
    try:
        exec(compile(files[main], mod.__file__, "exec"), mod.__dict__)
        if mode in MODES:
            MODES[mode](mod)
    except (StepLimit, OutputLimit) as e:
        sys.stderr.write(f"{e}\n")
        err = {"file": cur[0], "line": cur[1], "msg": str(e)} if cur[0] else None
    except NeedInput:
        need = True
    except SystemExit:
        pass
    except BaseException as e:
        if any(isinstance(e, g["exit"]) for g in GUI.values()):
            pass  # root.mainloop(): the window stays open and its callbacks run later (gui_event)
        else:
            err = fail(e)
    finally:
        gui = not need and any(g["active"]() for g in GUI.values())
        leave()
        if gui:
            def reset():
                step[0] = 0
                outn[0] = 0
                outover[0] = False

            _LIVE.update(enter=enter, leave=leave, reset=reset, T=T, step=step, root=root, mods=mods)
        else:
            for g in GUI.values():
                g["finish"]()  # the script ended without mainloop(): its windows close, like real Tk
            for m in mods | {"__main__"}:
                sys.modules.pop(m, None)
            shutil.rmtree(root, ignore_errors=True)
    return json.dumps({"files": T, "error": err, "need_input": need, "gui": gui,
                       "timeline": {"files": names, "steps": steps, "facts": facts, "trunc": over[0]}})


def gui_reply(lib, touched=False):
    """The JSON answer to the page for a GUI library: pump()'s {alive, next, tree?}, plus the node map's new values if
    callbacks ran (`touched`). Ends the sandbox when no window is left."""
    out = GUI[lib]["pump"]()
    out["lib"] = lib
    if _LIVE and touched:
        out["files"] = _LIVE["T"]  # callbacks ran, so the node map's values have changed
    if not any(g["active"]() for g in GUI.values()):
        gui_cleanup()
    return json.dumps(out)


def gui_call(lib, fn):
    """Run something that executes user callbacks (a window event, an after() timer) inside the same sandbox as run()."""
    live = _LIVE
    if live:
        live["reset"]()
        live["enter"]()
    try:
        fn()
    except NeedInput:
        sys.stderr.write("input() can't be used inside a window callback here; use an Entry widget instead.\n")
    except (StepLimit, OutputLimit) as e:
        sys.stderr.write(f"{e}\n")
    except BaseException as e:
        if not any(isinstance(e, g["exit"]) for g in GUI.values()):
            sys.stderr.write("".join(traceback.format_exception_only(type(e), e)))
    finally:
        touched = bool(live) and live["step"][0] > 0
        if live:
            live["leave"]()
    return gui_reply(lib, touched)


def gui_event(lib, s):
    """The page sent a window event (JSON string s): run the library's dispatch() inside the sandbox."""
    return gui_call(lib, lambda: GUI[lib]["dispatch"](json.loads(s)))


def gui_tick(lib):
    """A timer the library asked for (`next` in pump()) is due: run the library's tick() inside the sandbox."""
    return gui_call(lib, GUI[lib]["tick"])


def gui_pump(lib):
    """Ask a library for its current frame and next timer (used right after run()). Events that were still waiting in the mailbox
    when the program ended are handled first."""
    events = mailbox(lib)
    if events:
        return gui_call(lib, lambda: [GUI[lib]["dispatch"](e) for e in events])
    return gui_reply(lib)


def gui_libs():
    """Names of the libraries that have a GUI backend."""
    return json.dumps(list(GUI))


def gui_stop():  # close every window and drop its timers (the page replaced the project)
    for g in GUI.values():
        g["reset"]()
    gui_cleanup()
