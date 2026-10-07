"""turtle library. Built on this editor's tkinter (libs/tkinter): the turtle draws on a Canvas inside a Tk window, so it
needs no renderer of its own. Covers the everyday API (movement, pen, colours, fill, circle/dot/stamp/write, shapes, Screen
settings, key/click/timer events, the module-level functions). Not supported: undo, turtle.onclick/ondrag, custom shapes
and images, setworldcoordinates, tilt.

How it works. The first Turtle() (or any module-level call such as turtle.forward) creates one shared _Screen: a tkinter Tk window
holding a 720x540 Canvas. Turtle coordinates have their origin in the middle with y pointing up; _Screen._pt() converts them to
canvas pixels. A turtle is one polygon on the canvas (redrawn after every move) plus the lines, dots, stamps and text it left
behind. Animation is real: each step draws, calls canvas.update() (which posts a frame to the page) and sleeps for the speed's
delay; tracer(0) turns that off until update(). turtle.done() / mainloop() is tkinter's mainloop, so the script ends there and the
window stays open. The module-level functions (turtle.forward ...) are generated at the bottom: they call a default turtle."""
import math
import sys
import time
import types

import tkinter as tk
from tkinter import simpledialog

SHAPES = {  # drawn facing "up" (+y); the turtle's heading rotates them
    "classic": [(0, 0), (-5, -9), (0, -7), (5, -9)],
    "arrow": [(-10, 0), (10, 0), (0, 10)],
    "turtle": [(0, 16), (-2, 14), (-1, 10), (-4, 7), (-7, 9), (-9, 8), (-6, 5), (-7, 1), (-5, -3), (-8, -6), (-6, -8), (-4, -5),
               (0, -7), (4, -5), (6, -8), (8, -6), (5, -3), (7, 1), (6, 5), (9, 8), (7, 9), (4, 7), (1, 10), (2, 14)],
    "circle": [(10 * math.cos(a * math.pi / 10), 10 * math.sin(a * math.pi / 10)) for a in range(20)],
    "square": [(10, -10), (10, 10), (-10, 10), (-10, -10)],
    "triangle": [(10, -5.77), (0, 11.55), (-10, -5.77)],
}
# named speeds -> the numbers 0-10 (0 = no animation, 1 = slowest, 10 = fast)
SPEEDS = {"fastest": 0, "fast": 10, "normal": 6, "slow": 3, "slowest": 1}


class TurtleGraphicsError(Exception):  # e.g. an unknown shape name, as in the real module
    pass


class Terminator(Exception):  # the real module raises this when its window is closed; kept so `except turtle.Terminator` works
    pass


class Vec2D(tuple):
    """A 2-D vector, a tuple subclass like the real one: v + w, v - w, v * number, v * w (dot product), abs(v), v.rotate(angle)."""

    def __new__(cls, x, y):
        return tuple.__new__(cls, (x, y))

    def __add__(self, o):
        return Vec2D(self[0] + o[0], self[1] + o[1])

    def __sub__(self, o):
        return Vec2D(self[0] - o[0], self[1] - o[1])

    def __mul__(self, o):  # vector * vector = dot product, vector * number = scaled vector
        return self[0] * o[0] + self[1] * o[1] if isinstance(o, tuple) else Vec2D(self[0] * o, self[1] * o)

    def __rmul__(self, k):
        return Vec2D(self[0] * k, self[1] * k) if isinstance(k, (int, float)) else NotImplemented

    def __neg__(self):
        return Vec2D(-self[0], -self[1])

    def __abs__(self):
        return math.hypot(self[0], self[1])

    def rotate(self, angle):
        a = math.radians(angle)
        return Vec2D(self[0] * math.cos(a) - self[1] * math.sin(a), self[0] * math.sin(a) + self[1] * math.cos(a))

    def __repr__(self):
        return "(%.2f,%.2f)" % self


def _color(args, mode):
    """Colour arguments -> something a canvas understands: a name, '#rrggbb', or r, g, b (0-1 or 0-255 by colormode)."""
    if len(args) == 1 and isinstance(args[0], (tuple, list)):
        args = tuple(args[0])
    if len(args) == 1:
        return args[0]
    r, g, b = (round(v * 255) if mode == 1.0 else int(v) for v in args)
    return "#%02x%02x%02x" % (r, g, b)


