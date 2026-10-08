# Reading the node map

What every part of the node map on the right-hand side means, and how it relates to the code on the left. Read the
[README](../README.md) first if you have not run a program yet.

The map is your program redrawn as **boxes** joined by **wires**. It is built in two steps: the code is *read* (nothing runs) to
draw the boxes and wires, then, after **Run**, the values and run counts are filled in from what actually happened.

## Anatomy of a box

Every statement in your program is one **box**. Boxes are in source order, top to bottom.

```
  ○── FUNCTION ───────────────────────── ×3  L22 ▾ ──○     ← header
     def describe(animal):                                  ← the statement
     ┌──────────────────────────────────────────── ▾ ┐
     │ animal = Dog(name='Rex')                       │     ← value box
     │ return = 'Rex says Woof'                       │
     └────────────────────────────────────────────────┘
        ○── RETURN ─────────────────────── ×3  L23 ──○      ← a box inside a box: part of its body
           return animal.intro()
```

| Part | What it is |
| --- | --- |
| **Kind label** (FUNCTION, LOOP, SET ...) | What sort of statement the box is. The colour of the box follows the kind. |
| **L22** | The source line the statement is on. Click the box to jump the editor to it. |
| **×3** | How many times the statement ran (only shown when it ran more than once). For a function it is the number of **calls**; for a loop it is the number of **repeats of its body**. |
| **▾ / ▸** in the header | Appears on boxes that contain other boxes. Folds the body away (▸) or shows it again (▾). |
| **Code line** | The statement itself, cut with `…` if it is too long for the box. |
| **Value box** | The dark panel with the variables this statement defines and their values. See below. |
| **Ports** (the small circles) | Where wires leave (right edge) and arrive (left edge). |

## The kinds of box

| Label | Statement | Value box shows |
| --- | --- | --- |
| **FUNCTION** (blue) | `def` | Every parameter, then `return` once the function has returned a value |
| **CLASS** (purple) | `class` | Nothing; its methods are the boxes inside it |
| **LOOP** (orange) | `for`, `while` | The loop variable of a `for` |
| **IF**, **ELIF**, **ELSE** (amber) | `if`, `elif`, and the `else:` / `finally:` part of a statement | Nothing |
| **WITH** (amber) | `with` | The names after `as` |
| **TRY**, **CATCH** (red) | `try`, `except` | The name after `as` in an `except` |
| **RETURN** (green) | `return` | `value`: what was returned |
| **IMPORT** (teal) | `import`, `from ... import` | The names it brings in |
| **SET** (cyan) | an assignment | The variables it sets, including attributes such as `self.name` |
| **RUN** (pale) | a statement that is just an expression, like `print(x)` or `items.append(3)` | Objects the call changed (`items`) |
| **STMT** (grey) | anything else (`pass`, `break`, `raise` ...) | Nothing |

## Boxes inside boxes

A box that sits inside another is part of its **body**: the statements of a function, a class, a loop, or one branch of an `if`.
That nesting is the program's block structure, and it is also **scope**: a variable first set inside a function's box belongs to that
function and is not visible outside it.

Click the **▾** in a header to fold a body away; the header then says how many boxes are inside (`FUNCTION · 3 inside`) and the wires
of the hidden boxes attach to the folded one. **⊟** in the map's toolbar folds every container, **⊞** opens them all again.

## The value box

The value box shows the **state** after the statement ran: the names it defines and what they hold.

- **Every row is shown.** A function with `x, y, x1, y1, x2, y2` shows all six parameters and its `return`, however many there are.
- **Collapse it when it is in the way.** A value box with three or more rows has a small **▾** in its corner. Click it and the box
  shrinks to one line with just the names and how many there are (`x, y, x1, y1, x2, y2, return (7)`, with **▸**); click again for the
  full list. **⊟** keeps value boxes you collapsed; **⊞** opens everything, value boxes included.
- **`–`** means "no value yet": the program has not run, or the statement never ran.
- After a run each box shows the **last** value it had. Use the step bar to see the value at any moment of the run.
- Values are shown as Python's `repr`, cut with `…` to fit. Objects show their fields one level deep (`Dog(name='Rex', tricks=[])`);
  objects from libraries (a turtle, a tkinter widget) show just their class (`<Turtle>`).
- A function's box shows the parameters as they were at the **start** of the call, so an object can look empty (`Animal()`) before
  its constructor has filled it in.
- Exporting the map (**Export**) always draws every row, whatever you collapsed on screen.

## Wires

