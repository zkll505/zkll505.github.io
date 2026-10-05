"""tkinter look-alike. Supported: Tk/Toplevel, Frame, LabelFrame, Label, Message, Button, Entry, Text, Checkbutton, Radiobutton,
Scale, Spinbox, Listbox, Canvas, Menu, OptionMenu, ttk.Combobox/Progressbar/Separator, StringVar/IntVar/DoubleVar/BooleanVar,
pack/grid/place, bind, after, update, messagebox, simpledialog (answers immediately), font.Font.
Not supported: images, file dialogs, Text tags, scrollbars (widgets scroll by themselves), ttk themes/Notebook/Treeview.
A window that was shown stays open after the script ends (like IDLE/Thonny) and its callbacks run when you click, type or a timer fires.
mainloop() ends the script (code after it never runs)."""
import itertools, json, re, sys, time, traceback, types


class TclError(Exception):
    pass


class _MainloopExit(BaseException):
    pass


_ids = itertools.count(1)
_ST = {"roots": [], "dirty": False, "after": [], "afterid": 0, "dialogs": [], "focus": None, "fn": 0, "shown": False,
       "post": None, "notes": set(), "all": {}, "flushed": 0.0}
_REG = {}

NO = FALSE = OFF = 0
YES = TRUE = ON = 1
N, S, W, E, NW, SW, NE, SE, NS, EW, NSEW, CENTER = "n", "s", "w", "e", "nw", "sw", "ne", "se", "ns", "ew", "nsew", "center"
NONE, X, Y, BOTH = "none", "x", "y", "both"
LEFT, TOP, RIGHT, BOTTOM = "left", "top", "right", "bottom"
RAISED, SUNKEN, FLAT, RIDGE, GROOVE, SOLID = "raised", "sunken", "flat", "ridge", "groove", "solid"
HORIZONTAL, VERTICAL = "horizontal", "vertical"
NUMERIC, CHAR, WORD = "numeric", "char", "word"
ACTIVE, NORMAL, DISABLED, HIDDEN, READONLY = "active", "normal", "disabled", "hidden", "readonly"
END, INSERT, SEL, SEL_FIRST, SEL_LAST, ANCHOR, ALL, CURRENT = "end", "insert", "sel", "sel.first", "sel.last", "anchor", "all", "current"
SINGLE, BROWSE, MULTIPLE, EXTENDED = "single", "browse", "multiple", "extended"
TkVersion = 8.6
TclVersion = 8.6
READABLE, WRITABLE = 2, 4


def _dirty():
    _ST["dirty"] = True


# ------------------------------------------------------------------ values: colours, fonts, padding

_ALIAS = {"background": "bg", "foreground": "fg", "borderwidth": "bd"}
_COLORS = {"bg", "fg", "activebackground", "activeforeground", "highlightbackground", "highlightcolor", "disabledforeground",
           "selectbackground", "selectforeground", "troughcolor", "insertbackground", "readonlybackground"}
_SYS = {"systembuttonface": "#f0f0f0", "systemwindow": "#ffffff", "systemwindowtext": "#000000", "systembuttontext": "#000000",
        "systemhighlight": "#3399ff", "systemhighlighttext": "#ffffff", "systemmenu": "#f0f0f0", "systemscrollbar": "#c8c8c8"}


def _opts(cnf, kw):
    d = dict(cnf) if isinstance(cnf, dict) else {}
    d.update(kw)
    return {_ALIAS.get(k, k): v for k, v in d.items()}


def _color(c):
    if not isinstance(c, str):
        return c
    c = c.strip().lower().replace(" ", "")
    m = re.fullmatch(r"gr[ae]y(\d{1,3})", c)
    if m:
        g = round(min(100, int(m.group(1))) * 255 / 100)
        return "#%02x%02x%02x" % (g, g, g)
    return _SYS.get(c, c)


def _pair(v):
    try:
        if isinstance(v, (tuple, list)):
            a = float(v[0])
            return [a, float(v[1]) if len(v) > 1 else a]
        return [float(v)] * 2
    except (TypeError, ValueError):
        return [0, 0]


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _fd(family, size, styles=()):
    styles = " ".join(styles) if not isinstance(styles, str) else styles
    try:
        size = int(size) if size is not None else None
    except (TypeError, ValueError):
        size = None
    return {"f": str(family), "s": abs(size) if size else 10, "px": bool(size and size < 0), "b": "bold" in styles,
            "i": "italic" in styles, "u": "underline" in styles, "o": "overstrike" in styles}


def _font(f):
    if f is None:
        return None
    if isinstance(f, Font):
        d = f._d
        return _fd(d["family"], d["size"], [d["weight"], d["slant"]] + (["underline"] if d["underline"] else []) + (["overstrike"] if d["overstrike"] else []))
    if isinstance(f, str):
        fam, size, styles = [], None, []
        for p in f.replace("{", " ").replace("}", " ").split():
            if size is None and re.fullmatch(r"-?\d+", p):
                size = int(p)
            elif size is None:
                fam.append(p)
            else:
                styles.append(p)
        return _fd(" ".join(fam) or "TkDefaultFont", size, styles)
    seq = list(f)
    return _fd(seq[0] if seq else "TkDefaultFont", seq[1] if len(seq) > 1 else None, " ".join(str(x) for x in seq[2:]))