# ponytail: a drawing is a list of Canvas items and the whole list is re-sent on every flush; fine for thousands of
# segments, switch to incremental updates in libs/tkinter if huge drawings lag.
class _Screen:
    """The one window every turtle draws on. bye() (also the window's x button) forgets it, so the next Turtle() builds a new one."""

    _inst = None

    def __init__(self):
        self._root = tk.Tk()
        self._root.title("Python Turtle Graphics")
        self._w, self._h = 720, 540
        self._cv = tk.Canvas(self._root, width=self._w, height=self._h, bg="white", highlightthickness=0)
        self._cv.pack()
        self._root.protocol("WM_DELETE_WINDOW", self.bye)
        self._bg, self._tracing, self._delayv, self._count, self._mode, self._turtles = "white", 1, 10, 0, 1.0, []

    def _pt(self, x, y):
        """Turtle coordinates (origin in the middle, y up) -> canvas pixels (origin top-left, y down)."""
        return self._w / 2 + x, self._h / 2 - y

    def bgcolor(self, *args):
        if not args:
            return self._bg
        self._bg = _color(args, self._mode)
        self._cv.config(bg=self._bg)

    def title(self, t):
        self._root.title(t)

    def setup(self, width=0.5, height=0.75, startx=None, starty=None):  # fractions of a 1280x720 screen, or pixels
        self._w = int(1280 * width) if width <= 1 else int(width)
        self._h = int(720 * height) if height <= 1 else int(height)
        self._cv.config(width=self._w, height=self._h)

    def screensize(self, canvwidth=None, canvheight=None, bg=None):
        if canvwidth is None and canvheight is None and bg is None:
            return self._w, self._h
        self.setup(canvwidth or self._w, canvheight or self._h)
        if bg:
            self.bgcolor(bg)

    def window_width(self):
        return self._w

    def window_height(self):
        return self._h

    def tracer(self, n=None, delay=None):  # tracer(0): no animation until you call update()
        if n is None:
            return self._tracing
        self._tracing, self._count = int(n), 0
        if delay is not None:
            self._delayv = delay

    def update(self):
        self._cv.update()

    def delay(self, delay=None):
        if delay is None:
            return self._delayv
        self._delayv = delay

    def colormode(self, cmode=None):
        if cmode is None:
            return self._mode
        self._mode = float(cmode)

    def listen(self, xdummy=None, ydummy=None):
        self._cv.focus_set()

    def _key(self, seq, fun):
        if fun is None:
            self._root.unbind(seq)
        else:
            self._root.bind(seq, lambda e: fun())

    def onkey(self, fun, key):
        self._key("<KeyRelease-%s>" % key, fun)

    onkeyrelease = onkey

    def onkeypress(self, fun, key=None):
        self._key("<KeyPress-%s>" % key if key else "<KeyPress>", fun)

    def onscreenclick(self, fun, btn=1, add=None):
        if fun is None:
            self._cv.unbind("<Button-%d>" % btn)
        else:
            self._cv.bind("<Button-%d>" % btn, lambda e: fun(e.x - self._w / 2, self._h / 2 - e.y))

    onclick = onscreenclick

    def ontimer(self, fun, t=0):
        self._root.after(int(t), fun)

    def mainloop(self):  # tkinter's mainloop ends the script here; the window stays open
        tk.mainloop()

    def exitonclick(self):
        self.onclick(lambda x, y: self.bye())
        self.mainloop()

    def bye(self):
        _Screen._inst = None
        self._root.destroy()

    def clearscreen(self):
        self._cv.delete("all")
        for t in self._turtles:
            t._forget()
            t._draw_turtle()

    def resetscreen(self):
        self.clearscreen()
        for t in self._turtles:
            t.reset()

    def textinput(self, title, prompt):
        return simpledialog.askstring(title, prompt)

    def numinput(self, title, prompt, default=None, minval=None, maxval=None):
        return simpledialog.askfloat(title, prompt)

    def getcanvas(self):
        return self._cv

    def turtles(self):
        return list(self._turtles)

    def mode(self, mode=None):
        return "standard"


def Screen():
    """The shared window. Created on first use, and created again if the old one was closed (x button, bye(), or a new run)."""
    if _Screen._inst is None or not _Screen._inst._root.winfo_exists():
        _Screen._inst = _Screen()
    return _Screen._inst


TurtleScreen = Screen


