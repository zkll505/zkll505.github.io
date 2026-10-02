'use strict';
const $ = s => document.querySelector(s);
const STORE = 'python_nodemap.v1', PREFS = 'python_nodemap.prefs';
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/'; // 0.29 (Python 3.13): works in classic blob workers, so also from file://
const STOPPED = new Error('stopped');

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

// ---- state. Files + open tabs persist in localStorage; everything else lives for the session.
const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const S = (() => { const s = read(STORE); return s?.files?.[s.active] ? s : { files: { ...STARTER }, open: ['main.py'], active: 'main.py' }; })();
Object.assign(S, {
  trace: {},   // file -> values/hits of the finished run
  tl: null,    // step timeline of the last run; step = null means "finished" (the final values)
  step: null, views: null,
  error: null, // {file, line, msg} of the last run
  graph: {}, key: {}, err: {}, hints: {}, fold: {}, // per-file analysis results (key = what they were computed from)
});
const P = { light: false, font: 14, zoom: 1, data: true, call: true, back: true, only: false, ...read(PREFS) };
const docs = {};
const save = () => store(STORE, { files: S.files, open: S.open, active: S.active });
let timer;
const later = (f, ms) => { clearTimeout(timer); timer = setTimeout(f, ms); };
const setStatus = t => { $('#st').textContent = t; };
const modsOf = () => Object.keys(S.files).map(f => f.slice(0, -3)).sort();
const okName = n => /^[A-Za-z_]\w*\.py$/.test(n);

// ---- Python lives in a worker (worker.js + runner.js), so the page never freezes and Stop works
const W = {
  n: 0, pend: new Map(), onOut: () => {},
  call(type, data) {
    return (type === 'init' ? Promise.resolve() : W.ready).then(() => new Promise((res, rej) => {
      const id = ++W.n;
      W.pend.set(id, { res, rej });
      W.w.postMessage({ id, type, ...data });
    }));
  },
  start() {
    try {
      W.w = new Worker(URL.createObjectURL(new Blob([`(${workerMain})()`], { type: 'text/javascript' })));
    } catch (e) { W.ready = Promise.reject(e); return; }
    W.w.onmessage = ({ data: m }) => {
      if (m.type === 'out') return W.onOut(m.text, m.cls);
      const p = W.pend.get(m.id);
      W.pend.delete(m.id);
      if (p) m.error ? p.rej(new Error(m.error)) : p.res(m.result);
    };
    W.w.onerror = e => out(`Python worker error: ${e.message || e}\n`, 'err');
    W.ready = W.call('init', { url: PYODIDE, runner: RUNNER_PY });
    W.ready.catch(() => {});
  },
  restart() { // Stop: killing the worker is the only way to interrupt running Python
    W.w.terminate();
    W.pend.forEach(p => p.rej(STOPPED));
    W.pend.clear();
    W.start();
  },
};

// ---- console. A re-run (after input) re-sends output we already showed, so only the new part is displayed.
let seen = 0, shown = 0;
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
W.onOut = (text, cls) => {
  const from = Math.max(0, shown - seen);
  seen += text.length;
  shown = Math.max(shown, seen);
  if (from < text.length) out(text.slice(from), cls);
};
$('#out').onclick = e => {
  const a = e.target.closest('a');
  if (a && S.files[a.dataset.file]) { openFile(a.dataset.file); gotoLine(+a.dataset.line); }
};
$('#clear').onclick = () => { $('#out').textContent = ''; };

