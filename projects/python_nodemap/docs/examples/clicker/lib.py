"""Example GUI library: `import clicker; clicker.show(); clicker.mainloop()` opens a window with one button that counts clicks.
This is the smallest complete GUI library: Python keeps the state and decides what to draw; lib.js draws it and reports clicks."""
import json
import sys
import types

state = {"count": 0, "open": False, "dirty": False, "post": None}


class Exit(BaseException):  # mainloop() raises this to end the script while the window stays open (runner.py catches it)
    pass


def _tree():
    state["dirty"] = False
    return {"count": state["count"], "open": state["open"]}  # whatever your view needs; it must be JSON


def show():
    state["open"] = state["dirty"] = True
    if state["post"]:
        state["post"](json.dumps(_tree()))  # push a frame right now (also how animations stream while the script runs)


def mainloop():
    raise Exit()


def install():  # runs once at start-up: make `import clicker` work
    m = types.ModuleType("clicker")
    m.show, m.mainloop = show, mainloop
    sys.modules["clicker"] = m


def dispatch(ev):  # an event the view sent with send({...})
    if ev["type"] == "click":
        state["count"] += 1
        state["dirty"] = True
    elif ev["type"] == "close":
        state["open"] = False
        state["dirty"] = True  # tell the view (one last frame, with open: False) so it removes the window


def pump():  # called after the script, after each event and after each timer
    out = {"alive": state["open"], "next": None}  # "next" = milliseconds until tick() should run, or None
    if state["dirty"]:
        out["tree"] = _tree()  # only send a frame when something changed
    return out


gui_hooks = {
    "reset": lambda: state.update(count=0, open=False, dirty=False),  # new run / Stop / project replaced: forget everything
    "finish": lambda: None,  # the script ended and active() was False
    "active": lambda: state["open"],  # keep the window open after the script ended?
    "dispatch": dispatch,
    "tick": lambda: None,  # a timer you asked for with "next" is due
    "pump": pump,
    "set_post": lambda f: state.update(post=f),  # f(json_string) pushes a frame to the view
    "exit": Exit,
}
