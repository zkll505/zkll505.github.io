/* Library registry. Each library lives in libs/<name>/ and registers itself with PyLibs.add({...}) from its lib.js.
   Nothing else in the app knows about specific libraries. How to write one: docs/ADDING_A_LIBRARY.md */
const fetchText = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not load ${url} (HTTP ${r.status})`);
  return r.text();
};

// A real browser window for a panel or a program's GUI. Where the browser has Document Picture-in-Picture (Chrome, Edge) the first one floats
// above every other window, like a video. A page can have only one of those (asking again would close it), and Firefox has none, so the
// others are ordinary popups. Either needs a recent click, or open() gives null.
const PopOut = (() => {
  const wins = new Set();
  let serial = 0;
  const theme = w => { // follows the page's theme and font size
    w.document.body.className = document.body.className + ' pip';
    w.document.body.style.cssText = document.body.style.cssText;
  };
  const pipFree = () => !!window.documentPictureInPicture && !documentPictureInPicture.window && !!navigator.userActivation?.isActive;
  addEventListener('pagehide', () => wins.forEach(w => w.close()));
  return {
    pipFree,
    isPip: w => w === window.documentPictureInPicture?.window,
    /** the new window (width x height inside), styled like the page, or null. onclose runs when it goes, whoever closes it. */
    async open(title, width, height, onclose) {
      if (navigator.userActivation && !navigator.userActivation.isActive) return null; // (no click: don't set off the browser's popup warning)
      let w = null;
      if (pipFree()) try { w = await documentPictureInPicture.requestWindow({ width, height }); } catch {} // (refused: try a popup)
      w ||= window.open('', 'pynodemap-' + ++serial, `popup,width=${width},height=${height}`);
      if (!w) return null;
      const d = w.document;
      d.title = title;
      document.querySelectorAll('link[rel="stylesheet"], style').forEach(n => {
        const c = n.cloneNode(true);
        if (n.href) c.href = n.href; // (absolute: the new document has no address of its own to resolve it against)
        d.head.append(c);
      });
      theme(w);
      wins.add(w);
      w.addEventListener('pagehide', () => { wins.delete(w); onclose(); });
      return w;
    },
    find(sel) {
      for (const w of wins) { const e = w.document.querySelector(sel); if (e) return e; }
      return null;
    },
    sync: () => wins.forEach(theme),
  };
})();

const PyLibs = (() => {
  const libs = [];
  const words = s => (s || '').split(/\s+/).filter(Boolean);
  return {
    /** register a manifest (fields: docs/ADDING_A_LIBRARY.md). The order of add() calls, i.e. of the <script> tags, is the load order. */
    add(lib) {
      if (!lib.name || libs.some(l => l.name === lib.name)) throw new Error(`library "${lib.name}" has no name or is registered twice`);
      libs.push(lib);
    },
    names: () => libs.map(l => l.name), // also the import allow-list (runner.configure) and the modules autocomplete offers
    modes: () => libs.flatMap(l => (l.modes || []).map(m => ({ ...m, lib: l.name }))), // extra run buttons
    views: () => libs.filter(l => l.view), // the libraries that draw windows; app.js connects each view's events to the worker
    view: name => (libs.find(l => l.name === name) || {}).view,
    // close every library's windows: a new run, Stop, or a replaced project
    closeViews: () => libs.forEach(l => l.view && l.view.apply(null)),
    /** autocomplete: { module: [members] }, including submodules such as tkinter.messagebox */
    members() {
      const m = {};
      for (const l of libs) {
        m[l.name] = words(l.members);
        for (const [sub, list] of Object.entries(l.submodules || {})) m[sub] = words(list);
      }
      return m;
    },
    /** autocomplete: attribute names to offer after "something." when we don't know what something is */
    methods: () => libs.flatMap(l => words(l.methods)),
    /** the Python files of every library that has one, in registration order (a library may rely on earlier ones) */
    load: () => Promise.all(libs.filter(l => l.python).map(async l => ({ name: l.name, src: await fetchText(l.python) }))),
  };
})();