// ---- editor
const complete = c => c.showHint({ hint: cc => PyComplete.hint(cc, S.files), completeSingle: false });
const cm = CodeMirror($('#cm'), {
  mode: 'python', theme: 'vscode', lineNumbers: true, gutters: ['lint', 'CodeMirror-linenumbers'], indentUnit: 4,
  matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
  extraKeys: {
    Tab: c => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ', 'end')),
    'Shift-Tab': 'indentLess', 'Ctrl-/': 'toggleComment', 'Ctrl-Enter': () => run(), F5: () => run(), 'Ctrl-S': () => {},
    'Ctrl-Space': complete, 'Ctrl-F': 'findPersistent', 'Ctrl-H': 'replace', F3: 'findNext', 'Shift-F3': 'findPrev',
  },
});
const docOf = n => (docs[n] ||= CodeMirror.Doc(S.files[n], 'python'));
cm.on('change', () => {
  S.files[S.active] = cm.getValue();
  delete S.trace[S.active];
  S.tl = null; S.step = null; S.error = null; // the recorded run no longer matches the code
  stopPlay(); showMarks(); updateStepper();
  save();
  later(refresh, 350);
});
cm.on('cursorActivity', () => {
  const c = cm.getCursor();
  $('#pos').textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}`;
  mark(true);
});
cm.on('inputRead', (c, ch) => { // autocomplete as you type: after a dot, or after two identifier characters
  if (c.state.completionActive || ch.origin !== '+input' || !/^[\w.]$/.test(ch.text[0] || '')) return;
  if (/string|comment/.test(c.getTokenTypeAt(c.getCursor()) || '')) return;
  const before = c.getLine(c.getCursor().line).slice(0, c.getCursor().ch);
  if (ch.text[0] === '.' || /[A-Za-z_]\w$/.test(before)) complete(c);
});
function gotoLine(l) {
  cm.setCursor({ line: l - 1, ch: 0 });
  cm.scrollIntoView(null, 120);
  cm.focus();
}

// marks in the editor: the line being stepped to, the line that raised an error, and lint squiggles
const slot = {};
function clearSlot(k) {
  const m = slot[k];
  if (!m) return;
  m.doc.removeLineClass(m.h, 'background', m.cls);
  m.w?.clear();
  slot[k] = null;
}
function markLine(k, line, cls) {
  if (line < 1 || line > cm.lineCount()) return null;
  return (slot[k] = { doc: cm.getDoc(), h: cm.addLineClass(line - 1, 'background', cls), cls });
}
function showMarks() {
  clearSlot('now'); clearSlot('err');
  const [f, l] = nowAt();
  if (f === S.active && l) { markLine('now', l, 'cm-now'); cm.scrollIntoView({ line: l - 1, ch: 0 }, 90); }
  const e = S.error;
  if (e && e.file === S.active) {
    const m = markLine('err', e.line, 'cm-err');
    if (m) {
      const el = document.createElement('div');
      el.className = 'err-widget';
      el.textContent = e.msg;
      m.w = cm.addLineWidget(e.line - 1, el);
    }
  }
}
let lintMarks = [];
function showHints() {
  lintMarks.forEach(m => m.clear());
  lintMarks = [];
  cm.clearGutter('lint');
  const hs = S.hints[S.active] || [], byLine = {};
  hs.forEach(h => (byLine[h.line] ||= []).push(h));
  for (const [line, list] of Object.entries(byLine)) {
    const text = cm.getLine(line - 1);
    if (text == null) continue;
    const kind = list.some(h => h.kind === 'error') ? 'error' : 'warn', msg = list.map(h => h.msg).join('\n');
    lintMarks.push(cm.markText({ line: line - 1, ch: text.length - text.trimStart().length }, { line: line - 1, ch: text.length }, { className: 'lint-' + kind, title: msg }));
    const dot = document.createElement('div');
    dot.className = 'lint-dot ' + kind;
    dot.title = msg;
    cm.setGutterMarker(line - 1, 'lint', dot);
  }
  $('#probs').textContent = hs.length ? `⚠ ${hs.length}` : '';
  $('#probs').title = hs.map(h => `line ${h.line}: ${h.msg}`).join('\n');
}

// ---- files: explorer + tabs
function chrome() {
  $('#tabs').innerHTML = S.open.map(n => `<div class="tab${n === S.active ? ' on' : ''}" data-f="${n}">${n}<b data-x="${n}">×</b></div>`).join('');
  $('#files').innerHTML = Object.keys(S.files).sort().map(n => `<li class="${n === S.active ? 'on' : ''}" data-f="${n}"><span>${n}</span><i data-ren="${n}" title="Rename">✎</i><i data-del="${n}" title="Delete">✕</i></li>`).join('');
  $('#mapname').textContent = '· ' + S.active;
}
const forget = n => [S.files, docs, S.trace, S.graph, S.key, S.err, S.hints, S.fold].forEach(o => delete o[n]);
function openFile(n) {
  if (!S.open.includes(n)) S.open.push(n);
  S.active = n;
  cm.swapDoc(docOf(n));
  chrome(); save(); showMarks(); showHints(); updateStepper(); refresh();
  if (!playT) cm.focus();
}
function closeTab(n) {
  S.open = S.open.filter(x => x !== n);
  if (!S.open.length) S.open = [Object.keys(S.files).find(x => x !== n) || n];
  openFile(S.active === n || !S.open.includes(S.active) ? S.open[0] : S.active);
}
function askName(msg, def) {
  let n = (prompt(msg, def) || '').trim();
  if (!n) return null;
  if (!n.endsWith('.py')) n += '.py';
  if (!okName(n)) { alert('Use letters, digits and _ only (so it can be imported), e.g. my_module.py'); return null; }
  return n;
}
function newFile() {
  const n = askName('New file name:', 'untitled.py');
  if (!n) return;
  if (!(n in S.files)) S.files[n] = '';
  openFile(n);
}
function renameFile(old) {
  const n = askName('Rename to:', old);
  if (!n || n === old) return;
  if (n in S.files) return alert(n + ' already exists.');
  const src = S.files[old], doc = docs[old];
  forget(old);
  S.files[n] = src;
  if (doc) docs[n] = doc;
  S.open = S.open.map(x => (x === old ? n : x));
  if (S.active === old) S.active = n;
  S.tl = null; S.step = null; S.error = null;
  chrome(); save(); showMarks(); updateStepper(); refresh();
}
function deleteFile(n) {
  if (Object.keys(S.files).length < 2) return alert('Keep at least one file.');
  if (!confirm(`Delete ${n}? This can't be undone.`)) return;
  forget(n);
  S.open = S.open.filter(x => x !== n);
  if (!S.open.length) S.open = [Object.keys(S.files)[0]];
  S.tl = null; S.step = null; S.error = null;
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
  const n = S.active, src = S.files[n], key = src + '\0' + modsOf();
  if (S.key[n] !== key) {
    let g;
    try { g = JSON.parse(await W.call('analyze', { src, mods: modsOf() })); } catch { return; }
    if (n !== S.active || src !== S.files[n]) return; // edited or switched while we waited
    S.key[n] = key;
    if (g.error) {
      S.err[n] = '  syntax error, ' + g.error;
      S.hints[n] = [{ line: g.line, msg: 'Syntax error: ' + g.msg, kind: 'error' }];
    } else {
      S.err[n] = '';
      S.graph[n] = g;
      S.hints[n] = g.hints;
    }
  }
  $('#maperr').textContent = S.err[n] || '';
  draw();
  showHints();
}
const traceOf = file => {
  if (S.step == null || !S.tl) return S.trace[file];
  if (S.views?.s !== S.step) S.views = { s: S.step, v: NodeMap.viewAt(S.tl, S.step) };
  return S.views.v[file];
};
const nowAt = () => (S.step == null || !S.tl ? [] : [S.tl.files[S.tl.steps[2 * S.step]], S.tl.steps[2 * S.step + 1]]);
function draw() {
  const g = S.graph[S.active], box = $('#map');
  if (!g) { box.innerHTML = '<div class="empty">Nothing to map yet.</div>'; S.dim = null; return; }
  const [nf, nl] = nowAt();
  const b = NodeMap.build(g, traceOf(S.active), {
    fold: new Set(S.fold[S.active]),
    now: nf === S.active ? nl : null,
    err: S.error?.file === S.active ? S.error.line : null,
  });
  box.innerHTML = b.svg;
  S.dim = b;
  applyZoom();
  mark();
  if (S.step != null) box.querySelector('.node.now')?.scrollIntoView({ block: 'center', inline: 'nearest' });
}
const curZoom = () => (P.zoom === 'fit' && S.dim ? Math.min(1.5, ($('#map').clientWidth - 4) / S.dim.w) : +P.zoom || 1);
function applyZoom() {
  const svg = $('#map svg');
  if (!svg || !S.dim) return;
  const z = curZoom();
  svg.setAttribute('width', S.dim.w * z);
  svg.setAttribute('height', S.dim.h * z);
  $('#zlabel').textContent = Math.round(z * 100) + '%';
}
const zoomBy = f => { P.zoom = Math.max(.3, Math.min(2.5, curZoom() * f)); applyZoom(); store(PREFS, P); };
$('#z-in').onclick = () => zoomBy(1.15);
$('#z-out').onclick = () => zoomBy(1 / 1.15);
$('#z-fit').onclick = () => { P.zoom = 'fit'; applyZoom(); store(PREFS, P); };
$('#zlabel').onclick = () => { P.zoom = 1; applyZoom(); store(PREFS, P); };
$('#map').addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); } }, { passive: false });
addEventListener('resize', applyZoom);

