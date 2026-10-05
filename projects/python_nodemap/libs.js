/* Library registry. Each library lives in libs/<name>/ and registers itself with PyLibs.add({...}) from its lib.js.
   Nothing else in the app knows about specific libraries. How to write one: docs/ADDING_A_LIBRARY.md */
const fetchText = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not load ${url} (HTTP ${r.status})`);
  return r.text();
};

const PyLibs = (() => {
  const libs = [];
  const words = s => (s || '').split(/\s+/).filter(Boolean);
  return {
    add(lib) {
      if (!lib.name || libs.some(l => l.name === lib.name)) throw new Error(`library "${lib.name}" has no name or is registered twice`);
      libs.push(lib);
    },
    names: () => libs.map(l => l.name),
    modes: () => libs.flatMap(l => (l.modes || []).map(m => ({ ...m, lib: l.name }))), // extra run buttons
    views: () => libs.filter(l => l.view),
    view: name => (libs.find(l => l.name === name) || {}).view,
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