def _jv(v):
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (list, tuple)):
        return [_jv(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _jv(x) for k, x in v.items()}
    return str(v)


class Font:
    def __init__(self, root=None, font=None, name=None, exists=False, **kw):
        self._d = {"family": "TkDefaultFont", "size": 10, "weight": "normal", "slant": "roman", "underline": 0, "overstrike": 0}
        if font is not None:
            f = _font(font)
            self._d.update(family=f["f"], size=-f["s"] if f["px"] else f["s"], weight="bold" if f["b"] else "normal",
                           slant="italic" if f["i"] else "roman", underline=int(f["u"]), overstrike=int(f["o"]))
        self._d.update(kw)

    def actual(self, option=None, **kw):
        return self._d[option] if option else dict(self._d)

    def cget(self, option):
        return self._d[option]

    __getitem__ = cget

    def configure(self, **kw):
        self._d.update(kw)
        _dirty()

    config = configure

    def copy(self):
        return Font(font=None, **self._d)

    def measure(self, text, displayof=None):
        return int(len(str(text)) * abs(self._d["size"]) * 0.62)

    def metrics(self, *opts, **kw):
        h = int(abs(self._d["size"]) * 1.6)
        d = {"ascent": int(h * 0.8), "descent": int(h * 0.2), "linespace": h, "fixed": 0}
        return d[opts[0]] if opts else d


# ------------------------------------------------------------------ variables

class Variable:
    _default = ""

    def __init__(self, master=None, value=None, name=None):
        self._ws = []
        self._tr = []
        self._v = self._default if value is None else self._cast(value)

    def _cast(self, v):
        return v

    def get(self):
        return self._v

    def set(self, value, _src=None):
        self._v = self._cast(value)
        for w in self._ws:
            if w is not _src:
                w._rev += 1
        _dirty()
        for mode, f in list(self._tr):
            if mode.startswith("w"):
                _call(f, "PY_VAR", "", "write")

    initialize = set

    def trace_add(self, mode, callback):
        self._tr.append(((mode if isinstance(mode, str) else mode[0]), callback))
        return "trace%d" % len(self._tr)

    trace = trace_variable = trace_add

    def trace_remove(self, mode, cbname):
        pass

    def trace_vdelete(self, mode, cbname):
        pass

    def __str__(self):
        return str(self._v)


class StringVar(Variable):
    _default = ""

    def _cast(self, v):
        return str(v)


class IntVar(Variable):
    _default = 0

    def _cast(self, v):
        try:
            return int(v)
        except (TypeError, ValueError):
            return int(float(v))


class DoubleVar(Variable):
    _default = 0.0

    def _cast(self, v):
        return float(v)


class BooleanVar(Variable):
    _default = False

    def _cast(self, v):
        return v.strip().lower() in ("1", "true", "yes", "on") if isinstance(v, str) else bool(v)


# ------------------------------------------------------------------ events and bindings

class Event:
    def __init__(self, **kw):
        self.widget = None
        self.x = self.y = self.x_root = self.y_root = 0
        self.num = self.delta = self.keycode = self.state = self.width = self.height = 0
        self.char = self.keysym = self.type = ""
        self.__dict__.update(kw)

    def __repr__(self):
        return "<Event %s widget=%s x=%s y=%s keysym=%r>" % (self.type, self.widget, self.x, self.y, self.keysym)


_MODS = {"Control", "Shift", "Alt", "Lock", "Double", "Triple", "Any", "B1", "B2", "B3", "Button1", "Button2", "Button3", "Mod1", "Command", "Meta"}


def _parts(seq):
    parts = [p for p in seq.strip("<>").split("-") if p]
    mods = {p for p in parts if p in _MODS}
    rest = [p for p in parts if p not in _MODS]
    if rest and rest[0].isdigit():
        rest = ["Button", rest[0]]
    return mods, rest


def _seq_match(seq, e):
    if seq.startswith("<<"):
        return False
    mods, rest = _parts(seq)
    if not rest:
        return False
    typ, detail = rest[0], (rest[1] if len(rest) > 1 else None)
    k = e["k"]
    if ("Control" in mods and not e.get("ctrl")) or ("Shift" in mods and not e.get("shift")) or ("Alt" in mods and not e.get("alt")):
        return False
    if typ in ("Button", "ButtonPress"):
        return k == ("double" if "Double" in mods else "press") and (detail is None or str(e.get("num")) == detail)
    if typ == "ButtonRelease":
        return k == "release" and (detail is None or str(e.get("num")) == detail)
    if typ == "Motion":
        if k != "motion":
            return False
        for m, bit in (("B1", 1), ("B2", 2), ("B3", 4), ("Button1", 1), ("Button2", 2), ("Button3", 4)):
            if m in mods and not e.get("btn", 0) & bit:
                return False
        return True
    if typ in ("Enter", "Leave"):
        return k == typ.lower()
    if typ == "MouseWheel":
        return k == "wheel"
    if typ in ("Key", "KeyPress"):
        return k == "key" and (detail is None or e.get("keysym") == detail)
    if typ == "KeyRelease":
        return k == "keyup" and (detail is None or e.get("keysym") == detail)
    return k == "key" and e.get("keysym") == typ  # <Return>, <a>, <space>, <Up> ...


def _category(seq):
    if seq.startswith("<<"):
        return None
    mods, rest = _parts(seq)
    typ = rest[0] if rest else ""
    if typ in ("Button", "ButtonPress"):
        return "double" if "Double" in mods else "press"
    return {"ButtonRelease": "release", "Motion": "motion", "Enter": "enter", "Leave": "leave", "MouseWheel": "wheel",
            "KeyRelease": "keyup"}.get(typ, "key")


def _window(w):
    while w is not None and not isinstance(w, (Tk, Toplevel)):
        w = w.master
    return w


def _tags(w):
    out = [w]
    win = _window(w)
    if win is not None and win is not w:
        out.append(win)
    return out


def _call(f, *args):
    """Run a user callback the way tkinter does: an exception is printed and the program keeps going."""
    try:
        return f(*args)
    except _MainloopExit:
        raise
    except SystemExit:
        _destroy_all()
    except Exception as e:
        te = traceback.TracebackException.from_exception(e)
        me = _call.__code__.co_filename
        te.stack = traceback.StackSummary.from_list([fr for fr in te.stack if fr.filename != me])
        sys.stderr.write("Exception in Tkinter callback\n" + "".join(te.format()))


def _fire(w, e):
    ev = Event(widget=w, x=int(e.get("x", 0)), y=int(e.get("y", 0)), x_root=int(e.get("rx", 0)), y_root=int(e.get("ry", 0)),
               num=int(e.get("num", 0)), delta=int(e.get("delta", 0)), char=e.get("char", ""), keysym=e.get("keysym", ""),
               keycode=int(e.get("code", 0)), type={"press": "4", "release": "5", "key": "2", "keyup": "3", "motion": "6"}.get(e["k"], "0"))
    for tag in _tags(w):
        for seq, funcs in list(tag._binds.items()):
            if _seq_match(seq, e):
                for f in list(funcs):
                    if _call(f, ev) == "break":
                        return
    for seq, funcs in list(_ST["all"].items()):
        if _seq_match(seq, e):
            for f in list(funcs):
                if _call(f, ev) == "break":
                    return
    if isinstance(w, Canvas):
        w._fire_items(e, ev)


def _virtual(w, name):
    ev = Event(widget=w, type="35")
    for tag in _tags(w):
        for f in list(tag._binds.get(name, [])):
            _call(f, ev)


# ------------------------------------------------------------------ base widget

class Misc:
    _kind = "widget"
    _container = False
    _hidden = False  # not laid out by a geometry manager (windows, menus)

    def __init__(self, master=None, cnf=None, **kw):
        if master is None and not isinstance(self, (Tk, Menu)) and not _ST["roots"]:
            raise RuntimeError("Too early to create a widget: create the main window first, e.g. root = Tk()")
        if master is None and not isinstance(self, Tk):
            master = _ST["roots"][0] if _ST["roots"] else None
        self._id = next(_ids)
        _REG[self._id] = self
        self.master = master
        self._o, self._binds, self._kids, self._mgr = {}, {}, [], None
        self._cmd = self._tv = self._var = None
        self._rev, self._pack_n, self._alive = 0, 0, True
        self._cw = {"c": {}, "r": {}}
        self._protocols = {}
        self.children = {}
        if master is not None:
            master._kids.append(self)
            master.children["!%s%d" % (self._kind, self._id)] = self
        self._init_state()
        self._config(_opts(cnf, kw))
        _dirty()

    def _init_state(self):
        pass

    # --- options
    def _link(self, attr, var):
        old = getattr(self, attr)
        if old is not None and self in old._ws:
            old._ws.remove(self)
        setattr(self, attr, var)
        if var is not None:
            var._ws.append(self)

    def _config(self, o):
        for k, v in o.items():
            if k == "command":
                self._cmd = v
            elif k == "textvariable":
                self._link("_tv", v)
            elif k == "variable":
                self._link("_var", v)
            else:
                self._o[k] = v
        self._after_config(o)
        _dirty()

    def _after_config(self, o):
        pass

    def configure(self, cnf=None, **kw):
        if isinstance(cnf, str):
            return self.cget(cnf)
        self._config(_opts(cnf, kw))

    config = configure

    def cget(self, key):
        key = _ALIAS.get(key, key)
        if key == "command":
            return self._cmd
        if key == "textvariable":
            return self._tv
        if key == "variable":
            return self._var
        return self._o.get(key, "")

    __getitem__ = cget

    def __setitem__(self, key, value):
        self._config({_ALIAS.get(key, key): value})

    def keys(self):
        return list(self._o)

    def _pub(self):
        out = {}
        for k, v in self._o.items():
            if isinstance(v, (Variable, Misc)) or callable(v):
                continue
            if k in _COLORS:
                v = _color(v)
            elif k == "font":
                v = _font(v)
            elif k in ("padx", "pady"):
                v = _pair(v)[0]
            out[k] = _jv(v)
        if self._tv is not None and self._kind in ("label", "message", "button", "checkbutton", "radiobutton", "labelframe"):
            out["text"] = str(self._tv.get())
        return out

    def _extra(self):
        return {}

    def _node(self):
        d = {"id": self._id, "t": self._kind, "o": self._pub(), "r": self._rev}
        d.update(self._extra())
        if self._mgr:
            d["m"] = self._mgr
        if self._container:
            d["k"] = [k._node() for k in self._shown_kids()]
            d["cw"] = self._cw
        return d

    def _shown_kids(self):
        kids = [k for k in self._kids if k._alive and not k._hidden and k._mgr]
        return sorted(kids, key=lambda k: k._mgr["ord"] if k._mgr["k"] == "pack" else 0)

    # --- geometry managers
    def _master_check(self):
        if self.master is None:
            raise TclError("can't use a window with no parent as a slave: use root.mainloop() instead")

    def pack(self, cnf=None, **kw):
        self._master_check()
        o = _opts(cnf, kw)
        old = self._mgr if self._mgr and self._mgr["k"] == "pack" else {}
        m = {"k": "pack", "side": old.get("side", "top"), "fill": old.get("fill", "none"), "expand": old.get("expand", False),
             "padx": old.get("padx", [0, 0]), "pady": old.get("pady", [0, 0]), "ipadx": old.get("ipadx", 0), "ipady": old.get("ipady", 0),
             "anchor": old.get("anchor", "center"), "ord": old.get("ord")}
        for k, v in o.items():
            if k in ("side", "fill", "anchor"):
                m[k] = str(v)
            elif k == "expand":
                m[k] = (v.lower() in ("1", "yes", "true", "on")) if isinstance(v, str) else bool(v)
            elif k in ("padx", "pady"):
                m[k] = _pair(v)
            elif k in ("ipadx", "ipady"):
                m[k] = _num(v)
            elif k in ("in", "in_", "before", "after"):
                pass
            else:
                raise TclError('bad option "-%s"' % k)
        if m["ord"] is None:
            self.master._pack_n += 1
            m["ord"] = self.master._pack_n
        self._mgr = m
        _dirty()

    pack_configure = pack

    def pack_forget(self):
        self._mgr = None
        _dirty()

    forget = pack_forget

    def grid(self, cnf=None, **kw):
        self._master_check()
        o = _opts(cnf, kw)
        old = self._mgr if self._mgr and self._mgr["k"] == "grid" else {}
        used = [k._mgr["row"] + k._mgr["rowspan"] for k in self.master._kids if k is not self and k._mgr and k._mgr["k"] == "grid"]
        m = {"k": "grid", "row": old.get("row", max(used) if used else 0), "column": old.get("column", 0), "rowspan": old.get("rowspan", 1),
             "columnspan": old.get("columnspan", 1), "sticky": old.get("sticky", ""), "padx": old.get("padx", [0, 0]),
             "pady": old.get("pady", [0, 0]), "ipadx": old.get("ipadx", 0), "ipady": old.get("ipady", 0)}
        for k, v in o.items():
            if k in ("row", "column", "rowspan", "columnspan"):
                m[k] = int(v)
            elif k == "sticky":
                m[k] = str(v).lower()
            elif k in ("padx", "pady"):
                m[k] = _pair(v)
            elif k in ("ipadx", "ipady"):
                m[k] = _num(v)
            elif k in ("in", "in_"):
                pass
            else:
                raise TclError('bad option "-%s"' % k)
        self._mgr = m
        _dirty()

    grid_configure = grid

    def grid_forget(self):
        self._mgr = None
        _dirty()

    grid_remove = grid_forget

    def place(self, cnf=None, **kw):
        self._master_check()
        m = {"k": "place"}
        m.update({k: (str(v) if k == "anchor" else _num(v)) for k, v in _opts(cnf, kw).items() if k not in ("in", "in_", "bordermode")})
        self._mgr = m
        _dirty()

    place_configure = place

    def place_forget(self):
        self._mgr = None
        _dirty()

    def _axis(self, axis, index, kw):
        cfg = self._cw[axis].setdefault(str(index), {})
        for k in ("weight", "minsize", "pad"):
            if k in kw:
                cfg[k] = _num(kw[k])
        _dirty()

    def columnconfigure(self, index, cnf=None, **kw):
        for i in (index if isinstance(index, (list, tuple)) else [index]):
            self._axis("c", i, _opts(cnf, kw))

    def rowconfigure(self, index, cnf=None, **kw):
        for i in (index if isinstance(index, (list, tuple)) else [index]):
            self._axis("r", i, _opts(cnf, kw))

    grid_columnconfigure, grid_rowconfigure = columnconfigure, rowconfigure

    def grid_propagate(self, flag=None):
        pass

    pack_propagate = propagate = grid_propagate

    def grid_slaves(self, row=None, column=None):
        return [k for k in self._kids if k._mgr and k._mgr["k"] == "grid"]

    def pack_slaves(self):
        return [k for k in self._shown_kids() if k._mgr["k"] == "pack"]

    slaves = pack_slaves

    # --- events
    def bind(self, sequence=None, func=None, add=None):
        if sequence is None or func is None:
            return ""
        if add in ("+", True):
            self._binds.setdefault(sequence, []).append(func)
        else:
            self._binds[sequence] = [func]
        _dirty()
        return "bind%d" % id(func)

    def unbind(self, sequence, funcid=None):
        self._binds.pop(sequence, None)
        _dirty()

    def bind_all(self, sequence=None, func=None, add=None):
        if sequence is None or func is None:
            return ""
        if add in ("+", True):
            _ST["all"].setdefault(sequence, []).append(func)
        else:
            _ST["all"][sequence] = [func]
        _dirty()
        return "bind%d" % id(func)

    def unbind_all(self, sequence):
        _ST["all"].pop(sequence, None)
        _dirty()

    def focus_set(self):
        _ST["fn"] += 1
        _ST["focus"] = [self._id, _ST["fn"]]
        _dirty()

    focus = focus_force = focus_set

    # --- timers and the event loop
    def after(self, ms, func=None, *args):
        if func is None:
            time.sleep(_num(ms) / 1000)
            return None
        _ST["afterid"] += 1
        aid = "after#%d" % _ST["afterid"]
        _ST["after"].append([time.monotonic() * 1000 + max(0, _num(ms)), aid, func, args])
        return aid

    def after_idle(self, func, *args):
        return self.after(0, func, *args)

    def after_cancel(self, aid):
        _ST["after"][:] = [a for a in _ST["after"] if a[1] != aid]

    def update(self):
        _ST["shown"] = True
        _tick()
        if time.monotonic() - _ST["flushed"] > 0.016:  # a loop calling update() thousands of times shouldn't post a frame each time
            _flush()

    def update_idletasks(self):
        _ST["shown"] = True
        _flush()

    def mainloop(self, n=0):
        _ST["shown"] = True
        _flush()
        raise _MainloopExit()

    def quit(self):
        _destroy_all()

    def destroy(self):
        if not self._alive:
            return
        for k in list(self._kids):
            k.destroy()
        self._alive = False
        _REG.pop(self._id, None)
        if self.master is not None and self in self.master._kids:
            self.master._kids.remove(self)
        for v in (self._tv, self._var):
            if v is not None and self in v._ws:
                v._ws.remove(self)
        if self in _ST["roots"]:
            _ST["roots"].remove(self)
            if not _ST["roots"]:
                _ST["after"].clear()
        _dirty()

    # --- information (sizes are approximate: layout happens in the page)
    def _gsize(self):
        m = re.match(r"(\d+)x(\d+)", str(getattr(self, "_geom", "")))
        return (int(m.group(1)), int(m.group(2))) if m else (None, None)

    def winfo_width(self):
        return int(self._gsize()[0] or _num(self._o.get("width"), 200))

    def winfo_height(self):
        return int(self._gsize()[1] or _num(self._o.get("height"), 100))

    winfo_reqwidth, winfo_reqheight = winfo_width, winfo_height

    def winfo_screenwidth(self):
        return 1280

    def winfo_screenheight(self):
        return 720

    def winfo_exists(self):
        return int(self._alive)

    def winfo_children(self):
        return [k for k in self._kids if k._alive]

    def winfo_toplevel(self):
        return _window(self)

    def winfo_x(self):
        return 0

    winfo_y = winfo_rootx = winfo_rooty = winfo_pointerx = winfo_pointery = winfo_x

    def winfo_ismapped(self):
        return 1

    def winfo_class(self):
        return type(self).__name__

    def nametowidget(self, name):
        return next((w for w in _REG.values() if repr(w) == str(name)), self)

    def event_generate(self, sequence, **kw):
        if sequence.startswith("<<"):
            _virtual(self, sequence)

    def focus_get(self):
        return _REG.get(_ST["focus"][0]) if _ST["focus"] else None

    def option_add(self, *a, **k):
        pass

    def _noop(self, *a, **k):
        pass

    lift = lower = tkraise = iconbitmap = iconphoto = grab_set = grab_release = bell = clipboard_clear = clipboard_append = _noop
    focus_displayof = tk_focusNext = tk_setPalette = yview = xview = _noop

    def __repr__(self):
        return ".!%s%d" % (self._kind, self._id)


class _Window(Misc):
    _container = True
    _hidden = True

    def _init_state(self):
        _ST["roots"].append(self)
        self._geom = ""

    def title(self, string=None):
        if string is None:
            return self._o.get("title", "tk")
        self._o["title"] = str(string)
        _dirty()

    wm_title = title

    def geometry(self, newGeometry=None):
        if newGeometry is None:
            return self._geom or "%dx%d+0+0" % (self.winfo_width(), self.winfo_height())
        self._geom = str(newGeometry)
        _dirty()

    wm_geometry = geometry

    def resizable(self, width=None, height=None):
        if width is None:
            return (1, 1)
        self._o["resizable"] = [bool(width), bool(height if height is not None else width)]
        _dirty()

    wm_resizable = resizable

    def protocol(self, name=None, func=None):
        if func is not None:
            self._protocols[name] = func

    wm_protocol = protocol

    def minsize(self, width=None, height=None):
        self._o["minsize"] = [width, height]
        _dirty()

    maxsize = wm_minsize = wm_maxsize = minsize

    def attributes(self, *a, **k):
        pass

    wm_attributes = overrideredirect = state = iconify = attributes

    def withdraw(self):
        self._o["withdrawn"] = True
        _dirty()

    def deiconify(self):
        self._o["withdrawn"] = False
        _dirty()

    def _wnode(self):
        d = self._node()
        d["geom"] = self._geom
        d["menu"] = self._o["menu"]._menu_node() if isinstance(self._o.get("menu"), Menu) else None
        return d


class Tk(_Window):
    _kind = "tk"

    def __init__(self, screenName=None, baseName=None, className="Tk", useTk=1, **kw):
        super().__init__(None, None, **kw)
        self._o.setdefault("title", "tk")

    def report_callback_exception(self, exc, val, tb):
        pass


class Toplevel(_Window):
    _kind = "toplevel"

    def __init__(self, master=None, cnf=None, **kw):
        super().__init__(master, cnf, **kw)
        self._o.setdefault("title", "tk")


def Tcl(*a, **k):
    return Tk()


def mainloop(n=0):
    if _ST["roots"]:
        _ST["roots"][0].mainloop()


# ------------------------------------------------------------------ simple widgets

class Frame(Misc):
    _kind = "frame"
    _container = True


class LabelFrame(Frame):
    _kind = "labelframe"


class Label(Misc):
    _kind = "label"


class Message(Label):
    _kind = "message"


class Button(Misc):
    _kind = "button"

    def _click(self):
        if self._o.get("state") != "disabled" and self._cmd:
            _call(self._cmd)

    def invoke(self):
        self._click()

    def flash(self):
        pass

    def state(self, spec=None):
        if spec is not None:
            self._o["state"] = "disabled" if "disabled" in (spec if isinstance(spec, (list, tuple, str)) else []) else "normal"
            _dirty()

    def instate(self, spec, callback=None):
        return int(("disabled" in spec) == (self._o.get("state") == "disabled"))


class _Text(Misc):
    """An Entry-like widget: one string that the user can edit."""

    def _init_state(self):
        self._val = ""

    def _after_config(self, o):
        if "textvariable" in o and self._tv is not None:
            self._val = str(self._tv.get())

    def get(self):
        return str(self._tv.get()) if self._tv is not None else self._val

    def _setval(self, s):
        self._rev += 1
        if self._tv is not None:
            self._tv.set(s, _src=self)
        self._val = s
        _dirty()

    def _uivalue(self, v, sel=False):
        v = "" if v is None else str(v)
        if self._tv is not None:
            self._tv.set(v, _src=self)
        self._val = v
        if sel:
            _virtual(self, "<<ComboboxSelected>>")

    def _idx(self, i, n):
        if i in (END, "end", INSERT, "insert", "anchor", "sel.last"):
            return n
        return max(0, min(n, int(i)))

    def insert(self, index, string):
        s = self.get()
        i = self._idx(index, len(s))
        self._setval(s[:i] + str(string) + s[i:])

    def delete(self, first, last=None):
        s = self.get()
        a = self._idx(first, len(s))
        b = a + 1 if last is None else self._idx(last, len(s))
        self._setval(s[:a] + s[max(a, b):])

    def set(self, value):
        self._setval(str(value))

    def icursor(self, index):
        pass

    select_range = selection_range = select_clear = selection_clear = icursor

    def _extra(self):
        return {"v": self.get()}


class Entry(_Text):
    _kind = "entry"

    def get(self):
        return super().get()


class Spinbox(_Text):
    _kind = "spinbox"

    def _extra(self):
        d = super()._extra()
        v = self._o.get("values")
        if v:
            d["items"] = [str(x) for x in v]
        return d


class Combobox(_Text):
    _kind = "combobox"

    def _extra(self):
        d = super()._extra()
        d["items"] = [str(x) for x in (self._o.get("values") or [])]
        return d

    def current(self, index=None):
        vals = list(self._o.get("values") or [])
        if index is None:
            cur = self.get()
            return vals.index(cur) if cur in vals else -1
        self._setval(str(vals[index]))


class Text(Misc):
    _kind = "text"

    def _init_state(self):
        self._val = ""

    def _idx(self, index):
        s = self._val
        if index in (END, "end", INSERT, "insert", "sel.last"):
            return len(s)
        if index == "end-1c":
            return len(s)
        m = re.fullmatch(r"(\d+)\.(\d+|end)", str(index))
        if not m:
            return len(s)
        lines = s.split("\n")
        ln = max(1, min(len(lines), int(m.group(1))))
        col = len(lines[ln - 1]) if m.group(2) == "end" else min(int(m.group(2)), len(lines[ln - 1]))
        return sum(len(x) + 1 for x in lines[:ln - 1]) + col

    def get(self, start="1.0", end=None):
        a = self._idx(start)
        if end is None:
            return self._val[a:a + 1]
        b = self._idx(end)
        return self._val[a:b] + ("\n" if end in (END, "end") else "")

    def insert(self, index, chars, *tags):
        i = self._idx(index)
        self._val = self._val[:i] + str(chars) + self._val[i:]
        self._rev += 1
        _dirty()

    def delete(self, start, end=None):
        a = self._idx(start)
        b = a + 1 if end is None else self._idx(end)
        self._val = self._val[:a] + self._val[max(a, b):]
        self._rev += 1
        _dirty()

    def _uivalue(self, v, sel=False):
        self._val = "" if v is None else str(v)

    def _extra(self):
        return {"v": self._val}

    def _noop2(self, *a, **k):
        pass

    see = tag_configure = tag_add = tag_remove = tag_delete = mark_set = yview = xview = edit_reset = _noop2

    def index(self, i):
        s = self._val[:self._idx(i)]
        return "%d.%d" % (s.count("\n") + 1, len(s) - (s.rfind("\n") + 1))


class Checkbutton(Misc):
    _kind = "checkbutton"

    def _init_state(self):
        self._var = IntVar()
        self._var._ws.append(self)

    def _on(self):
        return self._o.get("onvalue", 1)

    def _off(self):
        return self._o.get("offvalue", 0)

    def _checked(self):
        return str(self._var.get()) == str(self._on())

    def _setchecked(self, on, src=None):
        self._var.set(self._on() if on else self._off(), _src=src)

    def select(self):
        self._setchecked(True)
        self._rev += 1

    def deselect(self):
        self._setchecked(False)
        self._rev += 1

    def toggle(self):
        self._setchecked(not self._checked())
        self._rev += 1

    def invoke(self):
        self.toggle()
        if self._cmd:
            _call(self._cmd)

    def _ui_check(self, on):
        self._setchecked(on, src=self)
        if self._cmd:
            _call(self._cmd)

    def _extra(self):
        return {"c": self._checked()}


class Radiobutton(Misc):
    _kind = "radiobutton"

    def _init_state(self):
        self._var = StringVar()
        self._var._ws.append(self)

    def _checked(self):
        return str(self._var.get()) == str(self._o.get("value", ""))

    def select(self):
        self._var.set(self._o.get("value", ""))
        self._rev += 1

    def invoke(self):
        self.select()
        if self._cmd:
            _call(self._cmd)

    def _ui_radio(self):
        self._var.set(self._o.get("value", ""), _src=self)
        if self._cmd:
            _call(self._cmd)

    def _extra(self):
        return {"c": self._checked(), "g": id(self._var) % 1000003}


class Scale(Misc):
    _kind = "scale"

    def _init_state(self):
        self._val, self._touched = 0, False

    def _after_config(self, o):
        if "variable" in o and self._var is not None:
            self._val = self._var.get()
        elif "from_" in o and not self._touched:
            self._val = _num(o["from_"])

    def get(self):
        v = _num(self._var.get() if self._var is not None else self._val)
        res = _num(self._o.get("resolution"), 1)
        return int(v) if res == int(res) else v

    def set(self, value):
        self._touched = True
        self._val = _num(value)
        if self._var is not None:
            self._var.set(self._val, _src=None)
        self._rev += 1
        _dirty()

    def _uivalue(self, v, sel=False):
        self._touched = True
        v = _num(v)
        res = _num(self._o.get("resolution"), 1)
        v = int(v) if res == int(res) else v
        self._val = v
        if self._var is not None:
            self._var.set(v, _src=self)
        if self._cmd:
            _call(self._cmd, str(v))

    def _extra(self):
        return {"v": self.get()}


class Listbox(Misc):
    _kind = "listbox"

    def _init_state(self):
        self._items, self._sel = [], []

    def insert(self, index, *elements):
        i = len(self._items) if index in (END, "end") else max(0, min(len(self._items), int(index)))
        self._items[i:i] = [str(e) for e in elements]
        self._sel = [s if s < i else s + len(elements) for s in self._sel]
        self._rev += 1
        _dirty()

    def delete(self, first, last=None):
        n = len(self._items)
        a = n if first in (END, "end") else int(first)
        b = a if last is None else (n - 1 if last in (END, "end") else int(last))
        del self._items[a:b + 1]
        self._sel = [s for s in self._sel if s < len(self._items)]
        self._rev += 1
        _dirty()

    def get(self, first, last=None):
        n = len(self._items)
        a = n - 1 if first in (END, "end") else int(first)
        if last is None:
            return self._items[a] if 0 <= a < n else ""
        b = n - 1 if last in (END, "end") else int(last)
        return tuple(self._items[a:b + 1])

    def size(self):
        return len(self._items)

    def curselection(self):
        return tuple(sorted(self._sel))

    def selection_set(self, first, last=None):
        a = int(first)
        b = a if last is None else int(last)
        self._sel = sorted(set(self._sel + list(range(a, b + 1))) if self._o.get("selectmode") in ("multiple", "extended") else {a})
        self._rev += 1
        _dirty()

    select_set = selection_set

    def selection_clear(self, first=None, last=None):
        self._sel = []
        self._rev += 1
        _dirty()

    select_clear = selection_clear

    def _ui_sel(self, sel):
        self._sel = [int(i) for i in sel]
        _virtual(self, "<<ListboxSelect>>")

    def _extra(self):
        return {"items": self._items, "sel": self._sel}

    def _noop2(self, *a, **k):
        pass

    see = activate = yview = xview = _noop2


class Scrollbar(Misc):
    _kind = "scrollbar"

    def set(self, *a):
        pass


class Progressbar(Misc):
    _kind = "progressbar"

    def _init_state(self):
        self._o["value"] = 0

    def step(self, amount=1.0):
        self._o["value"] = _num(self._o.get("value")) + _num(amount)
        _dirty()

    def start(self, interval=None):
        pass

    stop = start

    def _extra(self):
        return {"v": _num(self._o.get("value")), "max": _num(self._o.get("maximum"), 100)}


class Separator(Misc):
    _kind = "separator"


class OptionMenu(Misc):
    _kind = "optionmenu"

    def __init__(self, master, variable, value, *values, command=None):
        super().__init__(master)
        self._link("_var", variable)
        self._o["values"] = [value] + list(values)
        self._cmd = command
        if not str(variable.get()) and value is not None:
            variable.set(value)

    def _uivalue(self, v, sel=False):
        self._var.set(v, _src=self)
        if self._cmd:
            _call(self._cmd, v)

    def _extra(self):
        return {"v": str(self._var.get()), "items": [str(x) for x in self._o["values"]]}


class PhotoImage:
    def __init__(self, *a, **k):
        raise TclError("images aren't supported in this editor")


BitmapImage = PhotoImage


class Style:
    def __init__(self, master=None):
        pass

    def configure(self, *a, **k):
        pass

    map = layout = theme_use = theme_create = configure

    def theme_names(self):
        return ("default",)


# ------------------------------------------------------------------ canvas

def _flat(args):
    out = []
    for a in args:
        if isinstance(a, (list, tuple)):
            out.extend(_flat(a))
        else:
            out.append(float(a))
    return out


class Canvas(Misc):
    _kind = "canvas"

    def _init_state(self):
        self._items, self._next, self._tagb = [], 0, []

    def _add(self, t, args, kw):
        co = _flat([a for a in args if not isinstance(a, str)])
        o = {k: v for k, v in kw.items() if k != "tags"}
        tags = kw.get("tags", ())
        self._next += 1
        self._items.append({"id": self._next, "t": t, "c": co, "o": o, "tags": [tags] if isinstance(tags, str) else list(tags)})
        self._rev += 1
        _dirty()
        return self._next

    def create_line(self, *a, **kw):
        return self._add("line", a, _opts(None, kw))

    def create_rectangle(self, *a, **kw):
        return self._add("rectangle", a, _opts(None, kw))

    def create_oval(self, *a, **kw):
        return self._add("oval", a, _opts(None, kw))

    def create_polygon(self, *a, **kw):
        return self._add("polygon", a, _opts(None, kw))

    def create_arc(self, *a, **kw):
        return self._add("arc", a, _opts(None, kw))

    def create_text(self, *a, **kw):
        return self._add("text", a, _opts(None, kw))

    def create_image(self, *a, **kw):
        raise TclError("images aren't supported in this editor")

    create_window = create_bitmap = create_image

    def _find(self, spec):
        if isinstance(spec, int) or (isinstance(spec, str) and spec.isdigit()):
            return [i for i in self._items if i["id"] == int(spec)]
        if spec in (ALL, "all"):
            return list(self._items)
        return [i for i in self._items if spec in i["tags"]]

    def delete(self, *specs):
        gone = {id(i) for s in specs for i in self._find(s)}
        self._items = [i for i in self._items if id(i) not in gone]
        self._rev += 1
        _dirty()

    def move(self, spec, dx, dy):
        for i in self._find(spec):
            i["c"] = [v + (dx if n % 2 == 0 else dy) for n, v in enumerate(i["c"])]
        self._rev += 1
        _dirty()

    def coords(self, spec, *new):
        found = self._find(spec)
        if not found:
            return []
        if new:
            found[0]["c"] = _flat(new)
            self._rev += 1
            _dirty()
        return list(found[0]["c"])

    def itemconfigure(self, spec, cnf=None, **kw):
        o = _opts(cnf, kw)
        for i in self._find(spec):
            if "tags" in o:
                t = o["tags"]
                i["tags"] = [t] if isinstance(t, str) else list(t)
            i["o"].update({k: v for k, v in o.items() if k != "tags"})
        self._rev += 1
        _dirty()

    itemconfig = itemconfigure

    def itemcget(self, spec, option):
        f = self._find(spec)
        return f[0]["o"].get(option, "") if f else ""

    def addtag_withtag(self, tag, spec):
        for i in self._find(spec):
            i["tags"].append(tag)

    def dtag(self, spec, tag=None):
        for i in self._find(spec):
            i["tags"] = [t for t in i["tags"] if t != (tag or spec)]

    def gettags(self, spec):
        f = self._find(spec)
        return tuple(f[0]["tags"]) if f else ()

    def find_withtag(self, spec):
        return tuple(i["id"] for i in self._find(spec))

    def find_all(self):
        return tuple(i["id"] for i in self._items)

    def _bbox(self, i):
        c = i["c"]
        if i["t"] == "text":
            s = _font(i["o"].get("font"))
            size = s["s"] if s else 10
            w, h = len(str(i["o"].get("text", ""))) * size * 0.6, size * 1.3
            return (c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2)
        xs, ys = c[0::2], c[1::2]
        pad = _num(i["o"].get("width"), 1) / 2 if i["t"] == "line" else 0
        return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)

    def bbox(self, *specs):
        boxes = [self._bbox(i) for s in specs for i in self._find(s) if i["c"]]
        if not boxes:
            return None
        return tuple(int(v) for v in (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)))

    def find_overlapping(self, x1, y1, x2, y2):
        x1, x2, y1, y2 = min(x1, x2), max(x1, x2), min(y1, y2), max(y1, y2)
        out = []
        for i in self._items:
            if i["c"]:
                a, b, c, d = self._bbox(i)
                if a <= x2 and c >= x1 and b <= y2 and d >= y1:
                    out.append(i["id"])
        return tuple(out)

    def find_enclosed(self, x1, y1, x2, y2):
        out = []
        for i in self._items:
            if i["c"]:
                a, b, c, d = self._bbox(i)
                if a >= x1 and c <= x2 and b >= y1 and d <= y2:
                    out.append(i["id"])
        return tuple(out)

    def find_closest(self, x, y):
        best = self.find_overlapping(x, y, x, y)
        return (best[-1],) if best else ((self._items[-1]["id"],) if self._items else ())

    def tag_raise(self, spec, above=None):
        sel = self._find(spec)
        self._items = [i for i in self._items if i not in sel] + sel
        self._rev += 1
        _dirty()

    def tag_lower(self, spec, below=None):
        sel = self._find(spec)
        self._items = sel + [i for i in self._items if i not in sel]
        self._rev += 1
        _dirty()

    lift = tag_raise
    lower = tag_lower

    def tag_bind(self, spec, sequence=None, func=None, add=None):
        if sequence and func:
            self._tagb.append((spec, sequence, func))
            _dirty()

    def _fire_items(self, e, ev):
        if not self._tagb or e["k"] not in ("press", "release", "double", "motion"):
            return
        x, y = ev.x, ev.y
        hit = [i for i in self._items if i["c"] and (lambda b: b[0] <= x <= b[2] and b[1] <= y <= b[3])(self._bbox(i))]
        if not hit:
            return
        top = hit[-1]
        for spec, seq, f in list(self._tagb):
            if (spec == top["id"] or spec in top["tags"]) and _seq_match(seq, e):
                _call(f, ev)

    def _extra(self):
        out = []
        for i in self._items:
            o = {}
            for k, v in i["o"].items():
                if isinstance(v, (Variable, Misc)) or callable(v):
                    continue
                o[k] = _color(v) if k in ("fill", "outline", "activefill") else _font(v) if k == "font" else _jv(v)
            out.append({"id": i["id"], "t": i["t"], "c": i["c"], "o": o})
        return {"items": out}


