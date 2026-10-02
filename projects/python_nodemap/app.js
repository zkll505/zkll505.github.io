'use strict';
const $ = s => document.querySelector(s);
const STORE = 'python_nodemap.v1';

const STARTER = {
  'main.py': `import random
from helpers import average


def add(a, b):
    """Return a + b.

    >>> add(2, 3)
    5
    """
    return a + b


class Dog:
    def __init__(self, name):
        self.name = name
        self.tricks = []

    def learn(self, trick):
        self.tricks.append(trick)

    def show(self):
        return self.name + " knows " + str(len(self.tricks)) + " trick(s)"


total = 0
for i in range(1, 4):
    total = add(total, i)
print("total:", total)

rex = Dog("Rex")
rex.learn("sit")
print(rex.show())

scores = [random.randint(50, 100) for _ in range(5)]
print("average:", average(scores))

if total > 10:
    print("big")
else:
    print("small")

if __name__ == "__main__":
    import doctest
    doctest.testmod()
`,
  'helpers.py': `def average(nums):
    """Mean of a list.

    >>> average([2, 4])
    3.0
    """
    return sum(nums) / len(nums)
`,
};

// ---- state (files persist in localStorage; trace/graph are per-session)
const S = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && s.files && s.files[s.active]) return s;
  } catch {}
  return { files: STARTER, open: ['main.py'], active: 'main.py' };
})();
S.trace = {}; // file -> values/hits from the last run
S.graph = {}; // file -> analyzer output
const docs = {};
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ files: S.files, open: S.open, active: S.active })); } catch {} };
let timer;
const later = (f, ms) => { clearTimeout(timer); timer = setTimeout(f, ms); };
const setStatus = t => { $('#st').textContent = t; };

// ---- console
function out(text, cls = '') {
  const span = document.createElement('span');
  span.className = cls;
  text.split(/(File "[^"]+", line \d+)/).forEach((p, i) => {
    if (i % 2 === 0) return span.append(p);
    const [, f, l] = /File "([^"]+)", line (\d+)/.exec(p);
    const a = document.createElement('a');
    a.textContent = p; a.dataset.file = f; a.dataset.line = l;
    span.append(a);
  });
  $('#out').append(span);
  $('#out').scrollTop = 1e9;
}
$('#out').onclick = e => {
  const a = e.target.closest('a');
  if (a && S.files[a.dataset.file]) { openFile(a.dataset.file); gotoLine(+a.dataset.line); }
};
$('#clear').onclick = () => { $('#out').textContent = ''; };

// ---- Python (Pyodide) with runner.py
const py = {};
py.ready = (async () => {
  const p = await loadPyodide();
  const ns = p.globals.get('dict')();
  ns.set('__name__', 'nm_runner'); // own namespace so the import guard never sees runner.py as user code
  p.runPython(RUNNER_PY, { globals: ns });
  const stream = cls => { const d = new TextDecoder(); return { write: b => (out(d.decode(b, { stream: true }), cls), b.length) }; };
  p.setStdout(stream());
  p.setStderr(stream('err'));
  return { analyze: ns.get('analyze'), run: ns.get('run') };
})();
const python = () => py.ready.catch(() => null);

