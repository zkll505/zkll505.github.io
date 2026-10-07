"""Optional: checks that this demo still says what README.md says. Run it before presenting: python demo/check.py

Standalone: nothing outside this folder refers to it. It only borrows the app's backend (../runner.py) to analyse and run
principles_demo.py, then compares the result with what README.md quotes (the program text, the share link, the wire and call
counts, and the step numbers)."""
import base64, contextlib, importlib.util, io, json, pathlib, re, zlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("runner", HERE.parent / "runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.configure("[]")  # the demo program imports nothing

src = (HERE / "principles_demo.py").read_text(encoding="utf-8")
doc = (HERE / "README.md").read_text(encoding="utf-8")
assert src in doc, "the program in README.md is out of date"
frag = re.search(r"#p=z([\w-]+)", doc).group(1)  # the share link: 'z' + base64url(raw deflate of the project JSON)
assert json.loads(zlib.decompress(base64.urlsafe_b64decode(frag + "=" * (-len(frag) % 4)), -15)) == {"main.py": src}, "the share link in README.md is out of date"

g = json.loads(runner.analyze(src))
assert sum(w["label"] == "self.speak()" for w in g["wires"]) == 3  # polymorphism: one call site, three possible methods
with contextlib.redirect_stdout(io.StringIO()) as o:
    r = json.loads(runner.run(json.dumps({"main.py": src}), "main.py"))
assert o.getvalue().splitlines()[:3] == ["Rex says Woof", "Tom says Meow", "Generic says ..."], o.getvalue()
assert r["files"]["main.py"]["calls"]["2"] == 3  # Dog and Cat have no __init__: the parent's ran for all three objects
lines = r["timeline"]["steps"][1::2]  # the line about to run at each step
assert len(lines) == 35 and [lines[s] for s in (19, 22, 27, 32)] == [30, 14, 19, 6], lines
print("ok")