# ------------------------------------------------------------------ menus

class Menu(Misc):
    _kind = "menu"
    _hidden = True

    def _init_state(self):
        self._entries = []

    def _add(self, kind, **kw):
        self._entries.append(dict(kind=kind, **kw))
        _dirty()

    def add_command(self, label="", command=None, **kw):
        self._add("command", label=label, command=command, accelerator=kw.get("accelerator", ""))

    def add_cascade(self, label="", menu=None, **kw):
        self._add("cascade", label=label, menu=menu)

    def add_separator(self, **kw):
        self._add("separator")

    def add_checkbutton(self, label="", variable=None, command=None, onvalue=1, offvalue=0, **kw):
        self._add("check", label=label, var=variable or IntVar(), command=command, on=onvalue, off=offvalue)

    def add_radiobutton(self, label="", variable=None, value=None, command=None, **kw):
        self._add("radio", label=label, var=variable or StringVar(), value=value, command=command)

    def add(self, kind, **kw):
        {"command": self.add_command, "cascade": self.add_cascade, "separator": self.add_separator,
         "checkbutton": self.add_checkbutton, "radiobutton": self.add_radiobutton}[kind](**kw)

    def delete(self, first, last=None):
        a = 0 if first in (0, "0") else int(first)
        b = len(self._entries) - 1 if last in (END, "end") else (a if last is None else int(last))
        del self._entries[a:b + 1]
        _dirty()

    def entryconfigure(self, index, **kw):
        pass

    entryconfig = entryconfigure

    def post(self, *a):
        pass

    tk_popup = post

    def _menu_node(self):
        items = []
        for n, e in enumerate(self._entries):
            d = {"k": e["kind"], "label": e.get("label", ""), "id": "%d:%d" % (self._id, n), "acc": e.get("accelerator", "")}
            if e["kind"] == "cascade" and isinstance(e.get("menu"), Menu):
                d["items"] = e["menu"]._menu_node()["items"]
            elif e["kind"] == "check":
                d["c"] = str(e["var"].get()) == str(e["on"])
            elif e["kind"] == "radio":
                d["c"] = str(e["var"].get()) == str(e["value"])
            items.append(d)
        return {"items": items}

    def _invoke(self, n):
        e = self._entries[n]
        if e["kind"] == "check":
            e["var"].set(e["off"] if str(e["var"].get()) == str(e["on"]) else e["on"])
        elif e["kind"] == "radio":
            e["var"].set(e["value"])
        if e.get("command"):
            _call(e["command"])