// ---- editor
const cm = CodeMirror($('#cm'), {
  mode: 'python', theme: 'vscode', lineNumbers: true, indentUnit: 4, matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
  extraKeys: {
    Tab: c => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ', 'end')),
    'Shift-Tab': 'indentLess', 'Ctrl-/': 'toggleComment', 'Ctrl-Enter': () => run(), F5: () => run(), 'Ctrl-S': () => {},
  },
});
const docOf = n => (docs[n] ||= CodeMirror.Doc(S.files[n], 'python'));
cm.on('change', () => {
  S.files[S.active] = cm.getValue();
  delete S.trace[S.active]; // values would no longer match the code
  save();
  later(refresh, 350);
});
cm.on('cursorActivity', () => {
  const c = cm.getCursor();
  $('#pos').textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}`;
  mark(true);
});
function gotoLine(l) {
  cm.setCursor({ line: l - 1, ch: 0 });
  cm.scrollIntoView(null, 120);
  cm.focus();
}

// ---- files: explorer + tabs
const okName = n => /^[A-Za-z_]\w*\.py$/.test(n);
function chrome() {
  $('#tabs').innerHTML = S.open.map(n => `<div class="tab${n === S.active ? ' on' : ''}" data-f="${n}">${n}<b data-x="${n}">×</b></div>`).join('');
  $('#files').innerHTML = Object.keys(S.files).sort().map(n => `<li class="${n === S.active ? 'on' : ''}" data-f="${n}"><span>${n}</span><i data-ren="${n}" title="Rename">✎</i><i data-del="${n}" title="Delete">✕</i></li>`).join('');
  $('#mapname').textContent = '· ' + S.active;
}
function openFile(n) {
  if (!S.open.includes(n)) S.open.push(n);
  S.active = n;
  cm.swapDoc(docOf(n));
  chrome(); save(); refresh();
  cm.focus();
}
function closeTab(n) {
  S.open = S.open.filter(x => x !== n);
  if (!S.open.length) S.open = [Object.keys(S.files).find(x => x !== n) || n];
  openFile(S.active === n || !S.open.includes(S.active) ? S.open[0] : S.active);
}
function newFile() {
  let n = (prompt('New file name:', 'untitled.py') || '').trim();
  if (!n) return;
  if (!n.endsWith('.py')) n += '.py';
  if (!okName(n)) return alert('Use letters, digits and _ only (so it can be imported), e.g. my_module.py');
  if (!(n in S.files)) S.files[n] = '';
  openFile(n);
}
function renameFile(old) {
  let n = (prompt('Rename to:', old) || '').trim();
  if (!n || n === old) return;
  if (!n.endsWith('.py')) n += '.py';
  if (!okName(n)) return alert('Use letters, digits and _ only, e.g. my_module.py');
  if (n in S.files) return alert(n + ' already exists.');
  S.files[n] = S.files[old]; docs[n] = docs[old];
  S.open = S.open.map(x => (x === old ? n : x));
  if (S.active === old) S.active = n;
  [S.files, docs, S.trace, S.graph].forEach(o => delete o[old]);
  chrome(); save(); refresh();
}
function deleteFile(n) {
  if (Object.keys(S.files).length < 2) return alert('Keep at least one file.');
  if (!confirm(`Delete ${n}? This can't be undone.`)) return;
  [S.files, docs, S.trace, S.graph].forEach(o => delete o[n]);
  S.open = S.open.filter(x => x !== n);
  if (!S.open.length) S.open = [Object.keys(S.files)[0]];
  openFile(S.active === n ? S.open[0] : S.active);
}
$('#new').onclick = newFile;
$('#tabs').onclick = e => (e.target.dataset.x ? closeTab(e.target.dataset.x) : e.target.closest('.tab') && openFile(e.target.closest('.tab').dataset.f));
$('#files').onclick = e => {
  const d = e.target.dataset;
  if (d.ren) renameFile(d.ren); else if (d.del) deleteFile(d.del); else if (e.target.closest('li')) openFile(e.target.closest('li').dataset.f);
};