A wire connects two boxes. It leaves the **right** edge of one, runs down the side lanes, crosses the gap above the other and enters
its **left** edge, so it never passes through a box. Wires that go into (or out of) the same box travel together as a tight **bundle**, a few pixels apart, so a
function called from ten places doesn't spread ten lines across the margin; every wire is still its own line, and hovering a box lights
only its own wires. The small **pill** on a wire, in the gap above its target, says what it carries.
There are three kinds:

| Wire | Looks like | Meaning |
| --- | --- | --- |
| **Data** | solid line, one colour per variable, pill = the variable name (`total`, `self.name`) | A value made in the box at the start is **used** in the box at the arrowhead. |
| **Call** | dashed orange line, pill = the call (`add(total, i)`) | Execution jumps to that function (or to a class's `__init__`). A **↔** in the pill and an arrowhead at both ends mean the function **returns** a value. |
| **Loop-carried** | dotted line, pill starts with **↻** | A value carried round a loop to its **next repeat**. Most often it is a variable that updates itself: `total = add(total, i)`, `count += 1` and `n -= 1` each get a short dotted loop from the box round back into itself. It is also drawn when a value is used higher up in the loop body than the line that makes it (`if n > largest` and, further down, `largest = n`), and from an outer loop into an inner one (`i += 1` feeding the `print(i, j)` of an inner `for`). |

The same variable always gets the same colour, so you can follow `total` through the whole program. The toolbar buttons **data**,
**calls** and **loops** (the ↻ wires) hide a kind of wire; **selected** shows only the wires of the selected box. Hover over a box, or put the
editor cursor in it, to light up its wires; the **Find variable** box highlights every box and wire that mentions a name.

## Highlights and states

| What you see | Meaning |
| --- | --- |
| A **dimmed** box | It never ran in the last run. |
| A **yellow outline** (and the line highlighted in the editor) | The statement about to run, while you use the step bar. |
| A **red box** | The statement that raised the error (the message is also shown under the line in the editor). |
| A **bright outline** | The box under the editor cursor or the mouse. |
| Animated dashes on a wire | The wire belongs to the highlighted box. |
| A yellow or red **squiggle** in the editor, and a dot in the gutter | A hint from the analysis (an unused variable, a missing `return`, ...). Hover for the explanation. |

## The step bar

After a run the bar above the map replays it. **⏮** goes to the start, **|◀** and **▶|** step back and forward one executed line,
**▶** plays, **⏭** shows the finished state, and the slider jumps anywhere. At each step the boxes show the values and run counts as
they were at that moment, and the yellow outline marks the line about to run. When the program jumps into a function and out again
you are watching the **call stack**: calls go in, returns come back, last in first out.

## Functions and classes on the map

| In the language | On the map |
| --- | --- |
| A function definition | A FUNCTION box; its body is the boxes inside it |
| Calling a function | A dashed call wire from the calling box to the FUNCTION box, with **↔** when it returns something |
| Parameters, arguments | The parameters are the first rows of the FUNCTION box; the argument is a data wire from where the value was made |
| Local variables | SET boxes inside the function; they are scoped to it |
| Return value | The `return` row of the FUNCTION box, and the RETURN box inside it |
| A function called many times | One FUNCTION box with **×N** |
| A class | A CLASS box with a box for each method |
| Creating an object, `Dog("Rex")` | A call wire to the class's `__init__` (or to the CLASS box if it has none); the variable's value box shows `Dog(name='Rex')` |
| `self.name` | A SET box for `self.name = name` in `__init__`, and a data wire labelled `self.name` to every method that reads it |
| Inheritance, `class Dog(Animal)` | A data wire labelled `Animal` from the CLASS box of `Animal` to the one of `Dog` |
| One call that may run different methods (polymorphism) | One call site with a wire to **each** method of that name |
| Functions and classes are objects | Their names are data too: a wire labelled with the function or class name can flow into any box that uses it |

## What the map does not know

The map comes from reading the code, so it is approximate in places:

- It does not follow attributes **inherited** from a parent class: a method that reads `self.name`, set in the parent's `__init__`,
  gets no wire (the parent's `__init__` still shows its run count).
- It cannot tell which branch of an `if` a value came from; when both branches assign a name, the later assignment is the one wired
  to a later use.
- A call wire to a method name goes to every method with that name (up to three), whichever object it is called on.
- Values after a run are the last ones; only the step bar shows the history, and only the first 30,000 steps are recorded.

How the map is built is described in [ARCHITECTURE.md](ARCHITECTURE.md#analysis-analyze) and
[`nodemap.js`](../nodemap.js).