class Turtle:
    """One turtle. State: _pos (a Vec2D), _h (heading in degrees, 0 = east, counter-clockwise), pen up/down, colours, size, speed,
    shape. Everything it draws is remembered in _items / _stamps so clear() removes only its own drawing."""

    def __init__(self, shape="classic", undobuffersize=1000, visible=True):
        self.screen = Screen()
        self.screen._turtles.append(self)
        self._item = None
        self._full = 360.0
        self._defaults(shape, visible)
        self._forget()
        self._draw_turtle()

    def _defaults(self, shape="classic", visible=True):
        self._pos, self._h = Vec2D(0.0, 0.0), 0.0  # heading in degrees, counter-clockwise from east
        self._down, self._pc, self._fc, self._size, self._speed = True, "black", "black", 1, 3
        self._shape, self._visible, self._stretch, self._outline = shape, visible, (1.0, 1.0), None
        if shape not in SHAPES:
            raise TurtleGraphicsError("There is no shape named %s" % shape)

    def _forget(self):  # drop what this turtle drew (the screen has already deleted the canvas items on a clearscreen)
        self._items, self._stamps, self._fillitem, self._fillpts, self._item = [], {}, None, [], None

    # --- drawing machinery
    def _draw_turtle(self):
        cv = self.screen._cv
        if not self._visible:
            if self._item is not None:
                cv.delete(self._item)
                self._item = None
            return
        pts = self._shape_pts()
        if self._item is None:
            self._item = cv.create_polygon(*pts, fill=self._fc, outline=self._pc, width=self._outline or self._size)
        else:
            cv.coords(self._item, *pts)
            cv.itemconfigure(self._item, fill=self._fc, outline=self._pc, width=self._outline or self._size)

    def _shape_pts(self, pos=None):  # the shape, stretched, rotated to the heading and moved to the position, in canvas coordinates
        px, py = pos or self._pos
        e0, e1 = math.cos(math.radians(self._h)), math.sin(math.radians(self._h))
        sw, sl = self._stretch
        out = []
        for x, y in SHAPES[self._shape]:
            x, y = x * sw, y * sl
            out.extend(self.screen._pt(px + e1 * x + e0 * y, py - e0 * x + e1 * y))
        return out

    def _frame(self):  # one animation frame: show it, then wait (unless speed is 0)
        scr = self.screen
        if scr._tracing <= 0:
            return
        scr._count += 1
        if scr._count % scr._tracing == 0:
            scr._cv.update()
            if self._speed:
                time.sleep(scr._delayv / 1000)

    def _above(self):  # the turtle and any open fill stay on top of newer lines
        if self._item is not None:
            self.screen._cv.tag_raise(self._item)

    def _goto(self, x, y):
        """Move to (x, y), drawing a line if the pen is down. A turtle with a speed moves in small hops with one animation frame each."""
        scr = self.screen
        x0, y0 = self._pos
        dist = math.hypot(x - x0, y - y0)
        line = None
        if self._down and dist:
            line = scr._cv.create_line(*scr._pt(x0, y0), *scr._pt(x0, y0), fill=self._pc, width=self._size, capstyle="round")
            self._items.append(line)
            self._above()
        hops = 1 + int(dist / (3 * self._speed)) if self._speed and scr._tracing and dist else 1  # same pacing as real turtle
        for i in range(1, hops + 1):
            self._pos = Vec2D(x0 + (x - x0) * i / hops, y0 + (y - y0) * i / hops)
            if line:
                scr._cv.coords(line, *scr._pt(x0, y0), *scr._pt(*self._pos))
            self._draw_turtle()
            self._frame()
        if self._fillitem is not None:
            self._fillpts.append(self._pos)
            scr._cv.coords(self._fillitem, *[v for p in self._fillpts for v in scr._pt(*p)])

    def _turn(self, deg, animate=True):
        """Rotate by deg degrees (positive = counter-clockwise), animated in small steps unless animate is False."""
        hops = 1 + int(abs(deg) / (3 * self._speed)) if animate and self._speed and self.screen._tracing else 1
        for _ in range(hops):
            self._h = (self._h + deg / hops) % 360
            self._draw_turtle()
            self._frame()

    def _deg(self, angle):  # angle in the current units (degrees or radians) -> degrees
        return angle * 360.0 / self._full

    # --- movement
    def forward(self, distance):
        a = math.radians(self._h)
        self._goto(self._pos[0] + distance * math.cos(a), self._pos[1] + distance * math.sin(a))

    def back(self, distance):
        self.forward(-distance)

    def right(self, angle):
        self._turn(-self._deg(angle))

    def left(self, angle):
        self._turn(self._deg(angle))

    def goto(self, x, y=None):
        if y is None:
            x, y = x
        self._goto(x, y)

    def setx(self, x):
        self._goto(x, self._pos[1])

    def sety(self, y):
        self._goto(self._pos[0], y)

    def setheading(self, to_angle):
        d = (self._deg(to_angle) - self._h + 180) % 360 - 180  # the short way round
        self._turn(d)

    def home(self):
        self.goto(0, 0)
        self.setheading(0)

    def circle(self, radius, extent=None, steps=None):  # the centre is `radius` to the turtle's left
        extent = self._full if extent is None else extent
        frac = abs(extent) / self._full
        steps = steps or 1 + int(min(11 + abs(radius) / 6.0, 59.0) * frac)
        w = 1.0 * extent / steps
        w2 = 0.5 * w
        length = 2.0 * radius * math.sin(math.radians(self._deg(w2)))
        if radius < 0:
            length, w, w2 = -length, -w, -w2
        self._turn(self._deg(w2), False)
        for _ in range(steps):
            self.forward(length)
            self._turn(self._deg(w), False)
        self._turn(-self._deg(w2), False)

    def dot(self, size=None, *color):
        size = size or max(self._size + 4, 2 * self._size)
        c = _color(color, self.screen._mode) if color else self._pc
        x, y = self.screen._pt(*self._pos)
        self._items.append(self.screen._cv.create_oval(x - size / 2, y - size / 2, x + size / 2, y + size / 2, fill=c, outline=c))
        self._above()
        self._frame()

    def stamp(self):
        item = self.screen._cv.create_polygon(*self._shape_pts(), fill=self._fc, outline=self._pc, width=self._outline or self._size)
        self._stamps[item] = True
        self._above()
        self._frame()
        return item

    def clearstamp(self, stampid):
        if self._stamps.pop(stampid, None):
            self.screen._cv.delete(stampid)

    def clearstamps(self, n=None):
        ids = list(self._stamps)
        for i in ids if n is None else ids[:n] if n > 0 else ids[n:]:
            self.clearstamp(i)

    def write(self, arg, move=False, align="left", font=("Arial", 8, "normal")):
        anchor = {"left": "sw", "center": "s", "right": "se"}[align]
        x, y = self.screen._pt(*self._pos)
        self._items.append(self.screen._cv.create_text(x, y, text=str(arg), anchor=anchor, fill=self._pc, font=font))
        if move and align == "left":
            self._pos = Vec2D(self._pos[0] + len(str(arg)) * font[1] * 0.6, self._pos[1])
            self._draw_turtle()
        self._above()
        self._frame()

    # --- where am I
    def position(self):
        return Vec2D(*self._pos)

    pos = position

    def xcor(self):
        return self._pos[0]

    def ycor(self):
        return self._pos[1]

    def heading(self):
        return self._h * self._full / 360.0

    def _xy(self, x, y):
        if y is None:
            x, y = x.pos() if isinstance(x, Turtle) else x
        return x, y

    def towards(self, x, y=None):
        x, y = self._xy(x, y)
        return round(math.degrees(math.atan2(y - self._pos[1], x - self._pos[0])) % 360.0, 10) * self._full / 360.0

    def distance(self, x, y=None):
        x, y = self._xy(x, y)
        return math.hypot(x - self._pos[0], y - self._pos[1])

    def degrees(self, fullcircle=360.0):
        self._full = fullcircle

    def radians(self):
        self._full = 2 * math.pi

    # --- the pen
    def pendown(self):
        self._down = True

    def penup(self):
        self._down = False

    def isdown(self):
        return self._down

    def pensize(self, width=None):
        if width is None:
            return self._size
        self._size = width
        self._draw_turtle()

    def speed(self, speed=None):
        if speed is None:
            return self._speed
        speed = SPEEDS.get(speed, speed)
        self._speed = int(round(speed)) if 0.5 < speed < 10.5 else 0

    def pencolor(self, *args):
        if not args:
            return self._pc
        self._pc = _color(args, self.screen._mode)
        self._draw_turtle()

    def fillcolor(self, *args):
        if not args:
            return self._fc
        self._fc = _color(args, self.screen._mode)
        if self._fillitem is not None:
            self.screen._cv.itemconfigure(self._fillitem, fill=self._fc)
        self._draw_turtle()

    def color(self, *args):
        if not args:
            return self._pc, self._fc
        pc, fc = (args[0], args[0]) if len(args) == 1 else args if len(args) == 2 else (args, args)
        self.pencolor(pc)
        self.fillcolor(fc)

    def begin_fill(self):
        scr = self.screen
        self._fillpts = [self._pos]
        self._fillitem = scr._cv.create_polygon(*scr._pt(*self._pos) * 3, fill=self._fc, outline="")
        self._items.append(self._fillitem)
        self._above()

    def end_fill(self):
        self._fillitem = None
        self._fillpts = []

    def filling(self):
        return self._fillitem is not None

    def pen(self, pen=None, **pendict):
        pendict = dict(pen or {}, **pendict)
        if not pendict:
            return {"shown": self._visible, "pendown": self._down, "pencolor": self._pc, "fillcolor": self._fc, "pensize": self._size,
                    "speed": self._speed, "resizemode": "noresize", "stretchfactor": self._stretch, "outline": self._size, "tilt": 0.0}
        for k, v in pendict.items():
            {"shown": lambda: setattr(self, "_visible", v), "pendown": lambda: setattr(self, "_down", v), "pencolor": lambda: self.pencolor(v),
             "fillcolor": lambda: self.fillcolor(v), "pensize": lambda: self.pensize(v), "speed": lambda: self.speed(v)}.get(k, lambda: None)()
        self._draw_turtle()

    # --- the turtle itself
    def showturtle(self):
        self._visible = True
        self._draw_turtle()

    def hideturtle(self):
        self._visible = False
        self._draw_turtle()

    def isvisible(self):
        return self._visible

    def shape(self, name=None):
        if name is None:
            return self._shape
        if name not in SHAPES:
            raise TurtleGraphicsError("There is no shape named %s" % name)
        self._shape = name
        self._draw_turtle()

    def shapesize(self, stretch_wid=None, stretch_len=None, outline=None):
        if stretch_wid is None and stretch_len is None and outline is None:
            return self._stretch + (self._outline or self._size,)
        sw = stretch_wid if stretch_wid is not None else self._stretch[0]
        self._stretch = (sw, stretch_len if stretch_len is not None else sw if stretch_wid is not None else self._stretch[1])
        self._outline = outline if outline is not None else self._outline
        self._draw_turtle()

    def clear(self):
        cv = self.screen._cv
        for i in self._items + list(self._stamps):
            cv.delete(i)
        self._items, self._stamps, self._fillitem, self._fillpts = [], {}, None, []

    def reset(self):
        self.clear()
        self._defaults(visible=self._visible)
        self._draw_turtle()

    def getscreen(self):
        return self.screen

    fd, bk, backward, rt, lt, setpos, setposition, seth = forward, back, back, right, left, goto, goto, setheading
    pd, down, pu, up, width, st, ht, turtlesize = pendown, pendown, penup, penup, pensize, showturtle, hideturtle, shapesize


