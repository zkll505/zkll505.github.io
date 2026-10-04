/* Runs Pyodide in a Web Worker so the page never freezes and Stop can kill a run.
   app.js turns this function's source into a Blob worker; that also works from file://, unlike new Worker('worker.js').
   It must stay self-contained (no outside variables). */
function workerMain() {
  let api, cur = null, last = 0, tkTimer = null;
  const NO_WINDOWS = { wins: [], dialogs: [], wants: [], focus: null };
  const flush = () => {
    if (cur) postMessage({ type: 'out', cls: cur.cls, text: cur.text });
    cur = null;
    last = performance.now();
  };
  const emit = (cls, text) => { // batch output so a print() loop doesn't flood the page with messages
    if (cur && cur.cls !== cls) flush();
    cur = cur || { cls, text: '' };
    cur.text += text;
    if (cur.text.length > 8192 || (text.includes('\n') && performance.now() - last > 30)) flush();
  };
  const stream = cls => { const d = new TextDecoder(); return { write: b => (emit(cls, d.decode(b, { stream: true })), b.length) }; };

  // tkinter windows: Python posts the widget tree; timers (after()) and window events are driven from here
  self.tkPost = s => postMessage({ type: 'tk', tree: JSON.parse(s) });
  const tkReply = json => {
    const o = JSON.parse(json);
    if (o.tree) postMessage({ type: 'tk', tree: o.tree });
    if (o.files) postMessage({ type: 'trace', files: o.files });
    flush();
    clearTimeout(tkTimer);
    if (o.alive && o.next != null) tkTimer = setTimeout(() => tkReply(api.tk_tick()), Math.max(0, o.next));
  };

  onmessage = async ({ data: m }) => {
    try {
      if (m.type === 'tkevent') return tkReply(api.tk_event(JSON.stringify(m.ev)));
      if (m.type === 'tkreset') { // the project was replaced: stop the window, and tell the page so a tree already in flight can't revive it
        clearTimeout(tkTimer);
        if (api) api.tk_stop();
        return postMessage({ type: 'tk', tree: NO_WINDOWS });
      }
      let result;
      if (m.type === 'init') {
        importScripts(m.url + 'pyodide.js'); // classic worker: Pyodide 314+ only supports module workers, which Chrome blocks on file://
        // Download the big files ourselves first so the page can show real progress; Pyodide then finds them in the HTTP cache.
        const total = Object.values(m.sizes).reduce((a, b) => a + b, 0);
        let loaded = 0, t = 0;
        await Promise.all(Object.keys(m.sizes).map(async f => {
          const r = await fetch(m.url + f);
          if (!r.ok) throw new Error(`Could not download ${f} (HTTP ${r.status})`);
          const rd = r.body.getReader();
          for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            loaded += value.length;
            if (performance.now() - t > 80) { t = performance.now(); postMessage({ type: 'progress', loaded, total }); }
          }
        }));
        postMessage({ type: 'progress', loaded: total, total });
        const py = await loadPyodide({ indexURL: m.url });
        py.setStdout(stream(''));
        py.setStderr(stream('err'));
        const ns = py.globals.get('dict')();
        ns.set('__name__', 'nm_runner'); // own namespace, so the import guard never treats runner code as user code
        py.runPython(m.runner, { globals: ns });
        api = {};
        for (const f of ['analyze', 'run', 'tk_install', 'tk_event', 'tk_tick', 'tk_pump', 'tk_stop']) api[f] = ns.get(f);
        api.tk_install(m.tk);
      } else if (m.type === 'analyze') {
        result = api.analyze(m.src, JSON.stringify(m.mods));
      } else if (m.type === 'run') {
        clearTimeout(tkTimer);
        postMessage({ type: 'tk', tree: NO_WINDOWS }); // the previous program's window must not outlive this run
        result = api.run(JSON.stringify(m.files), m.main, m.mode, JSON.stringify(m.answers), m.seed);
        flush();
        tkReply(api.tk_pump()); // a window left open by mainloop(): start its timers
      }
      postMessage({ id: m.id, result });
    } catch (e) {
      flush();
      postMessage({ id: m.id, error: String((e && e.message) || e) });
    }
  };
}
