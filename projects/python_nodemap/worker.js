/* Runs Pyodide in a Web Worker so the page never freezes and Stop can kill a run.
   app.js turns this function's source into a Blob worker; that also works from file://, unlike new Worker('worker.js').
   It must stay self-contained (no outside variables). */
function workerMain() {
  let api, cur = null, last = 0;
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

  onmessage = async ({ data: m }) => {
    try {
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
        api = { analyze: ns.get('analyze'), run: ns.get('run') };
      } else if (m.type === 'analyze') {
        result = api.analyze(m.src, JSON.stringify(m.mods));
      } else if (m.type === 'run') {
        result = api.run(JSON.stringify(m.files), m.main, m.mode, JSON.stringify(m.answers), m.seed);
        flush();
      }
      postMessage({ id: m.id, result });
    } catch (e) {
      flush();
      postMessage({ id: m.id, error: String((e && e.message) || e) });
    }
  };
}