# ------------------------------------------------------------------ the event loop, driven by the page

def _tick():
    now = time.monotonic() * 1000
    due = sorted([a for a in _ST["after"] if a[0] <= now], key=lambda a: a[0])
    for a in due:
        if a in _ST["after"]:
            _ST["after"].remove(a)
            _call(a[2], *a[3])


def _next():
    if not _ST["after"] or not any(r._alive for r in _ST["roots"]):
        return None
    return max(0, int(min(a[0] for a in _ST["after"]) - time.monotonic() * 1000))


def _wants():
    seqs = list(_ST["all"])
    for w in _REG.values():
        seqs.extend(w._binds)
        if isinstance(w, Canvas):
            seqs.extend(s for _, s, _ in w._tagb)
    return sorted({c for c in (_category(s) for s in seqs) if c})


def _snapshot():
    out = {"wins": [r._wnode() for r in _ST["roots"] if r._alive], "dialogs": _ST["dialogs"][:], "wants": _wants(), "focus": _ST["focus"]}
    _ST["dirty"] = False
    _ST["dialogs"].clear()
    return out


def _flush():
    if (_ST["dirty"] or _ST["dialogs"]) and _ST["post"] and (_ST["shown"] or _ST["dialogs"]):
        _ST["flushed"] = time.monotonic()
        _ST["post"](json.dumps(_snapshot()))