// ---- node map
let act = null, hov = null; // node under the cursor / under the mouse
async function refresh() {
  const p = await python(), n = S.active;
  if (!p) return;
  const g = JSON.parse(p.analyze(S.files[n]));
  if (n !== S.active) return;
  $('#maperr').textContent = g.error ? '  syntax error, ' + g.error : '';
  if (!g.error) S.graph[n] = g;
  draw();
}
function draw() {
  const g = S.graph[S.active];
  $('#map').innerHTML = g ? NodeMap.build(g, S.trace[S.active]).svg : '<div class="empty">Nothing to map yet.</div>';
  mark();
}
function paint() {
  const svg = $('#map svg');
  if (!svg) return;
  const id = hov ?? act;
  svg.querySelectorAll('.node.act').forEach(e => e.classList.remove('act'));
  if (act != null) svg.querySelector(`.node[data-id="${act}"]`)?.classList.add('act');
  svg.classList.toggle('f', id != null);
  svg.querySelectorAll('.wire').forEach(w => w.classList.toggle('on', id != null && (+w.dataset.a === id || +w.dataset.b === id)));
}
function mark(scroll) {
  const g = S.graph[S.active];
  act = g ? NodeMap.nodeAt(g, cm.getCursor().line + 1)?.id ?? null : null;
  paint();
  if (scroll) $('#map .node.act')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
$('#map').addEventListener('mouseover', e => {
  const id = e.target.closest('.node')?.dataset.id;
  if ((id == null ? null : +id) !== hov) { hov = id == null ? null : +id; paint(); }
});
$('#map').addEventListener('mouseleave', () => { hov = null; paint(); });
$('#map').onclick = e => { const n = e.target.closest('.node'); if (n) gotoLine(+n.dataset.line); };

// ---- run
let busy = false;
async function run(mode = 'run') {
  const p = await python();
  if (!p || busy) return;
  busy = true;
  setStatus('Running…');
  $('#out').textContent = '';
  out(`▶ ${mode === 'doctest' ? 'doctest ' : ''}${S.active}\n`, 'dim');
  await new Promise(r => setTimeout(r, 40)); // let the browser paint before Python blocks the page
  const t0 = performance.now();
  try {
    S.trace = JSON.parse(p.run(JSON.stringify(S.files), S.active, mode)).files;
  } catch (e) {
    out(String(e) + '\n', 'err');
  }
  out(`\n[finished in ${Math.round(performance.now() - t0)} ms]\n`, 'dim');
  busy = false;
  setStatus('Ready');
  draw();
}
$('#run').onclick = () => run();
$('#doctest').onclick = () => run('doctest');

// ---- import / export
const download = (blob, name) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
};
const safeName = p => {
  const n = p.split(/[\\/]/).pop().replace(/\.py$/i, '').replace(/\W/g, '_') || 'file';
  return (/^\d/.test(n) ? '_' : '') + n + '.py';
};
async function importFiles(list) {
  const got = {};
  for (const f of list) {
    if (/\.zip$/i.test(f.name)) {
      const z = await JSZip.loadAsync(f);
      for (const e of Object.values(z.files)) {
        if (!e.dir && /\.py$/i.test(e.name) && !/(^|\/)__MACOSX\//.test(e.name)) got[safeName(e.name)] = await e.async('string');
      }
    } else if (/\.py$/i.test(f.name)) got[safeName(f.name)] = await f.text();
  }
  const names = Object.keys(got);
  if (!names.length) return alert('No .py files found.');
  const clash = names.filter(n => n in S.files && S.files[n] !== got[n]);
  if (clash.length && !confirm(`Replace ${clash.join(', ')} with the imported version?`)) return;
  names.forEach(n => { S.files[n] = got[n]; docs[n]?.setValue(got[n]); delete S.trace[n]; });
  openFile(names[0]);
}
$('#imp').onclick = () => $('#pick').click();
$('#pick').onchange = async e => { await importFiles([...e.target.files]); e.target.value = ''; };
$('#exp').onclick = async () => {
  const p = await python();
  setStatus('Exporting…');
  const zip = new JSZip();
  for (const [name, src] of Object.entries(S.files)) {
    zip.file(name, src);
    const g = p && JSON.parse(p.analyze(src));
    if (g && !g.error) zip.file(name.replace(/\.py$/, '') + '_nodemap.png', await NodeMap.png(g, S.trace[name]));
  }
  download(await zip.generateAsync({ type: 'blob' }), 'python_project.zip');
  setStatus('Ready');
};

// ---- resizable panels
const drag = (el, fn) => el.addEventListener('pointerdown', e => {
  el.setPointerCapture(e.pointerId);
  const up = () => { el.removeEventListener('pointermove', fn); el.removeEventListener('pointerup', up); cm.refresh(); };
  el.addEventListener('pointermove', fn);
  el.addEventListener('pointerup', up);
});
drag($('#vsplit'), e => document.body.style.setProperty('--map-w', Math.max(240, innerWidth - e.clientX) + 'px'));
drag($('#hsplit'), e => document.body.style.setProperty('--con-h', Math.max(60, innerHeight - 22 - e.clientY) + 'px'));

// ---- go
cm.swapDoc(docOf(S.active));
chrome();
py.ready.then(() => { setStatus('Ready'); refresh(); }, e => {
  setStatus('Python failed to load');
  $('#map').innerHTML = '<div class="empty">Could not load Python. Check your connection and reload.</div>';
  out(`Could not load Python: ${e}\nThis page needs internet access to cdn.jsdelivr.net (Pyodide) and cdnjs.cloudflare.com (editor, zip).\n`, 'err');
});
