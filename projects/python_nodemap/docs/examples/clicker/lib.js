/* Example GUI library, the browser half (see lib.py). A view needs two methods:
   apply(tree)  draw the frame Python sent; tree === null means "close everything" (new run, Stop, program replaced)
   setSend(fn)  the app gives you fn; call fn({...}) to send an event (any JSON object) to the library's dispatch() */
{
  let box = null, send = () => {};
  const view = {
    setSend: f => { send = f; },
    apply(tree) {
      if (!tree || !tree.open) { box?.remove(); box = null; return; }
      if (!box) {
        box = document.createElement('div');
        box.style.cssText = 'position:fixed;top:90px;left:130px;z-index:60;background:#fff;color:#000;padding:12px;border:1px solid #888;display:flex;gap:10px;align-items:center';
        box.innerHTML = '<button>Click me</button><span></span><b style="cursor:pointer" title="close">✕</b>';
        box.querySelector('button').onclick = () => send({ type: 'click' });
        box.querySelector('b').onclick = () => send({ type: 'close' });
        document.body.append(box);
      }
      box.querySelector('span').textContent = tree.count;
    },
  };
  PyLibs.add({ name: 'clicker', python: 'docs/examples/clicker/lib.py', members: 'show mainloop', view });
}
