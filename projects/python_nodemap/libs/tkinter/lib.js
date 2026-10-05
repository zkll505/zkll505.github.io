/* The tkinter library. lib.py is the tkinter look-alike (the widgets, as plain Python objects). This file is the other half:
   it draws the widget tree that lib.py posts as floating HTML windows, and sends clicks, typing and
   mouse/key events back to Python. Layout: pack = nested flex "cavity" bands (Tk's own model), grid = CSS grid,
   place = absolute positioning. Widget elements are reused between updates so typing and focus survive redraws. */

{
  const TkView = (() => {
    let send = () => {}, wants = new Set(), z = 20, focusN = 0;
    const wins = new Map(); // window id -> { el, body, bar, menubar, els: Map(widget id -> element) }
    const host = () => document.getElementById('tkhost');
    const mk = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.append(e); return e; };
    const CONTAINERS = new Set(['frame', 'labelframe']);

    // ---------------------------------------------------------------- values: fonts, colours, anchors
    const fontCss = f => (f ? `${f.i ? 'italic ' : ''}${f.b ? 'bold ' : ''}${f.s}${f.px ? 'px' : 'pt'} ${f.f && f.f !== 'TkDefaultFont' ? `"${f.f}", ` : ''}"Segoe UI", Tahoma, sans-serif` : '');
    const CURSOR = { hand2: 'pointer', hand1: 'pointer', arrow: 'default', xterm: 'text', watch: 'wait', crosshair: 'crosshair', fleur: 'move' };
    const ANCHOR = { center: ['center', 'center'], n: ['center', 'flex-start'], s: ['center', 'flex-end'], w: ['flex-start', 'center'], e: ['flex-end', 'center'],
                     nw: ['flex-start', 'flex-start'], ne: ['flex-end', 'flex-start'], sw: ['flex-start', 'flex-end'], se: ['flex-end', 'flex-end'] };
    const RELIEF = { raised: 'outset', sunken: 'inset', groove: 'groove', ridge: 'ridge', solid: 'solid' };

    function css(e, n) { // options -> CSS (the whole style is rebuilt every update)
      const o = n.o, s = e.style, t = n.t;
      s.cssText = '';
      if (o.bg) s.backgroundColor = o.bg;
      if (o.fg) s.color = o.fg;
      if (o.font) { s.font = fontCss(o.font); s.textDecoration = [o.font.u && 'underline', o.font.o && 'line-through'].filter(Boolean).join(' '); }
      if (o.relief && o.relief !== 'flat') { s.borderStyle = RELIEF[o.relief] || 'solid'; s.borderWidth = (o.bd ?? 2) + 'px'; s.borderColor = '#9a9a9a'; }
      else if (o.relief === 'flat') s.border = 'none';
      if (o.padx != null) s.paddingLeft = s.paddingRight = o.padx + 'px';
      if (o.pady != null) s.paddingTop = s.paddingBottom = o.pady + 'px';
      if (o.cursor) s.cursor = CURSOR[o.cursor] || '';
      e.classList.toggle('tk-disabled', o.state === 'disabled');
      const chars = (w, d) => `${w ?? d}ch`;
      if (t === 'label' || t === 'message') {
        if (o.width) s.width = chars(o.width);
        if (o.height) s.minHeight = o.height * 1.25 + 'em';
        const [jx] = ANCHOR[o.anchor || 'center'] || ANCHOR.center;
        s.justifyContent = jx;
        s.textAlign = o.justify || 'center';
        if (o.wraplength) { s.maxWidth = o.wraplength + 'px'; s.overflowWrap = 'anywhere'; }
        if (t === 'message' && o.width) s.width = o.width + 'px';
      } else if (t === 'button' || t === 'checkbutton' || t === 'radiobutton') {
        if (o.width) s.width = chars(o.width);
        if (o.height) s.minHeight = o.height * 1.25 + 'em';
      } else if (t === 'entry' || t === 'spinbox' || t === 'combobox') {
        s.width = `calc(${chars(o.width, t === 'spinbox' ? 10 : 20)} + 4px)`;
        if (o.justify) s.textAlign = o.justify;
      }
      else if (t === 'listbox') s.width = `calc(${chars(o.width, 20)} + 24px)`;
      else if (t === 'scale') { if (o.orient === 'vertical') s.height = (o.length ?? 100) + 'px'; else s.width = (o.length ?? 100) + 'px'; }
      else if (CONTAINERS.has(t)) {
        const empty = !(n.k && n.k.length), placed = n.k && n.k.some(k => k.m.k === 'place');
        if (empty || placed) { if (o.width) s.width = o.width + 'px'; if (o.height) s.height = o.height + 'px'; }
      }
    }

    // ---------------------------------------------------------------- widget elements
    function make(n) {
      const t = n.t;
      let e;
      switch (t) {
        case 'label': case 'message': e = mk('div', 'tk tk-label'); break;
        case 'button': e = mk('button', 'tk tk-button'); e.type = 'button'; e.onclick = () => send({ t: 'click', id: e._id }); break;
        case 'entry': e = mk('input', 'tk tk-entry'); e.oninput = () => send({ t: 'value', id: e._id, v: e.value }); break;
        case 'text': e = mk('textarea', 'tk tk-text'); e.spellcheck = false; e.oninput = () => send({ t: 'value', id: e._id, v: e.value }); break;
        case 'checkbutton': case 'radiobutton': {
          e = mk('label', 'tk tk-check');
          e._in = mk('input', '', e); e._in.type = t === 'checkbutton' ? 'checkbox' : 'radio';
          e._tx = mk('span', '', e);
          e._in.onchange = () => send(t === 'checkbutton' ? { t: 'check', id: e._id, v: e._in.checked } : { t: 'radio', id: e._id });
          break;
        }
        case 'scale': {
          e = mk('div', 'tk tk-scale'); e._lab = mk('span', 'tk-sl', e);
          e._in = mk('input', '', e); e._in.type = 'range'; e._val = mk('span', 'tk-sv', e);
          e._in.oninput = () => { e._val.textContent = e._in.value; send({ t: 'value', id: e._id, v: e._in.value }); };
          break;
        }
        case 'spinbox': e = mk('input', 'tk tk-entry'); e.type = 'number'; e.oninput = () => send({ t: 'value', id: e._id, v: e.value }); break;
        case 'listbox':
          e = mk('select', 'tk tk-list');
          e.onchange = () => send({ t: 'sel', id: e._id, sel: [...e.selectedOptions].map(o => o.index) });
          break;
        case 'combobox': case 'optionmenu': case 'combobox!': {
          if (t === 'combobox') { // editable: text box + suggestions
            e = mk('input', 'tk tk-entry'); e._dl = mk('datalist', '', document.body); e._dl.id = 'dl' + n.id; e.setAttribute('list', e._dl.id);
            e.oninput = ev => send({ t: 'value', id: e._id, v: e.value, sel: !ev.inputType || ev.inputType === 'insertReplacementText' });
          } else {
            e = mk('select', 'tk tk-entry');
            e.onchange = () => send({ t: 'value', id: e._id, v: e.value, sel: true });
          }
          break;
        }
        case 'progressbar': e = mk('progress', 'tk tk-progress'); break;
        case 'separator': e = mk('div', 'tk tk-sep'); break;
        case 'scrollbar': e = mk('div', 'tk'); e.style.display = 'none'; break;
        case 'canvas': e = mk('canvas', 'tk tk-canvas'); e.tabIndex = 0; break; // focusable, so key bindings (turtle's onkey) work
        case 'labelframe': e = mk('fieldset', 'tk tk-frame tk-labelframe'); e._legend = mk('legend', '', e); break;
        default: e = mk('div', 'tk tk-frame'); // frame
      }
      e._t = t; e._inner = e; e.dataset.wid = n.id;
      e._id = n.id;
      return e;
    }

    function setValue(e, n, value) { // programmatic changes only (rev), so typing is never overwritten by a stale value
      if (e._rev !== n.r) { e.value = value; e._rev = n.r; }
    }

    function update(e, n) {
      const o = n.o, t = n.t;
      css(e, n);
      const dis = o.state === 'disabled';
      switch (t) {
        case 'label': case 'message': e.textContent = o.text ?? ''; break;
        case 'button': e.textContent = o.text ?? ''; e.disabled = dis; break;
        case 'entry': e.type = o.show ? 'password' : 'text'; e.readOnly = o.state === 'readonly'; e.disabled = dis; setValue(e, n, n.v); break;
        case 'text': e.cols = o.width ?? 80; e.rows = o.height ?? 24; e.wrap = o.wrap === 'none' ? 'off' : 'soft'; e.disabled = dis; setValue(e, n, n.v); break;
        case 'checkbutton': case 'radiobutton':
          e._tx.textContent = o.text ?? ''; e._in.checked = !!n.c; e._in.disabled = dis;
          if (t === 'radiobutton') e._in.name = 'rb' + n.g;
          break;
        case 'scale': {
          const i = e._in;
          i.min = o.from_ ?? 0; i.max = o.to ?? 100; i.step = o.resolution ?? 1; i.disabled = dis;
          i.style.writingMode = o.orient === 'vertical' ? 'vertical-lr' : ''; i.style.direction = o.orient === 'vertical' ? 'rtl' : '';
          if (e._rev !== n.r) { i.value = n.v; e._val.textContent = n.v; e._rev = n.r; }
          e._lab.textContent = o.label ?? ''; e._val.style.display = o.showvalue === false || o.showvalue === 0 ? 'none' : '';
          break;
        }
        case 'spinbox': if (o.from_ != null) { e.min = o.from_; e.max = o.to ?? ''; e.step = o.increment ?? 1; } e.disabled = dis; setValue(e, n, n.v); break;
        case 'listbox': {
          const key = JSON.stringify(n.items);
          if (e._key !== key) { e._key = key; e.replaceChildren(...n.items.map(s => { const op = mk('option'); op.textContent = s; return op; })); e._rev = null; }
          e.size = Math.max(2, o.height ?? 10); e.multiple = o.selectmode === 'multiple' || o.selectmode === 'extended';
          if (e._rev !== n.r) { [...e.options].forEach((op, i) => { op.selected = n.sel.includes(i); }); e._rev = n.r; }
          break;
        }
        case 'combobox': case 'optionmenu': {
          const items = n.items || [];
          const key = JSON.stringify(items);
          if (e._key !== key) {
            e._key = key;
            const opts = items.map(s => { const op = mk('option'); op.value = s; op.textContent = s; return op; });
            (e._dl || e).replaceChildren(...opts);
          }
          e.disabled = dis; setValue(e, n, n.v);
          if (e.tagName === 'SELECT') e.value = n.v;
          break;
        }
        case 'progressbar': e.max = n.max; if (o.mode === 'indeterminate') e.removeAttribute('value'); else e.value = n.v; break;
        case 'canvas': drawCanvas(e, n); break;
        case 'labelframe': e._legend.textContent = o.text ?? ''; break;
      }
    }

    // ---------------------------------------------------------------- canvas
    const ANCH_CANVAS = { center: ['center', 'middle'], n: ['center', 'top'], s: ['center', 'bottom'], w: ['left', 'middle'], e: ['right', 'middle'],
                          nw: ['left', 'top'], ne: ['right', 'top'], sw: ['left', 'bottom'], se: ['right', 'bottom'] };
    function drawCanvas(c, n) {
      const o = n.o, w = o.width ?? 378, h = o.height ?? 265, bg = o.bg || '#f0f0f0';
      if (c._rev === n.r && c.width === w && c.height === h && c._bg === bg) return;
      c._rev = n.r; c._bg = bg; c.width = w; c.height = h; // (resizing also clears it)
      const g = c.getContext('2d');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      for (const it of n.items) {
        if (it.o.state === 'hidden') continue;
        g.save();
        try { drawItem(g, it); } catch {}
        g.restore();
      }
    }
    function drawItem(g, it) {
      const o = it.o, c = it.c;
      const lw = o.width ?? 1, fill = o.fill, outline = o.outline;
      g.lineWidth = lw;
      const stroke = col => { if (col !== '' && lw > 0) { g.strokeStyle = col; g.stroke(); } };
      const dash = o.dash ? (Array.isArray(o.dash) ? o.dash : String(o.dash).split(/[ ,]+/).map(Number)) : [];
      g.setLineDash(dash.length ? dash.map(v => v * lw) : []);
      switch (it.t) {
        case 'line': {
          if (c.length < 4) return;
          g.beginPath(); g.moveTo(c[0], c[1]);
          for (let i = 2; i < c.length; i += 2) g.lineTo(c[i], c[i + 1]);
          g.lineCap = o.capstyle === 'round' ? 'round' : 'butt';
          g.strokeStyle = fill ?? 'black'; g.stroke();
          const head = (x, y, px, py) => {
            const a = Math.atan2(y - py, x - px), s = Math.max(8, lw * 3);
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - s * Math.cos(a - 0.4), y - s * Math.sin(a - 0.4)); g.lineTo(x - s * Math.cos(a + 0.4), y - s * Math.sin(a + 0.4)); g.closePath();
            g.fillStyle = fill ?? 'black'; g.fill();
          };
          const m = c.length;
          if (o.arrow === 'last' || o.arrow === 'both') head(c[m - 2], c[m - 1], c[m - 4], c[m - 3]);
          if (o.arrow === 'first' || o.arrow === 'both') head(c[0], c[1], c[2], c[3]);
          break;
        }
        case 'rectangle': {
          g.beginPath(); g.rect(Math.min(c[0], c[2]), Math.min(c[1], c[3]), Math.abs(c[2] - c[0]), Math.abs(c[3] - c[1]));
          if (fill) { g.fillStyle = fill; g.fill(); }
          stroke(outline ?? 'black');
          break;
        }
        case 'oval': {
          g.beginPath(); g.ellipse((c[0] + c[2]) / 2, (c[1] + c[3]) / 2, Math.abs(c[2] - c[0]) / 2, Math.abs(c[3] - c[1]) / 2, 0, 0, Math.PI * 2);
          if (fill) { g.fillStyle = fill; g.fill(); }
          stroke(outline ?? 'black');
          break;
        }
        case 'polygon': {
          if (c.length < 4) return;
          g.beginPath(); g.moveTo(c[0], c[1]);
          for (let i = 2; i < c.length; i += 2) g.lineTo(c[i], c[i + 1]);
          g.closePath();
          if (fill !== '') { g.fillStyle = fill ?? 'black'; g.fill(); }
          stroke(outline ?? '');
          break;
        }
        case 'arc': {
          const cx = (c[0] + c[2]) / 2, cy = (c[1] + c[3]) / 2, rx = Math.abs(c[2] - c[0]) / 2, ry = Math.abs(c[3] - c[1]) / 2;
          const a0 = -(o.start ?? 0) * Math.PI / 180, a1 = -((o.start ?? 0) + (o.extent ?? 90)) * Math.PI / 180, style = o.style || 'pieslice';
          g.beginPath();
          if (style === 'pieslice') g.moveTo(cx, cy);
          g.ellipse(cx, cy, rx, ry, 0, a0, a1, true);
          if (style !== 'arc') g.closePath();
          if (fill && style !== 'arc') { g.fillStyle = fill; g.fill(); }
          stroke(outline ?? 'black');
          break;
        }
        case 'text': {
          const [ta, tb] = ANCH_CANVAS[o.anchor || 'center'] || ANCH_CANVAS.center;
          g.font = fontCss(o.font) || '10pt "Segoe UI", sans-serif';
          g.fillStyle = fill ?? 'black'; g.textAlign = ta; g.textBaseline = tb === 'middle' ? 'middle' : tb;
          String(o.text ?? '').split('\n').forEach((ln, i) => g.fillText(ln, c[0], c[1] + i * 16));
          break;
        }
      }
    }

    // ---------------------------------------------------------------- layout: pack, grid, place
    const pad = m => `${m.pady[0]}px ${m.padx[1]}px ${m.pady[1]}px ${m.padx[0]}px`;

    function packSlave(k) { // one slave inside its parcel
      const m = k.n.m, b = mk('div', 'pkbox');
      b.style.flex = `${m.expand ? 1 : 0} 0 auto`;
      b.style.padding = pad(m);
      [b.style.justifyContent, b.style.alignItems] = ANCHOR[m.anchor] || ANCHOR.center;
      if (m.fill === 'x' || m.fill === 'both') b.classList.add('fx');
      if (m.fill === 'y' || m.fill === 'both') b.classList.add('fy');
      if (m.ipadx || m.ipady) k.el.style.padding = `${m.ipady}px ${m.ipadx}px`;
      b.append(k.el);
      return b;
    }
    function packTree(list) { // the first slave takes a band of the cavity; the rest share what is left
      if (!list.length) return null;
      const [k, ...rest] = list, side = k.n.m.side, w = mk('div', 'pk');
      w.style.flexDirection = side === 'top' || side === 'bottom' ? 'column' : 'row';
      const box = packSlave(k), r = packTree(rest), n = rest.filter(x => x.n.m.expand).length;
      // the rest of the cavity takes whatever is left (so a RIGHT slave reaches the far edge), unless this slave expands;
      // expanding slaves share the extra space equally
      if (r) r.style.flex = `${n || (k.n.m.expand ? 0 : 1)} 1 auto`;
      else w.style.justifyContent = side === 'right' || side === 'bottom' ? 'flex-end' : 'flex-start';
      if (side === 'top' || side === 'left') { w.append(box); if (r) w.append(r); } else { if (r) w.append(r); w.append(box); }
      return w;
    }
    function gridTemplates(inner, kids, cw) { // inline styles: re-applied on every render because css() resets them
      const maxc = Math.max(0, ...kids.map(k => k.n.m.column + k.n.m.columnspan), ...Object.keys(cw.c).map(i => +i + 1));
      const maxr = Math.max(0, ...kids.map(k => k.n.m.row + k.n.m.rowspan), ...Object.keys(cw.r).map(i => +i + 1));
      const track = cfg => (cfg.weight ? `minmax(${cfg.minsize ?? 0}px, ${cfg.weight}fr)` : cfg.minsize ? `minmax(${cfg.minsize}px, auto)` : 'auto');
      inner.style.gridTemplateColumns = Array.from({ length: maxc }, (_, i) => track(cw.c[i] || {})).join(' ');
      inner.style.gridTemplateRows = Array.from({ length: maxr }, (_, i) => track(cw.r[i] || {})).join(' ');
    }
    function gridLayout(inner, kids) {
      for (const k of kids) {
        const m = k.n.m, c = mk('div', 'gcell', inner), st = m.sticky || '';
        c.style.gridArea = `${m.row + 1} / ${m.column + 1} / span ${m.rowspan} / span ${m.columnspan}`;
        c.style.padding = pad(m);
        const we = st.includes('w') && st.includes('e'), ns = st.includes('n') && st.includes('s');
        c.style.justifySelf = we ? 'stretch' : st.includes('w') ? 'start' : st.includes('e') ? 'end' : 'center';
        c.style.alignSelf = ns ? 'stretch' : st.includes('n') ? 'start' : st.includes('s') ? 'end' : 'center';
        c.classList.toggle('sx', we); c.classList.toggle('sy', ns);
        if (m.ipadx || m.ipady) k.el.style.padding = `${m.ipady}px ${m.ipadx}px`;
        c.append(k.el);
      }
    }
    function placeLayout(inner, kids) {
      for (const k of kids) {
        const m = k.n.m, c = mk('div', 'plcell', inner), [ax, ay] = { center: [.5, .5], n: [.5, 0], s: [.5, 1], w: [0, .5], e: [1, .5], nw: [0, 0], ne: [1, 0], sw: [0, 1], se: [1, 1] }[m.anchor || 'nw'] || [0, 0];
        c.style.left = m.relx != null ? m.relx * 100 + '%' : (m.x ?? 0) + 'px';
        c.style.top = m.rely != null ? m.rely * 100 + '%' : (m.y ?? 0) + 'px';
        if (m.width != null) c.style.width = m.width + 'px';
        if (m.height != null) c.style.height = m.height + 'px';
        if (m.relwidth != null) c.style.width = m.relwidth * 100 + '%';
        if (m.relheight != null) c.style.height = m.relheight * 100 + '%';
        c.style.transform = `translate(${-ax * 100}%, ${-ay * 100}%)`;
        if (m.width != null || m.relwidth != null) c.classList.add('sx');
        if (m.height != null || m.relheight != null) c.classList.add('sy');
        c.append(k.el);
      }
    }
    function layout(inner, kids) { // a container uses grid or pack for the flowing children; place children float on top
      inner.replaceChildren(...(inner._legend ? [inner._legend] : []));
      inner.classList.remove('tk-grid', 'tk-place', 'tk-pack', 'tk-rel');
      const by = k => kids.filter(x => x.n.m.k === k), grid = by('grid'), pack = by('pack'), place = by('place');
      if (grid.length) { inner.classList.add('tk-grid'); gridLayout(inner, grid); }
      else if (pack.length) { inner.classList.add('tk-pack'); const t = packTree(pack); t.classList.add('root'); inner.append(t); }
      else inner.classList.add('tk-place');
      if (place.length) { inner.classList.add('tk-rel'); placeLayout(inner, place); }
    }

    function render(n, ctx) {
      const kind = n.t === 'combobox' && n.o.state === 'readonly' ? 'combobox!' : n.t;
      let e = ctx.els.get(n.id);
      if (!e || e._variant !== kind) { e = make({ ...n, t: kind }); e._variant = kind; e._t = n.t; ctx.els.set(n.id, e); }
      update(e, n);
      if (n.k) renderChildren(e._inner, n, ctx);
      return e;
    }
    function renderChildren(inner, node, ctx) {
      const kids = node.k.map(kn => ({ n: kn, el: render(kn, ctx) }));
      const sig = JSON.stringify([kids.map(k => [k.n.id, k.n.m]), node.cw]);
      if (inner._sig !== sig) { layout(inner, kids); inner._sig = sig; }
      if (kids.some(k => k.n.m.k === 'grid')) gridTemplates(inner, kids.filter(k => k.n.m.k === 'grid'), node.cw);
      ctx.live.push(...kids.map(k => k.n.id));
    }

    // ---------------------------------------------------------------- windows, menus, dialogs
    function menuEl(items, top) {
      const box = mk('div', top ? 'tkbar' : 'tkmenu');
      for (const it of items) {
        if (it.k === 'separator') { mk('div', 'tkmsep', box); continue; }
        const b = mk('div', top ? 'tkmtop' : 'tkmitem', box);
        mk('span', '', b).textContent = (it.k === 'check' || it.k === 'radio' ? (it.c ? '✓ ' : '   ') : '') + it.label;
        if (it.acc) mk('i', 'tkacc', b).textContent = it.acc;
        if (it.k === 'cascade') { b.classList.add('sub'); b.append(menuEl(it.items || [], false)); }
        else b.onclick = e => { e.stopPropagation(); send({ t: 'menu', m: it.id }); document.activeElement?.blur(); };
      }
      return box;
    }

    const KEYSYM = { Enter: 'Return', Backspace: 'BackSpace', ' ': 'space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', PageUp: 'Prior',
                     PageDown: 'Next', Shift: 'Shift_L', Control: 'Control_L', Alt: 'Alt_L', CapsLock: 'Caps_Lock', '.': 'period', ',': 'comma', '-': 'minus', '+': 'plus',
                     '=': 'equal', '/': 'slash', '*': 'asterisk', ';': 'semicolon', "'": 'apostrophe', '[': 'bracketleft', ']': 'bracketright', '\\': 'backslash',
                     '`': 'grave', '!': 'exclam', '@': 'at', '#': 'numbersign', $: 'dollar', '%': 'percent', '^': 'asciicircum', '&': 'ampersand', '(': 'parenleft',
                     ')': 'parenright', _: 'underscore', ':': 'colon', '"': 'quotedbl', '<': 'less', '>': 'greater', '?': 'question', '{': 'braceleft', '}': 'braceright',
                     '|': 'bar', '~': 'asciitilde' };
    const CHAR = { Enter: '\r', Tab: '\t', Backspace: '\b', Escape: '\x1b' };

    function wire(win) { // mouse + keyboard events for everything inside one window
      const nearest = t => (t && t.closest ? t.closest('[data-wid]') : null);
      const base = (ev, target) => { const r = target.getBoundingClientRect(); return { t: 'ev', id: +target.dataset.wid, x: ev.clientX - r.left, y: ev.clientY - r.top, rx: ev.screenX, ry: ev.screenY, ctrl: ev.ctrlKey, shift: ev.shiftKey, alt: ev.altKey,
        btn: (ev.buttons & 1 ? 1 : 0) | (ev.buttons & 4 ? 2 : 0) | (ev.buttons & 2 ? 4 : 0) }; };
      const mouse = (kind, ev, target = nearest(ev.target)) => { if (target && wants.has(kind)) send({ ...base(ev, target), k: kind, num: ev.button + 1 }); };
      win.addEventListener('mousedown', ev => { win.style.zIndex = ++z; mouse('press', ev); });
      win.addEventListener('mouseup', ev => mouse('release', ev));
      win.addEventListener('dblclick', ev => mouse('double', ev));
      let raf = 0;
      win.addEventListener('mousemove', ev => { if (raf || !wants.has('motion')) return; raf = requestAnimationFrame(() => { raf = 0; mouse('motion', ev); }); });
      win.addEventListener('mouseover', ev => { const a = nearest(ev.target); if (a && a !== nearest(ev.relatedTarget)) mouse('enter', ev, a); });
      win.addEventListener('mouseout', ev => { const a = nearest(ev.target); if (a && a !== nearest(ev.relatedTarget)) mouse('leave', ev, a); });
      win.addEventListener('wheel', ev => { if (wants.has('wheel')) mouse('wheel', ev); if (wants.has('wheel')) ev.preventDefault(); }, { passive: false });
      const key = (kind, ev) => {
        if (!wants.has(kind) || ev.key === 'Unidentified') return;
        const t = nearest(ev.target) || win, sym = KEYSYM[ev.key] ?? ev.key;
        send({ t: 'ev', k: kind, id: +t.dataset.wid, keysym: sym, char: ev.key.length === 1 ? ev.key : CHAR[ev.key] || '', code: ev.keyCode, ctrl: ev.ctrlKey, shift: ev.shiftKey, alt: ev.altKey, x: 0, y: 0 });
        if (!/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) && /^(Arrow|Page|Home|End| )/.test(ev.key)) ev.preventDefault();
      };
      win.addEventListener('keydown', ev => key('key', ev));
      win.addEventListener('keyup', ev => key('keyup', ev));
    }

    function drawWin(node, index) {
      let w = wins.get(node.id);
      if (!w) {
        const e = mk('div', 'tkwin', host());
        e.dataset.wid = node.id; e.tabIndex = 0;
        e.style.left = 130 + index * 30 + 'px'; e.style.top = 96 + index * 30 + 'px'; e.style.zIndex = ++z;
        const bar = mk('div', 'tktitle', e);
        const title = mk('span', '', bar), x = mk('b', 'tkx', bar);
        x.textContent = '✕'; x.title = 'Close';
        x.onclick = () => send({ t: 'close', id: node.id });
        const menubar = mk('div', 'tkmenubar', e), body = mk('div', 'tkbody', e);
        body._inner = body;
        bar.addEventListener('pointerdown', ev => { // drag by the title bar
          if (ev.target === x) return;
          const dx = ev.clientX - e.offsetLeft, dy = ev.clientY - e.offsetTop;
          bar.setPointerCapture(ev.pointerId);
          const mv = m => { e.style.left = Math.max(-200, m.clientX - dx) + 'px'; e.style.top = Math.max(0, m.clientY - dy) + 'px'; };
          const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); };
          bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
        });
        wire(e);
        w = { el: e, body, bar, title, menubar, els: new Map() };
        wins.set(node.id, w);
      }
      w.title.textContent = node.o.title ?? 'tk';
      w.el.style.display = node.o.withdrawn ? 'none' : '';
      w.body.style.backgroundColor = node.o.bg || '';
      const g = /^(\d+)x(\d+)(?:([+-]\d+)([+-]\d+))?/.exec(node.geom || '');
      if (g) {
        w.body.style.width = g[1] + 'px'; w.body.style.height = g[2] + 'px';
        if (g[3] && w.geomPos !== node.geom) { w.el.style.left = Math.max(0, +g[3]) + 'px'; w.el.style.top = Math.max(0, +g[4]) + 'px'; w.geomPos = node.geom; }
      } else { w.body.style.width = w.body.style.height = ''; }
      w.body.style.resize = node.o.resizable && node.o.resizable[0] === false ? 'none' : g ? 'both' : 'none';
      w.body.style.overflow = g && w.body.style.resize === 'both' ? 'auto' : 'hidden';
      w.menubar.replaceChildren();
      if (node.menu) w.menubar.append(menuEl(node.menu.items, true));
      w.menubar.style.display = node.menu ? '' : 'none';
      w.ctx = { els: w.els, live: [] };
      renderChildren(w.body, node, w.ctx);
      for (const id of [...w.els.keys()]) if (!w.ctx.live.includes(id)) { const el = w.els.get(id); el._dl?.remove(); w.els.delete(id); }
    }

    function dialog(d) {
      const ov = mk('div', 'tkdialog ' + d.k, host()), box = mk('div', 'tkdbox', ov);
      mk('div', 'tkdtitle', box).textContent = d.title || ({ info: 'Information', warning: 'Warning', error: 'Error', question: 'Question' }[d.k] || 'Message');
      const body = mk('div', 'tkdmsg', box);
      mk('span', 'tkdicon ' + d.k, body).textContent = { info: 'i', warning: '!', error: '✕', question: '?', ask: '?' }[d.k] || 'i';
      mk('span', '', body).textContent = d.msg;
      const ok = mk('button', 'tk tk-button', mk('div', 'tkdbtn', box));
      ok.textContent = 'OK'; ok.onclick = () => ov.remove();
      ok.focus();
    }

    function apply(tree) {
      if (!tree) return closeAll(); // null = the program ended or was replaced
      const active = document.activeElement, caret = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
      wants = new Set(tree.wants);
      const keep = new Set();
      tree.wins.forEach((n, i) => { keep.add(n.id); drawWin(n, i); });
      for (const [id, w] of wins) if (!keep.has(id)) { dispose(w); wins.delete(id); }
      (tree.dialogs || []).forEach(dialog);
      if (tree.focus && tree.focus[1] !== focusN) { // focus_set()
        focusN = tree.focus[1];
        for (const w of wins.values()) { const e = w.els.get(tree.focus[0]); if (e) (e._in || e).focus(); }
      } else if (active && active !== document.body && document.contains(active) && document.activeElement !== active) {
        active.focus(); // moving elements around (layout rebuilds) can drop focus
        if (caret) try { active.setSelectionRange(caret[0], caret[1]); } catch {}
      }
    }
    const dispose = w => { w.el.remove(); w.els.forEach(e => e._dl?.remove()); };
    function closeAll() {
      for (const w of wins.values()) dispose(w);
      wins.clear();
      host()?.replaceChildren();
      wants = new Set();
    }

    return { apply, closeAll, setSend: f => { send = f; }, open: () => wins.size > 0 };
  })();
  PyLibs.add({
    name: 'tkinter',
    python: 'libs/tkinter/lib.py',
    members: 'Tk Toplevel Frame LabelFrame Label Message Button Entry Text Checkbutton Radiobutton Scale Spinbox Listbox Canvas Scrollbar Menu OptionMenu StringVar IntVar DoubleVar BooleanVar mainloop messagebox simpledialog ttk font TclError Event '
      + 'END INSERT LEFT RIGHT TOP BOTTOM BOTH X Y N S E W NW NE SW SE NS EW NSEW CENTER NORMAL DISABLED ACTIVE READONLY HORIZONTAL VERTICAL RAISED SUNKEN FLAT GROOVE RIDGE SOLID WORD CHAR NONE YES NO ANCHOR ALL SINGLE BROWSE MULTIPLE EXTENDED',
    submodules: {
      messagebox: 'showinfo showwarning showerror askquestion askokcancel askyesno askyesnocancel askretrycancel',
      simpledialog: 'askstring askinteger askfloat',
      ttk: 'Button Label Entry Frame LabelFrame Checkbutton Radiobutton Scale Spinbox Combobox Progressbar Separator Style',
      font: 'Font families',
    },
    methods: 'pack grid place config configure bind bind_all after after_cancel destroy mainloop quit title geometry resizable protocol focus_set update update_idletasks winfo_width winfo_height columnconfigure rowconfigure pack_forget grid_forget '
      + 'create_line create_rectangle create_oval create_text create_polygon create_arc coords move itemconfig delete find_overlapping tag_bind add_command add_cascade add_separator invoke select deselect curselection selection_set',
    view: TkView, // draws the windows; see the "view" part of docs/ADDING_A_LIBRARY.md
  });
}