RawTurtle = RawPen = Pen = Turtle

# ---- module-level functions (turtle.forward(100), turtle.bgcolor("red"), ...) act on a default turtle / the screen
_default = None


def _the_turtle():
    """The default turtle behind turtle.forward() and friends; replaced if its window is gone (a new run)."""
    global _default
    if _default is None or not _default.screen._root.winfo_exists():
        _default = Turtle()
    return _default


def _forward_to(owner, name):
    """A module-level function that calls method `name` on whatever owner() returns (the default turtle, or the Screen)."""

    def f(*a, **k):
        return getattr(owner(), name)(*a, **k)
    f.__name__ = name
    return f


for _n in ("forward fd back bk backward right rt left lt goto setpos setposition setx sety setheading seth home circle dot stamp clearstamp "
           "clearstamps speed position pos towards xcor ycor heading distance degrees radians pendown pd down penup pu up pensize width pen "
           "isdown color pencolor fillcolor filling begin_fill end_fill reset clear write showturtle st hideturtle ht isvisible shape shapesize "
           "turtlesize getscreen").split():
    globals()[_n] = _forward_to(_the_turtle, _n)
for _n in ("bgcolor title setup screensize tracer update delay onkey onkeyrelease onkeypress onscreenclick ontimer listen mainloop exitonclick "
           "bye clearscreen resetscreen colormode textinput numinput window_width window_height getcanvas turtles mode").split():
    globals()[_n] = _forward_to(Screen, _n)
done = mainloop  # noqa: F821  (created just above)


def install():
    """Hook (once at start-up): make `import turtle` work, exposing every public name of this file."""
    mod = types.ModuleType("turtle")
    mod.__dict__.update({k: v for k, v in globals().items() if not k.startswith("_") and not isinstance(v, types.ModuleType) and k != "install"})
    mod.__all__ = sorted(mod.__dict__.keys() - {"__name__", "__doc__", "__package__", "__loader__", "__spec__", "__builtins__"})
    sys.modules["turtle"] = mod