function matches(g, q) { // nodes that mention q, and both ends of wires carrying q
  const ids = new Set();
  g.nodes.forEach(n => { if (n.text.toLowerCase().includes(q) || n.show.some(s => s.toLowerCase() === q)) ids.add(n.id); });
  g.wires.forEach(w => { if (w.label.toLowerCase().includes(q)) { ids.add(w.from); ids.add(w.to); } });
  return ids;
}
function paint() { // highlight state: search hits, else the hovered / cursor node and its wires
  const svg = $('#map svg'), g = S.graph[S.active];
  if (!svg || !g) return;
  const vis = id => { while (id != null && !svg.querySelector(`.node[data-id="${id}"]`)) id = g.nodes[id].parent; return id; }; // folded -> its container
  const q = $('#q').value.trim().toLowerCase();
  const hit = q ? new Set([...matches(g, q)].map(vis)) : null;
  const a = act == null ? null : vis(act), id = hov ?? a;
  svg.querySelectorAll('.node').forEach(e => {
    const i = +e.dataset.id;
    e.classList.toggle('act', i === a);
    e.classList.toggle('hit', !!hit && hit.has(i));
  });
  svg.classList.toggle('q', !!hit);
  svg.classList.toggle('f', !!hit || id != null);
  svg.querySelectorAll('.wire').forEach(w => w.classList.toggle('on', hit ? w.dataset.l.toLowerCase().includes(q) : id != null && (+w.dataset.a === id || +w.dataset.b === id)));
}
function mark(scroll) {
  const g = S.graph[S.active];
  act = g ? NodeMap.nodeAt(g, cm.getCursor().line + 1)?.id ?? null : null;
  paint();
  if (scroll) $('#map .node.act')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
$('#map').addEventListener('mouseover', e => {
  const id = e.target.closest('.node')?.dataset.id;
  const v = id == null ? null : +id;
  if (v !== hov) { hov = v; paint(); }
});
$('#map').addEventListener('mouseleave', () => { hov = null; paint(); });
$('#map').onclick = e => {
  const f = e.target.closest('.fold');
  if (f) { // collapse / expand a container
    const set = new Set(S.fold[S.active]);
    set.has(f.dataset.fold) ? set.delete(f.dataset.fold) : set.add(f.dataset.fold);
    S.fold[S.active] = [...set];
    return draw();
  }
  const n = e.target.closest('.node');
  if (n) gotoLine(+n.dataset.line);
};
$('#fold-all').onclick = () => { const g = S.graph[S.active]; if (g) { S.fold[S.active] = g.nodes.filter(n => n.kids.length).map(NodeMap.foldKey); draw(); } };
$('#unfold-all').onclick = () => { S.fold[S.active] = []; draw(); };
let qi = 0;
$('#q').oninput = () => { qi = 0; paint(); };
$('#q').onkeydown = e => {
  if (e.key !== 'Enter') return;
  const hits = [...document.querySelectorAll('#map .node.hit')];
  if (hits.length) hits[qi++ % hits.length].scrollIntoView({ block: 'center', inline: 'nearest' });
};

// ---- preferences: theme, font size, wire filters
function applyPrefs() {
  document.body.classList.toggle('light', P.light);
  document.body.style.setProperty('--fs', P.font + 'px');
  cm.setOption('theme', P.light ? 'vscode-light' : 'vscode');
  $('#theme').textContent = P.light ? '☾' : '☀';
  const m = $('#map');
  m.classList.toggle('no-data', !P.data);
  m.classList.toggle('no-call', !P.call);
  m.classList.toggle('no-back', !P.back);
  m.classList.toggle('only', P.only);
  for (const k of ['data', 'call', 'back', 'only']) $('#w-' + k).setAttribute('aria-pressed', P[k]);
  cm.refresh();
  store(PREFS, P);
}
for (const k of ['data', 'call', 'back', 'only']) $('#w-' + k).onclick = () => { P[k] = !P[k]; applyPrefs(); };
$('#theme').onclick = () => { P.light = !P.light; applyPrefs(); };
$('#font-down').onclick = () => { P.font = Math.max(10, P.font - 1); applyPrefs(); };
$('#font-up').onclick = () => { P.font = Math.min(28, P.font + 1); applyPrefs(); };

// ---- step through the last run
const nSteps = () => (S.tl ? S.tl.steps.length / 2 : 0);
let playT = null;
function stopPlay() { clearInterval(playT); playT = null; $('#s-play').textContent = '▶'; }
function setStep(s) { // s = number of steps already executed; null = finished
  if (s != null && s >= nSteps()) s = null;
  S.step = s == null ? null : Math.max(0, s);
  S.views = null;
  const [f] = nowAt();
  if (f && f !== S.active) return openFile(f);
  draw(); showMarks(); updateStepper();
}
function updateStepper() {
  const n = nSteps();
  $('#steps').hidden = !n;
  if (!n) return;
  $('#s-range').max = n;
  $('#s-range').value = S.step ?? n;
  const [f, l] = nowAt();
  $('#s-label').textContent = S.step == null ? `finished · ${n.toLocaleString()} steps${S.tl.trunc ? ' (first part recorded)' : ''}` : `step ${S.step} / ${n} · ${f}:${l}`;
  $('#s-play').textContent = playT ? '❚❚' : '▶';
}
$('#s-first').onclick = () => { stopPlay(); setStep(0); };
$('#s-prev').onclick = () => { stopPlay(); setStep((S.step ?? nSteps()) - 1); };
$('#s-next').onclick = () => { stopPlay(); setStep(S.step == null ? null : S.step + 1); };
$('#s-last').onclick = () => { stopPlay(); setStep(null); };
$('#s-range').oninput = e => { stopPlay(); setStep(+e.target.value); };
$('#s-play').onclick = () => {
  if (playT) return stopPlay();
  if (S.step == null) setStep(0);
  playT = setInterval(() => {
    const s = (S.step ?? nSteps()) + 1;
    if (s >= nSteps()) { stopPlay(); setStep(null); } else setStep(s);
  }, 160);
  updateStepper();
};

// ---- run / stop / input
// Python can't block waiting for input() in a worker without special server headers, so input() asks for the answer
// and the page re-runs the program from the top, feeding it the answers collected so far (random is seeded the same).
let job = null;
const setRunning = on => { $('#run').disabled = $('#doctest').disabled = on; $('#stop').hidden = !on; };
async function run(mode = 'run') {
  if (job) return;
  stopPlay();
  S.tl = null; S.step = null; S.error = null;
  showMarks(); updateStepper(); draw();
  job = { files: { ...S.files }, main: S.active, mode, answers: [], seed: Math.floor(Math.random() * 2 ** 31) };
  $('#out').textContent = '';
  shown = 0;
  out(`▶ ${mode === 'doctest' ? 'doctest ' : ''}${S.active}\n`, 'dim');
  attempt();
}
async function attempt() {
  setRunning(true);
  setStatus('Running…');
  seen = 0;
  await new Promise(r => setTimeout(r, 30)); // let the browser paint first
  const t0 = performance.now(), j = job;
  let res = null;
  try {
    res = JSON.parse(await W.call('run', { files: j.files, main: j.main, mode: j.mode, answers: j.answers, seed: j.seed }));
  } catch (e) {
    if (e === STOPPED) return;
    out(String(e.message || e) + '\n', 'err');
  }
  if (job !== j) return;
  if (res?.need_input) {
    setStatus('Waiting for your input…');
    $('#inrow').hidden = false;
    $('#in').value = '';
    $('#in').focus();
    return;
  }
  finish(res, t0);
}
function finish(res, t0) {
  job = null;
  setRunning(false);
  setStatus('Ready');
  if (res) { S.trace = res.files; S.tl = res.timeline; S.step = null; S.views = null; S.error = res.error; }
  out(`\n[finished in ${Math.round(performance.now() - t0)} ms]\n`, 'dim');
  const e = S.error;
  if (e && e.file !== S.active && S.files[e.file]) openFile(e.file); else { draw(); showMarks(); updateStepper(); }
  if (e && e.file === S.active) cm.scrollIntoView({ line: e.line - 1, ch: 0 }, 120);
}
$('#in').onkeydown = e => {
  if (e.key !== 'Enter' || !job) return;
  job.answers.push(e.target.value);
  $('#inrow').hidden = true;
  attempt();
};
function stop() {
  if (!job) return;
  job = null;
  $('#inrow').hidden = true;
  W.restart();
  out('\n■ stopped\n', 'dim');
  setRunning(false);
  setStatus('Restarting Python…');
  W.ready.then(() => { setStatus('Ready'); refresh(); });
}
$('#run').onclick = () => run();
$('#doctest').onclick = () => run('doctest');
$('#stop').onclick = stop;

// ---- import / export / share
const download = (blob, name) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
};
const safeName = p => {
  const n = p.split(/[\\/]/).pop().replace(/\.py$/i, '').replace(/\W/g, '_') || 'file';
  return (/^\d/.test(n) ? '_' : '') + n + '.py';
};
function mergeFiles(got) {
  const names = Object.keys(got);
  names.forEach(n => { S.files[n] = got[n]; docs[n]?.setValue(got[n]); delete S.trace[n]; });
  S.tl = null; S.step = null; S.error = null;
  openFile(names[0]);
}
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
  mergeFiles(got);
}
$('#imp').onclick = () => $('#pick').click();
$('#pick').onchange = async e => { await importFiles([...e.target.files]); e.target.value = ''; };
$('#exp').onclick = async () => {
  setStatus('Exporting…');
  const zip = new JSZip();
  for (const [name, src] of Object.entries(S.files)) {
    zip.file(name, src);
    try {
      const g = JSON.parse(await W.call('analyze', { src, mods: modsOf() }));
      if (!g.error) zip.file(name.replace(/\.py$/, '') + '_nodemap.png', await NodeMap.png(g, S.trace[name]));
    } catch {}
  }
  download(await zip.generateAsync({ type: 'blob' }), 'python_project.zip');
  setStatus('Ready');
};

