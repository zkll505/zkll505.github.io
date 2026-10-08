/* Runs Pyodide in a Web Worker so the page never freezes and Stop can kill a run.
   app.js turns this function's source into a Blob worker, so it can't use outside variables.
   Messages in:  init {url, runner, libs, allowed, sizes} | analyze | run {..., mailbox, locked} | guievent {lib, ev} | guireset
   (mailbox = the URL of the service worker's mailbox, or '': how the running program reads window events; see runner.mailbox)
   Messages out: out {cls, text} | progress | gui {lib, tree} (tree null = close the windows) | trace {files} | {id, result|error} */
function workerMain() {
  let api, cur = null, last = 0;
  const timers = {}; // one after()-timer per GUI library
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

  // GUI libraries (tkinter, turtle): Python posts the window's tree; timers and window events are driven from here
  self.guiPost = (lib, s) => postMessage({ type: 'gui', lib, tree: JSON.parse(s) });
  const guiReply = json => {
    const o = JSON.parse(json);
    if (o.tree) postMessage({ type: 'gui', lib: o.lib, tree: o.tree });
    if (o.files) postMessage({ type: 'trace', files: o.files });
    flush();
    clearTimeout(timers[o.lib]);
    if (o.alive && o.next != null) timers[o.lib] = setTimeout(() => guiReply(api.gui_tick(o.lib)), Math.max(0, o.next));
  };
  const libs = () => JSON.parse(api.gui_libs());
  const closeWindows = () => libs().forEach(lib => { clearTimeout(timers[lib]); postMessage({ type: 'gui', lib, tree: null }); });

  onmessage = async ({ data: m }) => {
    try {
      if (m.type === 'guievent') return guiReply(api.gui_event(m.lib, JSON.stringify(m.ev)));
      if (m.type === 'guireset') { // the project was replaced: stop the windows, and tell the page so a tree already in flight can't revive them
        if (api) { api.gui_stop(); closeWindows(); }
        return;
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
        for (const f of ['configure', 'load_lib', 'analyze', 'run', 'gui_event', 'gui_tick', 'gui_pump', 'gui_stop', 'gui_libs']) api[f] = ns.get(f);
        api.configure(JSON.stringify(m.allowed));
        for (const l of m.libs) api.load_lib(l.name, l.src); // in the order the libraries were registered
      } else if (m.type === 'analyze') {
        result = api.analyze(m.src, JSON.stringify(m.mods));
      } else if (m.type === 'run') {
        closeWindows(); // the previous program's windows must not outlive this run (also covers a tree already in flight)
        result = api.run(JSON.stringify(m.files), m.main, m.mode, JSON.stringify(m.answers), m.seed, m.mailbox || '', JSON.stringify(m.locked || []));
        flush();
        libs().forEach(lib => guiReply(api.gui_pump(lib))); // a window left open by mainloop(): start its timers
      }
      postMessage({ id: m.id, result });
    } catch (e) {
      flush();
      postMessage({ id: m.id, error: String((e && e.message) || e) });
    }
  };
}