def _destroy_all():
    for r in list(_ST["roots"]):
        r.destroy()


def _menu_click(path):
    mid, _, n = str(path).partition(":")
    m = _REG.get(int(mid))
    if isinstance(m, Menu):
        m._invoke(int(n))


def dispatch(ev):
    t = ev.get("t")
    w = _REG.get(ev.get("id"))
    if t == "menu":
        return _menu_click(ev.get("m"))
    if w is None or not w._alive:
        return
    if t == "close":
        f = w._protocols.get("WM_DELETE_WINDOW")
        _call(f) if f else w.destroy()
    elif t == "click" and hasattr(w, "_click"):
        w._click()
    elif t == "value" and hasattr(w, "_uivalue"):
        w._uivalue(ev.get("v"), ev.get("sel"))
    elif t == "check" and hasattr(w, "_ui_check"):
        w._ui_check(bool(ev.get("v")))
    elif t == "radio" and hasattr(w, "_ui_radio"):
        w._ui_radio()
    elif t == "sel" and hasattr(w, "_ui_sel"):
        w._ui_sel(ev.get("sel") or [])
    elif t == "ev":
        _fire(w, ev)


def tick():
    _tick()


def pump():
    out = {"alive": bool([r for r in _ST["roots"] if r._alive]) and _ST["shown"], "next": _next()}
    if (_ST["dirty"] or _ST["dialogs"]) and (_ST["shown"] or _ST["dialogs"]):
        out["tree"] = _snapshot()
    return out


