# Demo: reading a program as a map (functions and objects)

A five-minute live demo for a Principles of Programming class. It explains what each part of the node map means, then uses the
same picture to talk about **functions** (call, parameters, return, scope) and **objects** (classes, `self`, inheritance,
polymorphism), and shows why "Python is object-oriented" is more than a slogan. A two-minute cut is at the end.

## Before class

1. Open this link. It loads the app and, after asking you to confirm, replaces whatever is in the explorer with one file, `main.py`:

   <https://zkll505.github.io/projects/python_nodemap/#p=zlVHBSsQwEP2VIaeGLbl4K_QgLnjyIoIHR0rcnS7BZhKSiC3iv0uS1l0PguYyyZs3b94jH8Jqw8ovohOHSccI12ysnjpkAIAjjTAMhk0ahibSNLbA2pJc2_lkVGUQ-tJDPo9GT_q1zF1OBEpvgQGFUgrFJd9wCu43_nnRDlBA1EvMdVcbdZXMasg1yd6dmppGdn_29OjcWE1tMjc6_V_mjtz7JpPpR4qHYF6o0T-UVn4FVY2_Zgg0Q18yoLinGYVETs5CXwyheHC2YJ5ShB6eAs0tJGfb9QcbFLfEFMwBhXxGHl0ATwkM5xJXAz4YTs23O09Jlv0VT4un5kq2UC4ba3vv3Wm7BprznPj8Ag>

   Or press **Import** and pick [`principles_demo.py`](principles_demo.py) from this folder. Running locally? Replace the
   start of the link (everything before `#p=`) with `http://localhost:8000/`.
2. Press **A+** a couple of times so the back row can read the code, and switch to the light theme (☀) if the projector washes out
   dark colours.
3. Press **Run** once to check it: the console shows four lines.

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return "..."

    def intro(self):
        return self.name + " says " + self.speak()


class Dog(Animal):
    def speak(self):
        return "Woof"


class Cat(Animal):
    def speak(self):
        return "Meow"


def describe(animal):
    return animal.intro()


rex = Dog("Rex")
tom = Cat("Tom")
pets = [rex, tom, Animal("Generic")]
for pet in pets:
    print(describe(pet))

print(type(3), type(describe), type(Dog), type(rex))
```

```
Rex says Woof
Tom says Meow
Generic says ...
<class 'int'> <class 'function'> <class 'type'> <class '__main__.Dog'>
```

## Part 1: what am I looking at? (1½ min)

Click **⊟** (collapse everything) so the program fits on screen (zoom out once with **−** if it doesn't), then walk through the legend:

| On the map | What it is | The idea behind it |
| --- | --- | --- |
| A **card** (labelled FUNCTION, CLASS, LOOP, SET, RUN, RETURN ...) | One statement of the program, in source order | A statement |
| A card **inside** a card | A statement in the body of that function, class or loop | Block structure and **scope**: a name made inside a function lives only there |
| **L12** and **×3** in a card's corner | The source line, and how many times it ran | One definition, many executions |
| The dark **value box** under a card | The variables that statement defines, and their values | **State**: names bound to values |
| A **solid wire**, one colour per variable | A value produced here and used there | **Data dependency** (where a value comes from) |
| A **dashed orange wire** | A call: execution jumps to that function | **Control flow** |
| **↔** on a call wire | The function sends a value back | A **return value** |
| The **yellow outline** (with the line highlighted in the editor) when you use the step bar | The statement about to run | The program counter, and with calls, the **call stack** |
| A **dimmed** card | It has not run (yet) | Code that was never reached |

Say: "The map is the program redrawn. It is built by reading the code, then the values and counts are filled in by running it."

## Part 2: functions (1½ min)

1. Point at the `describe` card. "One definition, but **×3**: it ran three times. Its box shows the parameter `animal` and the
   `return` value. After a run a box shows the *last* call; the step bar shows each one."
2. Point at the dashed wire from `print(describe(pet))` to `describe`, with **↔**: "The call goes out, a value comes back." The
   solid wire labelled `pet` from the loop is the argument. Inside the function the same object is called `animal`: parameter
   passing gives the function another name for the same object, not a copy.
3. Click **⏮**, then **▶|** (step forward) until the status says **step 19 / 35**, and keep clicking. Watch the yellow outline:
   `print(describe(pet))` → `return animal.intro()` → `return self.name ...` → `return "Woof"` → back to the loop.
   "Every jump into a function is a call and every jump back is a return. That is the call stack: last in, first out."

## Part 3: objects (2 min)

Click **⊞** (expand everything) or open the class cards one at a time.

1. **A class is a card with method cards inside.** Data and the code that works on it, kept together.
2. Look at the `rex = Dog("Rex")` card. Its box shows `Dog(name='Rex')`: an object is a bundle of attributes. Calling the class
   builds one, so the call wire goes to the class card.
3. **Inheritance.** The solid wires labelled `Animal` run from `class Animal` into `class Dog` and `class Cat`: a Dog *is an*
   Animal. Then ask: "`Dog` has no `__init__` of its own, so which constructor ran?" Look at `Animal.__init__`: it shows **×3**.
   Python found the parent's constructor at run time. The map can only draw the wire that the code names, so the *counter* is what
   gives it away.
4. **State lives in the object.** The wire labelled `self.name` runs from the constructor (`self.name = name`) to `intro`: one
   method reads what another stored.
5. **Polymorphism.** In `intro`, `self.speak()` has **three** call wires: one call, three possible methods. Which one runs depends
   on the object. Go back to the step bar: at **step 22** the outline is on Dog's `return "Woof"` (Cat's `speak` card is still dimmed, because it hasn't run yet);
   **step 27** is Cat's `"Meow"`; **step 32** is the base class's `"..."`. Same line of code, three behaviours.
6. **Python is object-oriented all the way down.** Look at the last line's output: `int`, `function`, `type`, `Dog`. Even the
   function `describe` and the class `Dog` are objects: on the map they flow into that last `print` as ordinary data wires. Numbers,
   functions, classes and instances are all objects, and you can pass any of them around.

## Questions to leave with the class

1. Change `class Dog` so it only says `pass`. What does Rex say? (`Rex says ...`: the parent's method is inherited. On the map, the
   `self.speak()` wires drop from three to two.)
2. `type(Dog)` is `type`. What does that tell you about classes? (They are objects too, built by another object.)
3. Where would you add a `Bird` class? Which wires would appear, and which lines would not need to change?

## Be upfront about the limits

- The map is **static analysis** plus a recorded run. It does not follow attributes inherited from a parent class (a subclass method
  that reads `self.name` set in the parent's `__init__` gets no wire), and it can't tell which branch of an `if` a value came from.
- After a run, each box shows the **last** value; use the step bar for the rest.
- A list of objects is cut off in its box (`pets` shows `[<__main__.Dog object>, <__main__.Cat o…`).

## The two-minute version

Open the link, press Run, click **⊟**. Point at the inheritance wires and at `self.speak()` reaching all three classes. Click **⊞**,
jump to step 22, then 27, then 32, and say: "same line, three behaviours: that is polymorphism, and the map shows it."