// a share link is the project, deflated + base64url, in the #fragment (never sent to a server)
const b64u = u8 => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const pipe = async (bytes, Stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'))).arrayBuffer());
async function pack(files) {
  const raw = new TextEncoder().encode(JSON.stringify(files));
  return window.CompressionStream ? 'z' + b64u(await pipe(raw, CompressionStream)) : 'r' + b64u(raw);
}
async function unpack(s) {
  const raw = unb64u(s.slice(1));
  return JSON.parse(new TextDecoder().decode(s[0] === 'z' ? await pipe(raw, DecompressionStream) : raw));
}
$('#share').onclick = async () => {
  const url = location.href.split('#')[0] + '#p=' + await pack(S.files);
  try { await navigator.clipboard.writeText(url); setStatus(`Link copied (${url.length.toLocaleString()} characters)`); }
  catch { prompt('Copy this link:', url); }
  if (url.length > 8000) alert('This link is very long and some chat apps may cut it off. Use Export to send a zip instead.');
  else if (location.protocol === 'file:') alert('This page is opened from a file, so the link only works on this computer. Once it is hosted (GitHub Pages) the link works for everyone.');
};
async function loadShared() {
  const m = /^#p=(.+)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.href.split('#')[0]);
  let files;
  try { files = await unpack(m[1]); } catch { return alert("That share link couldn't be read."); }
  const names = Object.keys(files || {});
  if (!names.length || names.length > 50 || !names.every(n => okName(n) && typeof files[n] === 'string' && files[n].length < 500000)) {
    return alert("That share link doesn't contain a valid project.");
  }
  if (confirm(`Open a shared project (${names.join(', ')})?\nFiles with the same names will be replaced.`)) mergeFiles(files);
}
addEventListener('hashchange', loadShared);

// ---- resizable panels
const drag = (el, fn) => el.addEventListener('pointerdown', e => {
  el.setPointerCapture(e.pointerId);
  const up = () => { el.removeEventListener('pointermove', fn); el.removeEventListener('pointerup', up); cm.refresh(); applyZoom(); };
  el.addEventListener('pointermove', fn);
  el.addEventListener('pointerup', up);
});
drag($('#vsplit'), e => document.body.style.setProperty('--map-w', Math.max(240, innerWidth - e.clientX) + 'px'));
drag($('#hsplit'), e => document.body.style.setProperty('--con-h', Math.max(60, innerHeight - 22 - e.clientY) + 'px'));

// ---- go
cm.swapDoc(docOf(S.active));
chrome();
applyPrefs();
W.start();
W.ready.then(() => { setStatus('Ready'); refresh(); }, e => {
  setStatus('Python failed to load');
  $('#map').innerHTML = '<div class="empty">Could not load Python. Check your connection and reload.</div>';
  out(`Could not load Python: ${e.message || e}\nThis page needs internet access to cdn.jsdelivr.net (Pyodide) and cdnjs.cloudflare.com (editor, zip).\n`, 'err');
});
loadShared();