def active():  # a window that was shown stays open after the script ended (like IDLE / Thonny), until closed or the next run
    return _ST["shown"] and any(r._alive for r in _ST["roots"])


def finish():  # the script ended and no window was ever shown: drop the unused windows, but still show pending dialogs
    _destroy_all()
    _flush()


def reset():
    for r in _ST["roots"]:
        r._alive = False  # libraries that keep a window around between runs (turtle's Screen) must see that it is gone
    _ST["roots"].clear()
    _ST["after"].clear()
    _ST["dialogs"].clear()
    _ST["all"].clear()
    _ST["notes"].clear()
    _ST.update(dirty=False, focus=None, shown=False)
    _REG.clear()


def set_post(f):
    _ST["post"] = f


# ------------------------------------------------------------------ dialogs (they can't wait for a click, so they answer at once)

def _note(what, answer):
    if what not in _ST["notes"]:
        _ST["notes"].add(what)
        print("(note: %s can't wait for a click in this editor, so it answered %r)" % (what, answer))


def _dialog(kind, title, message):
    _ST["dialogs"].append({"k": kind, "title": str(title or ""), "msg": str(message or "")})
    _dirty()


def _mb(kind, answer=None):
    def f(title=None, message=None, **kw):
        _dialog(kind, title, message)
        if answer is not None:
            _note("a question dialog", answer)
        return answer if answer is not None else "ok"
    return f


