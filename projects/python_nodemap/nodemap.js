/* Node map: lays the analysis out as one vertical stack (same order as the source lines) and draws it as SVG.
   Wires never cross a box: they leave the right edge, run down a gutter lane, cross the gap above the target
   and enter its left edge. The same SVG string is rasterised for the PNG export.

   Public API
     NodeMap.build(graph, trace, opts) -> { svg, w, h }    graph = analyze() output; trace = values/counts of this file, or undefined
                                                           before a run; opts = { fold, now, err, light } (see build)
     NodeMap.png(graph, trace, opts)   -> Promise<Blob>    the same picture as a PNG
     NodeMap.viewAt(timeline, n)       -> { file: trace }  the values and counts as they stood after n recorded steps
     NodeMap.nodeAt(graph, line)       -> the innermost node covering a 1-based source line
     NodeMap.foldKey(node)             -> the key used in opts.fold to collapse a container ('v:' + that key collapses the
                                                           node's value box instead)
   build() only returns a string. app.js puts it in #map and afterwards toggles CSS classes on it (hover, search, current step)
   without redrawing. */
const NodeMap = (() => {
  // Geometry in SVG pixels: HEAD = height of a box's header (kind label + code line), ROW = one line of the value box,
  // MINW = narrowest box, IND = indent of a nested box, SLOT = vertical room per incoming wire label above a box,
  // LANE = distance between parallel wires in the gutters.
  const HEAD = 36, ROW = 16, MINW = 320, IND = 16, SLOT = 18, LANE = 14; // SLOT = row per incoming wire label, LANE = gap between parallel wires
  const COLOR_DARK = { def: '#7aa2f7', class: '#bb9af7', for: '#ff9e64', while: '#ff9e64', if: '#e0af68', else: '#e0af68', with: '#e0af68',
                       try: '#f7768e', except: '#f7768e', return: '#9ece6a', import: '#73daca', assign: '#7dcfff', expr: '#c0caf5', other: '#7b86a8' };
  const COLOR_LIGHT = { def: '#2f5bd3', class: '#7b4fd1', for: '#d2610f', while: '#d2610f', if: '#a97800', else: '#a97800', with: '#a97800',
                        try: '#d1344f', except: '#d1344f', return: '#2f8a3a', import: '#13897a', assign: '#1b78b0', expr: '#56627a', other: '#6b7590' };
  // everything else that depends on the theme is a CSS variable on the <svg>, so the same markup works in both
  const VARS = {
    dark: '--bg:#10141b;--grid:#8b93a7;--gridop:.08;--card:#1a2130;--vbox:#0c1017;--vboxs:#263042;--code:#d5dbe8;--ln:#6b7690;--vn:#7dcfff;--eq:#9aa5c0;--vv:#e6c07b;--pill:#10141b;--port:#10141b;--fold:#8b93a7;--foldh:#fff;--now:#ffd866;--err:#f7768e;--hit:#fff',
    light: '--bg:#f4f6fa;--grid:#5b6579;--gridop:.13;--card:#ffffff;--vbox:#eef2f8;--vboxs:#d3dbe8;--code:#1f2733;--ln:#7a8497;--vn:#0b6fa3;--eq:#66708a;--vv:#9a5b00;--pill:#ffffff;--port:#f4f6fa;--fold:#6b7590;--foldh:#000;--now:#d99a00;--err:#d1344f;--hit:#111',
  };
  const LABEL = { def: 'FUNCTION', class: 'CLASS', for: 'LOOP', while: 'LOOP', if: 'IF', else: 'ELSE', try: 'TRY', except: 'CATCH',
                  return: 'RETURN', import: 'IMPORT', assign: 'SET', expr: 'RUN', with: 'WITH', other: 'STMT' };
  const CSS = `.nm text{font-family:Consolas,"Cascadia Mono","Courier New",monospace}
.k{font-size:9px;font-weight:700;letter-spacing:.08em}.code{font-size:11px;fill:var(--code)}.ln{font-size:9px;fill:var(--ln)}
.vn{fill:var(--vn)}.eq,.vv{fill:var(--eq)}.vv{fill:var(--vv)}.vt{font-size:10px}.pill{font-size:10px}
.bg{fill:var(--bg)}.leaf{fill:var(--card)}.vbox{fill:var(--vbox);stroke:var(--vboxs)}.pillbox{fill:var(--pill)}.port{fill:var(--port)}
.node{cursor:pointer}.node.dim{opacity:.4}.node:hover>.box{stroke-opacity:1}.node.act>.box{stroke-width:2.2;stroke-opacity:1}
.node.now,.node.err{opacity:1}.node.now>.box{stroke:var(--now);stroke-width:2.8;stroke-opacity:1}
.node.err>.box{stroke:var(--err);stroke-width:2.8;stroke-opacity:1;fill:var(--err);fill-opacity:.14}
.nm.q .node:not(.hit){opacity:.28}.node.hit>.box{stroke:var(--hit);stroke-width:2.2;stroke-opacity:1}
.fold{cursor:pointer}.fold path{fill:var(--fold)}.fold:hover path{fill:var(--foldh)}
.wire path{fill:none;stroke-width:1.6}.wire{opacity:.6}.wire.call path{stroke-dasharray:6 4}.wire.back path{stroke-dasharray:.1 5.5;stroke-linecap:round;stroke-width:2.6}.wire.back{opacity:.95}
.nm.f .wire{opacity:.22}.nm.f .wire.on{opacity:1}.wire.on path{stroke-width:2.4;stroke-dasharray:8 4;animation:flow .7s linear infinite}
@keyframes flow{to{stroke-dashoffset:-12}}`;

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
  // a stable colour per variable name, so the same variable has the same wire colour everywhere
  const hue = (s, light) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return light ? `hsl(${h},68%,38%)` : `hsl(${h},75%,66%)`; };
  // identifies a container in the set of collapsed ones; survives edits elsewhere in the file (it is the kind and first line)
  const foldKey = n => n.kind + ':' + n.line;
  // a little chevron triangle centred on (cx, cy): pointing down when open, right when collapsed
  const tri = (cx, cy, open) => (open ? `M${cx - 4},${cy - 2}L${cx + 4},${cy - 2}L${cx},${cy + 3}Z` : `M${cx - 3},${cy - 4}L${cx + 3},${cy}L${cx - 3},${cy + 4}Z`);

  function lanes(items) { // interval colouring: wires whose vertical spans don't overlap share a lane
    const ends = [];
    [...items].sort((a, b) => a.lo - b.lo).forEach(it => {
      let l = ends.findIndex(e => e < it.lo - 12);
      if (l < 0) l = ends.length;
      ends[l] = it.hi; it.lane = l;
    });
    return ends.length;
  }

  // a polyline [[x, y], ...] as an SVG path whose corners are rounded with radius r (never more than half a segment)
  function rounded(p, r = 7) {
    const q = [];
    for (const pt of p) if (!q.length || Math.hypot(pt[0] - q.at(-1)[0], pt[1] - q.at(-1)[1]) > .5) q.push(pt);
    let d = `M${q[0]}`;
    for (let i = 1; i < q.length - 1; i++) {
      const [a, b, c] = [q[i - 1], q[i], q[i + 1]];
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]), k = Math.min(r, l1 / 2, l2 / 2);
      d += `L${b[0] + (a[0] - b[0]) * k / l1},${b[1] + (a[1] - b[1]) * k / l1}Q${b} ${b[0] + (c[0] - b[0]) * k / l2},${b[1] + (c[1] - b[1]) * k / l2}`;
    }
    return d + `L${q.at(-1)}`;
  }

  /** graph = analyzer output, tr = trace for this file (or undefined before a run) -> {svg, w, h}
      o = { fold: Set of foldKey, now: source line being stepped to, err: source line of the error, light: use the light palette } */
  function build(g, tr, o = {}) {
    const COLOR = o.light ? COLOR_LIGHT : COLOR_DARK, CALL = o.light ? '#d97706' : '#ffb454', theme = VARS[o.light ? 'light' : 'dark'];
    const N = g.nodes.map(n => ({ ...n }));
    if (!N.length) return { svg: `<svg xmlns="http://www.w3.org/2000/svg" class="nm" width="300" height="60" style="${VARS[o.light ? 'light' : 'dark']}"><style>${CSS}</style><rect class="bg" width="300" height="60"/><text x="16" y="34" class="ln" style="font-size:12px">Nothing to map yet.</text></svg>`, w: 300, h: 60 };

    // folding: nodes inside a collapsed container are hidden; their wires re-attach to the container
    const folded = n => n.kids.length > 0 && o.fold?.has(foldKey(n));
    const rep = [];
    const mark = (n, under) => { rep[n.id] = under ?? n.id; n.kids.forEach(k => mark(N[k], under ?? (folded(n) ? n.id : null))); };
    const roots = N.filter(n => n.parent == null);
    roots.forEach(r => mark(r, null));
    N.forEach(n => { n.vis = folded(n) ? [] : n.kids; });
    const seen = new Set(), wl = [];
    g.wires.forEach(w => {
      const a = rep[w.from], b = rep[w.to], k = `${a}>${b}:${w.kind}:${w.label}`;
      if ((a === b && (w.from !== w.to || a !== w.from)) || seen.has(k)) return; // wires inside a folded container vanish; a box's own loop-back wire stays
      seen.add(k);
      wl.push({ ...w, from: a, to: b });
    });
    const shown = N.filter(n => rep[n.id] === n.id);

    // incoming wires per node; each gets a "slot", one row of label space in the gap above its target box
    const inc = N.map(() => []);
    wl.forEach(w => { w.slot = inc[w.to].length; inc[w.to].push(w); });
    const gap = n => (inc[n.id].length ? 25 + SLOT * (inc[n.id].length - 1) : 14); // room above a node for its incoming wire labels

    // the value box of a node: every [name, value] pair from the trace ('–' before the first run), however many there are
    const allRows = n => {
      const v = (n.kind === 'def' ? tr?.params : tr?.vals)?.[n.line] || {};
      let r = n.show.map(k => [k, v[k] ?? '–']);
      if (n.kind === 'def' && tr?.rets?.[n.line]) r.push(['return', tr.rets[n.line]]);
      if (n.kind === 'return') r = tr ? [['value', tr.rets?.[n.line] ?? '–']] : [];
      return r;
    };
    // A value box with CHEV or more rows has a chevron that collapses it to one line (just the names, and how many there are).
    // Its fold key is 'v:' + the node's foldKey, kept in the same set as the collapsed containers.
    const CHEV = 3, vkey = n => 'v:' + foldKey(n);
    // how often a node ran (for a function: how often it was called); null before any run. Never-run nodes are drawn dim.
    const count = n => (tr ? (n.kind === 'def' ? tr.calls?.[n.line] : tr.hits?.[n.line]) || 0 : null);

    // width a node needs: nested boxes are inset on both sides, so a container is wider than its widest child
    const need = n => (n.minw = Math.max(MINW, ...n.vis.map(k => need(N[k]) + 2 * IND)));
    const W0 = Math.max(...roots.map(need));
    // layout, top-down: sets x, y, w, h on every visible node and returns the y just below it and its children
    const place = (n, x, w, y) => {
      const all = allRows(n), vfold = all.length >= CHEV && !!o.fold?.has(vkey(n));
      Object.assign(n, { x, y, w, vcount: all.length, vfold, rows: vfold ? [[all.map(r => r[0]).join(', '), null]] : all });
      let b = y + HEAD + (n.rows.length ? n.rows.length * ROW + 16 : 0);
      n.vis.forEach(k => { b = place(N[k], x + IND, w - 2 * IND, b + gap(N[k])); });
      if (n.vis.length) b += 12;
      n.h = b - y;
      return b;
    };
    let y = 16;
    roots.forEach(r => { y = place(r, 0, W0, y + gap(r)); });
    const H = y + 28;

    // route each wire: out of the source's right edge (yo), down a right-hand lane, across the gap above the target (yg, where the
    // label pill sits), down a left-hand lane and into the target's left edge (yi). Lanes are shared by wires that don't overlap.
    // A wire from a box back to itself (a loop-carried value: `total = add(total, i)`) is just a short loop round that box, so it
    // takes no lane.
    const ws = wl.map(w => {
      const a = N[w.from], b = N[w.to], self = w.from === w.to;
      const yo = a.y + HEAD / 2, yi = b.y + HEAD / 2, yg = b.y - 12 - SLOT * w.slot;
      return { w, a, b, self, yo, yi, yg, R: { lo: Math.min(yo, yg), hi: Math.max(yo, yg) }, L: { lo: Math.min(yg, yi), hi: Math.max(yg, yi) } };
    });
    const gl = 24 + lanes(ws.filter(o => !o.self).map(o => o.L)) * LANE, gr = 24 + lanes(ws.filter(o => !o.self).map(o => o.R)) * LANE;
    const WID = gl + W0 + gr;

    // the innermost visible box around a source line: where the "now" (stepping) and error highlights go
    const inner = line => shown.filter(n => n.line <= line && line <= n.end).sort((a, b) => (a.end - a.line) - (b.end - b.line))[0]?.id;
    const nowId = o.now ? inner(o.now) : null, errId = o.err ? inner(o.err) : null;

    // drawing: the boxes first, then the wires on top, then the little connection ports on each box's edges
    const nodes = shown.map(n => {
      const x = gl + n.x, c = COLOR[n.kind] || COLOR.other, cnt = count(n), box = n.kids.length > 0;
      const dim = tr && cnt === 0 && n.kind !== 'else' && n.kind !== 'try';
      const lab = (n.kind === 'if' && n.text.startsWith('elif') ? 'ELIF' : LABEL[n.kind]) + (folded(n) ? `  ·  ${n.kids.length} inside` : '');
      const sh = n.kind === 'for' || n.kind === 'while' ? cnt - 1 : n.kind === 'class' ? 0 : cnt; // loop header runs once more than the body
      const right = (sh > 1 ? `×${sh}  ` : '') + 'L' + n.line;
      const chevV = n.vcount >= CHEV, room = Math.floor((n.w - 40 - (chevV ? 16 : 0)) / 6.2); // characters that fit in a value row (the chevron takes some)
      const vals = n.rows.map(([k, v], i) => {
        const at = `<text class="vt" x="${x + 16}" y="${n.y + HEAD + ROW * (i + 1)}">`;
        return v === null // collapsed: one line with the names and the count
          ? `${at}<tspan class="vn">${esc(clip(k, room - 6))}</tspan><tspan class="eq"> (${n.vcount})</tspan></text>`
          : `${at}<tspan class="vn">${esc(k)}</tspan><tspan class="eq"> = </tspan><tspan class="vv">${esc(clip(v, room - k.length - 3))}</tspan></text>`;
      }).join('');
      const vcx = x + n.w - 22, vcy = n.y + HEAD + 10;
      const vchev = chevV ? `<g class="fold" data-fold="${vkey(n)}"><title>${n.vfold ? `Show all ${n.vcount} values` : 'Collapse these values'}</title><rect x="${vcx - 9}" y="${vcy - 9}" width="18" height="18" fill="transparent"/><path d="${tri(vcx, vcy, !n.vfold)}"/></g>` : '';
      const cx = x + n.w - 18, cy = n.y + 11;
      const chev = box ? `<g class="fold" data-fold="${foldKey(n)}"><rect x="${cx - 9}" y="${cy - 9}" width="18" height="18" fill="transparent"/><path d="${tri(cx, cy, !folded(n))}"/></g>` : '';
      return `<g class="node${dim ? ' dim' : ''}${n.id === nowId ? ' now' : ''}${n.id === errId ? ' err' : ''}" data-id="${n.id}" data-line="${n.line}"><title>line ${n.line}</title>
<rect class="box${box ? '' : ' leaf'}" x="${x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="7"${box ? ` fill="${c}" fill-opacity=".07"` : ''} stroke="${c}" stroke-opacity=".7"/>
<text class="k" x="${x + 14}" y="${n.y + 15}" fill="${c}">${lab}</text><text class="ln" x="${x + n.w - (box ? 32 : 14)}" y="${n.y + 15}" text-anchor="end">${right}</text>${chev}
<text class="code" x="${x + 14}" y="${n.y + 31}">${esc(clip(n.text, Math.floor((n.w - 28) / 6.6)))}</text>
${n.rows.length ? `<rect x="${x + 10}" y="${n.y + HEAD}" width="${n.w - 20}" height="${n.rows.length * ROW + 8}" rx="4" class="vbox"/>${vals}${vchev}` : ''}</g>`;
    }).join('');

    const wires = ws.map(({ w, a, b, self, yo, yi, yg, R, L }) => {
      const xo = gl + a.x + a.w, xi = gl + b.x, xr = self ? xo + 12 : gl + W0 + 18 + R.lane * LANE, xl = self ? xi - 12 : gl - 18 - L.lane * LANE;
      const col = w.kind === 'call' ? CALL : hue(w.label, o.light), mid = gl + W0 / 2;
      const text = w.kind === 'call' ? w.label + (w.two ? ' ↔' : '') : (w.back ? '↻ ' : '') + w.label, pw = text.length * 5.9 + 12;
      return `<g class="wire ${w.kind}${w.back ? ' back' : ''}" data-a="${w.from}" data-b="${w.to}" data-l="${esc(w.label)}"><title>${esc(w.label)} (line ${a.line} → line ${b.line})</title>
<path d="${rounded([[xo, yo], [xr, yo], [xr, yg], [xl, yg], [xl, yi], [xi, yi]])}" stroke="${col}"/>
<polygon points="${xi - 8},${yi - 4} ${xi},${yi} ${xi - 8},${yi + 4}" fill="${col}"/>${w.two ? `<polygon points="${xo + 8},${yo - 4} ${xo},${yo} ${xo + 8},${yo + 4}" fill="${col}"/>` : ''}
<rect class="pillbox" x="${mid - pw / 2}" y="${yg - 7}" width="${pw}" height="14" rx="7" stroke="${col}"/><text class="pill" x="${mid}" y="${yg + 3.5}" text-anchor="middle" fill="${col}">${esc(text)}</text></g>`;
    }).join('');

    const ports = shown.filter(n => n.kind !== 'else' && n.kind !== 'try').map(n => {
      const c = COLOR[n.kind] || COLOR.other, cy = n.y + HEAD / 2;
      return `<circle class="port" cx="${gl + n.x}" cy="${cy}" r="4.5" stroke="${c}" stroke-width="1.5"/><circle class="port" cx="${gl + n.x + n.w}" cy="${cy}" r="4.5" stroke="${c}" stroke-width="1.5"/>`;
    }).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="nm" width="${WID}" height="${H}" viewBox="0 0 ${WID} ${H}" style="${theme}"><style>${CSS}</style>
<defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" style="stroke:var(--grid);stroke-opacity:var(--gridop)"/></pattern></defs>
<rect class="bg" width="100%" height="100%"/><rect width="100%" height="100%" fill="url(#grid)"/>${nodes}${wires}${ports}</svg>`;
    return { svg, w: WID, h: H };
  }

  /** innermost node covering a 1-based source line */
  const nodeAt = (g, line) => g.nodes.filter(n => n.line <= line && line <= n.end).sort((a, b) => (a.end - a.line) - (b.end - b.line))[0];

  /** the map as a PNG Blob: the same SVG rasterised through a canvas, up to 2x, never more than 8000 px on a side */
  async function png(g, tr, o = {}) {
    const { svg, w, h } = build(g, tr, o);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(2, 8000 / Math.max(w, h)), c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const ctx = c.getContext('2d');
    ctx.scale(k, k);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    return new Promise(r => c.toBlob(r, 'image/png'));
  }

  /** Counts, values and returns as they stood after `s` steps of the recorded timeline -> { file: trace } */
  function viewAt(tl, s) {
    const V = tl.files.map(() => ({ vals: {}, params: {}, rets: {}, hits: {}, calls: {} }));
    for (let i = 0; i < s; i++) { const h = V[tl.steps[2 * i]].hits, l = tl.steps[2 * i + 1]; h[l] = (h[l] || 0) + 1; }
    for (const [idx, f, kind, line, data] of tl.facts) {
      if (idx > s) break;
      const v = V[f];
      if (kind === 'v') Object.assign(v.vals[line] ||= {}, data);
      else if (kind === 'p') { Object.assign(v.params[line] ||= {}, data); v.calls[line] = (v.calls[line] || 0) + 1; }
      else v.rets[line] = data;
    }
    return Object.fromEntries(tl.files.map((n, i) => [n, V[i]]));
  }

  return { build, nodeAt, png, viewAt, foldKey };
})();