def _ask_none(name):
    def f(title=None, prompt=None, **kw):
        _dialog("ask", title, prompt)
        _note(name + "()", None)
        return None
    return f


def install():
    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        sys.modules[name] = m
        return m

    ns = globals()
    skip = {"install", "dispatch", "tick", "pump", "active", "finish", "reset", "set_post"}
    public = {k: v for k, v in ns.items() if not k.startswith("_") and k not in skip and not isinstance(v, types.ModuleType)}
    only_ttk = {"Combobox", "Progressbar", "Separator", "Style", "Font"}
    mb = mod("tkinter.messagebox", showinfo=_mb("info"), showwarning=_mb("warning"), showerror=_mb("error"), askquestion=_mb("question", "yes"),
             askokcancel=_mb("question", True), askyesno=_mb("question", True), askyesnocancel=_mb("question", True),
             askretrycancel=_mb("question", True), OK="ok", YES="yes", NO="no", CANCEL="cancel", RETRY="retry", ERROR="error", INFO="info")
    sd = mod("tkinter.simpledialog", askstring=_ask_none("askstring"), askinteger=_ask_none("askinteger"), askfloat=_ask_none("askfloat"))
    ft = mod("tkinter.font", Font=Font, NORMAL="normal", BOLD="bold", ITALIC="italic", ROMAN="roman",
             families=lambda root=None: ("Arial", "Courier New", "Times New Roman", "Verdana"), nametofont=lambda name: Font(), names=lambda: ())
    ttk_names = ("Button", "Label", "Entry", "Frame", "LabelFrame", "Checkbutton", "Radiobutton", "Scale", "Spinbox", "Scrollbar", "Style",
                 "Combobox", "Progressbar", "Separator", "Menubutton", "Labelframe")
    ttk = mod("tkinter.ttk", **{k: public[k] for k in ttk_names if k in public}, Labelframe=LabelFrame, Menubutton=Button)
    cn = mod("tkinter.constants", **{k: v for k, v in public.items() if k.isupper()})
    subs = {"messagebox": mb, "simpledialog": sd, "font": ft, "ttk": ttk, "constants": cn}
    tkpub = {k: v for k, v in public.items() if k not in only_ttk}
    tkpub["Menubutton"] = Button

    def getattr_(name):  # from tkinter import messagebox / ttk ...
        if name in subs:
            return subs[name]
        raise AttributeError("module 'tkinter' has no attribute %r" % name)

    tk = mod("tkinter", __getattr__=getattr_, __path__=[], **tkpub)
    tk.__all__ = sorted(tkpub)
    sys.modules["_tkinter"] = mod("_tkinter", TclError=TclError)


# What runner.py needs from a GUI library (docs/ADDING_A_LIBRARY.md): it drives the window's life after run() returned.
gui_hooks = {"reset": reset, "finish": finish, "active": active, "dispatch": dispatch, "tick": tick, "pump": pump,
             "set_post": set_post, "exit": _MainloopExit}
