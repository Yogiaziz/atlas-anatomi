/* ============================================================
   viewer.js — Penampil gambar: zoom (gulir/cubit/tombol), geser,
   dan KANVAS CORETAN untuk menunjuk letak sakit (tidak disimpan).
   Koordinat coretan dinormalisasi (0..1) sehingga ikut zoom & resize.
   ============================================================ */
(function () {
  var TOOLS = [['move', 'Geser & zoom', 'move'], ['pen', 'Pena bebas', 'pen'], ['arrow', 'Panah', 'arrowUR'], ['oval', 'Lingkaran', 'circle'], ['pin', 'Penanda titik sakit', 'pin']];
  var COLORS = ['#DC2626', '#14B8A6', '#F59E0B', '#0F6CBD'];
  var HINT = {
    move: 'Gulir atau cubit untuk memperbesar, seret untuk menggeser. Ketuk dua kali untuk zoom cepat.',
    pen: 'Seret di atas gambar untuk menggambar. Cubit dengan dua jari untuk zoom.',
    arrow: 'Seret untuk membuat panah ke bagian yang sakit.',
    oval: 'Seret untuk melingkari area yang sakit.',
    pin: 'Ketuk pada gambar untuk menaruh penanda titik sakit.'
  };
  var PIN_PATH = 'M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z';

  window.createViewer = function (host, o) {
    o = o || {};
    var st = { s: 1, tx: 0, ty: 0, tool: 'move', color: COLORS[0], shapes: [], redo: [], cur: null, sw: 0, sh: 0, nat: { w: 4, h: 3 }, tried: false, src: '', alt: '' };

    host.innerHTML =
      '<div class="vw" data-tool="move">' +
        '<div class="vw-bar" role="toolbar" aria-label="Alat penampil">' +
          '<div class="vw-grp">' + TOOLS.map(function (t, i) { return '<button type="button" class="vw-btn' + (i === 0 ? ' on' : '') + '" data-tool="' + t[0] + '" title="' + t[1] + '" aria-label="' + t[1] + '">' + ic(t[2]) + '</button>'; }).join('') + '</div>' +
          '<div class="vw-grp vw-colors">' + COLORS.map(function (c, i) { return '<button type="button" class="vw-sw' + (i === 0 ? ' on' : '') + '" data-color="' + c + '" style="--c:' + c + '" aria-label="Warna ' + (i + 1) + '"></button>'; }).join('') + '</div>' +
          '<div class="vw-grp"><button type="button" class="vw-btn" data-act="undo" title="Urungkan" aria-label="Urungkan">' + ic('undo') + '</button><button type="button" class="vw-btn" data-act="redo" title="Ulangi" aria-label="Ulangi">' + ic('redo') + '</button><button type="button" class="vw-btn" data-act="clear" title="Hapus semua coretan" aria-label="Hapus semua coretan">' + ic('trash') + '</button></div>' +
          '<div class="vw-grp vw-zoom"><button type="button" class="vw-btn" data-act="zout" title="Perkecil" aria-label="Perkecil">' + ic('zoomOut') + '</button><span class="vw-pct" aria-live="polite">100%</span><button type="button" class="vw-btn" data-act="zin" title="Perbesar" aria-label="Perbesar">' + ic('zoomIn') + '</button><button type="button" class="vw-btn" data-act="reset" title="Atur ulang" aria-label="Atur ulang">' + ic('reset') + '</button></div>' +
          '<div class="vw-grp vw-end"><button type="button" class="vw-btn" data-act="save" title="Simpan sebagai PNG" aria-label="Simpan sebagai PNG">' + ic('download') + '</button><button type="button" class="vw-btn vw-fullbtn" data-act="full" title="Mode layar penuh" aria-label="Mode layar penuh">' + ic('max') + '</button></div>' +
        '</div>' +
        '<div class="vw-view">' +
          '<div class="vw-stage"><img class="vw-img" alt="" draggable="false" decoding="async"><canvas class="vw-draw"></canvas></div>' +
          '<div class="vw-load"><span class="spin"></span></div>' +
          '<div class="vw-err" hidden>' + ic('image') + '<p>Gambar tidak dapat dimuat.</p></div>' +
          (o.onPrev ? '<button type="button" class="vw-nav prev" aria-label="Gambar sebelumnya">' + ic('chevL') + '</button>' : '') +
          (o.onNext ? '<button type="button" class="vw-nav next" aria-label="Gambar berikutnya">' + ic('chevR') + '</button>' : '') +
          '<button type="button" class="vw-close" data-act="full" aria-label="Keluar layar penuh">' + ic('x') + '</button>' +
          '<div class="vw-name"></div>' +
        '</div>' +
        '<div class="vw-hint"><span class="vw-hint-t"></span><span class="vw-count"></span></div>' +
      '</div>';

    var root = host.firstChild, view = root.querySelector('.vw-view'), stage = root.querySelector('.vw-stage'),
        img = root.querySelector('.vw-img'), cv = root.querySelector('.vw-draw'), ctx = cv.getContext('2d'),
        pct = root.querySelector('.vw-pct'), load = root.querySelector('.vw-load'), err = root.querySelector('.vw-err'),
        hint = root.querySelector('.vw-hint-t'), cnt = root.querySelector('.vw-count'), nameEl = root.querySelector('.vw-name');

    function apply() {
      stage.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.s + ')';
      pct.textContent = Math.round(st.s * 100) + '%';
    }
    function clamp() {
      if (st.s <= 1.001) { st.s = 1; st.tx = 0; st.ty = 0; return; }
      var W = view.clientWidth, H = view.clientHeight;
      var lx = Math.max(0, (st.sw * st.s - W) / 2) + W * 0.25, ly = Math.max(0, (st.sh * st.s - H) / 2) + H * 0.25;
      st.tx = Math.max(-lx, Math.min(lx, st.tx)); st.ty = Math.max(-ly, Math.min(ly, st.ty));
    }
    function fit() {
      var W = view.clientWidth, H = view.clientHeight;
      if (!W || !H) return;
      var a = st.nat.w / st.nat.h, sw = Math.min(W, H * a), sh = sw / a;
      st.sw = sw; st.sh = sh;
      stage.style.width = sw + 'px'; stage.style.height = sh + 'px';
      stage.style.marginLeft = (-sw / 2) + 'px'; stage.style.marginTop = (-sh / 2) + 'px';
      var d = Math.min(3, (window.devicePixelRatio || 1) * 1.5);
      cv.width = Math.round(sw * d); cv.height = Math.round(sh * d);
      cv.style.width = sw + 'px'; cv.style.height = sh + 'px';
      clamp(); apply(); draw();
    }
    function zoomAt(ns, cx, cy) {
      ns = Math.max(1, Math.min(8, ns));
      var r = view.getBoundingClientRect(), px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2), k = ns / st.s;
      st.tx = px - (px - st.tx) * k; st.ty = py - (py - st.ty) * k; st.s = ns; clamp(); apply();
    }
    function zoomCenter(f) { var r = view.getBoundingClientRect(); zoomAt(st.s * f, r.left + r.width / 2, r.top + r.height / 2); }
    function resetView() { st.s = 1; st.tx = 0; st.ty = 0; apply(); }

    /* ---------- menggambar ---------- */
    function paint(c, W, H) {
      var lw = Math.max(3, W * 0.0062);
      c.lineCap = 'round'; c.lineJoin = 'round';
      var all = st.cur ? st.shapes.concat([st.cur]) : st.shapes;
      all.forEach(function (s) {
        c.strokeStyle = s.c; c.fillStyle = s.c; c.lineWidth = lw;
        if (s.t === 'pen') {
          c.beginPath(); s.pts.forEach(function (p, i) { i ? c.lineTo(p[0] * W, p[1] * H) : c.moveTo(p[0] * W, p[1] * H); });
          if (s.pts.length === 1) c.lineTo(s.pts[0][0] * W + 0.1, s.pts[0][1] * H); c.stroke();
        } else if (s.t === 'arrow') {
          var x1 = s.a[0] * W, y1 = s.a[1] * H, x2 = s.b[0] * W, y2 = s.b[1] * H, ang = Math.atan2(y2 - y1, x2 - x1), hd = lw * 6;
          c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
          c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - hd * Math.cos(ang - 0.45), y2 - hd * Math.sin(ang - 0.45)); c.lineTo(x2 - hd * Math.cos(ang + 0.45), y2 - hd * Math.sin(ang + 0.45)); c.closePath(); c.fill();
        } else if (s.t === 'oval') {
          var cx = (s.a[0] + s.b[0]) / 2 * W, cy = (s.a[1] + s.b[1]) / 2 * H, rx = Math.abs(s.b[0] - s.a[0]) / 2 * W, ry = Math.abs(s.b[1] - s.a[1]) / 2 * H;
          c.beginPath(); c.ellipse(cx, cy, Math.max(2, rx), Math.max(2, ry), 0, 0, Math.PI * 2); c.stroke();
        } else if (s.t === 'pin') {
          var k = W * 0.0034;
          c.save(); c.translate(s.p[0] * W - 12 * k, s.p[1] * H - 21 * k); c.scale(k, k);
          var p2 = new Path2D(PIN_PATH); c.lineWidth = 1.8; c.strokeStyle = '#fff'; c.fill(p2); c.stroke(p2);
          c.beginPath(); c.arc(12, 10, 3, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill(); c.restore();
        }
      });
    }
    function draw() { ctx.clearRect(0, 0, cv.width, cv.height); paint(ctx, cv.width, cv.height); syncBtns(); }
    function syncBtns() {
      root.querySelector('[data-act=undo]').disabled = !st.shapes.length;
      root.querySelector('[data-act=redo]').disabled = !st.redo.length;
      root.querySelector('[data-act=clear]').disabled = !st.shapes.length;
    }
    function norm(e) {
      var r = cv.getBoundingClientRect();
      return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
    }

    /* ---------- pointer: geser / gambar / cubit ---------- */
    var pts = new Map(), pan = null, lastD = 0, lastC = null;
    function two() { var a = Array.from(pts.values()); return { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; }
    view.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.vw-nav,.vw-close,.vw-name')) return;
      try { view.setPointerCapture(e.pointerId); } catch (x) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { st.cur = null; pan = null; var t = two(); lastD = t.d; lastC = { x: t.x, y: t.y }; draw(); }
      else if (pts.size === 1) {
        if (st.tool === 'move') { pan = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty }; view.classList.add('grab'); }
        else {
          var p = norm(e);
          if (st.tool === 'pin') { st.shapes.push({ t: 'pin', c: st.color, p: p }); st.redo = []; draw(); }
          else if (st.tool === 'pen') st.cur = { t: 'pen', c: st.color, pts: [p] };
          else st.cur = { t: st.tool, c: st.color, a: p, b: p };
        }
      }
    });
    view.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        var t = two();
        if (lastD) { zoomAt(st.s * (t.d / lastD), t.x, t.y); st.tx += t.x - lastC.x; st.ty += t.y - lastC.y; clamp(); apply(); }
        lastD = t.d; lastC = { x: t.x, y: t.y };
      } else if (pan) {
        st.tx = pan.tx + (e.clientX - pan.x); st.ty = pan.ty + (e.clientY - pan.y); clamp(); apply();
      } else if (st.cur) {
        var p = norm(e);
        if (st.cur.t === 'pen') { var l = st.cur.pts[st.cur.pts.length - 1]; if (Math.abs(p[0] - l[0]) + Math.abs(p[1] - l[1]) > 0.002) st.cur.pts.push(p); }
        else st.cur.b = p;
        draw();
      }
    });
    function up(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) { lastD = 0; lastC = null; }
      if (!pts.size) {
        if (st.cur) {
          var s = st.cur, tiny = s.t !== 'pen' && Math.abs(s.a[0] - s.b[0]) + Math.abs(s.a[1] - s.b[1]) < 0.01;
          st.cur = null;
          if (!tiny) { st.shapes.push(s); st.redo = []; }
          draw();
        }
        pan = null; view.classList.remove('grab');
      }
    }
    view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
    view.addEventListener('wheel', function (e) { e.preventDefault(); var f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)); zoomAt(st.s * f, e.clientX, e.clientY); }, { passive: false });
    view.addEventListener('dblclick', function (e) { if (st.tool !== 'move' || e.target.closest('.vw-nav,.vw-close')) return; if (st.s > 1.05) { resetView(); } else zoomAt(2.5, e.clientX, e.clientY); });

    /* ---------- toolbar ---------- */
    function setTool(t) {
      st.tool = t; root.dataset.tool = t; st.cur = null;
      root.querySelectorAll('[data-tool].vw-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === t); });
      hint.textContent = HINT[t];
    }
    function exportPng() {
      var im = new Image(); im.crossOrigin = 'anonymous';
      function compose(base) {
        var k = Math.min(1, 2000 / Math.max(st.nat.w, st.nat.h)), W = Math.round(st.nat.w * k), H = Math.round(st.nat.h * k);
        var c = document.createElement('canvas'); c.width = W; c.height = H;
        var x = c.getContext('2d');
        if (base) { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(base, 0, 0, W, H); }
        paint(x, W, H);
        try {
          c.toBlob(function (b) {
            if (!b) { if (o.onToast) o.onToast('Gagal membuat berkas PNG.', 'error'); return; }
            var a = document.createElement('a'); a.href = URL.createObjectURL(b);
            a.download = 'atlas-' + (st.alt || 'anatomi').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.png';
            document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
          }, 'image/png');
        } catch (e) {
          if (base) { compose(null); if (o.onToast) o.onToast('Gambar dasar tidak dapat diekspor; hanya coretan yang disimpan.', 'warning'); }
        }
      }
      im.onload = function () { compose(im); }; im.onerror = function () { compose(null); if (o.onToast) o.onToast('Gambar dasar tidak dapat diekspor; hanya coretan yang disimpan.', 'warning'); };
      im.src = img.currentSrc || img.src;
    }
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !root.contains(b)) return;
      if (b.dataset.tool) return setTool(b.dataset.tool);
      if (b.dataset.color) { st.color = b.dataset.color; root.querySelectorAll('.vw-sw').forEach(function (x) { x.classList.toggle('on', x === b); }); return; }
      if (b.classList.contains('prev')) return o.onPrev && o.onPrev();
      if (b.classList.contains('next')) return o.onNext && o.onNext();
      var a = b.dataset.act;
      if (a === 'undo' && st.shapes.length) { st.redo.push(st.shapes.pop()); draw(); }
      else if (a === 'redo' && st.redo.length) { st.shapes.push(st.redo.pop()); draw(); }
      else if (a === 'clear') { st.shapes = []; st.redo = []; draw(); }
      else if (a === 'zin') zoomCenter(1.4);
      else if (a === 'zout') zoomCenter(1 / 1.4);
      else if (a === 'reset') resetView();
      else if (a === 'save') exportPng();
      else if (a === 'full') o.onFull && o.onFull();
    });

    /* ---------- gambar & ukuran ---------- */
    img.addEventListener('load', function () {
      st.nat = { w: img.naturalWidth || 4, h: img.naturalHeight || 3 }; load.hidden = true; err.hidden = true; stage.style.visibility = 'visible'; fit();
    });
    img.addEventListener('error', function () {
      if (!st.tried && st.fb) { st.tried = true; img.src = st.fb; return; }
      load.hidden = true; err.hidden = false; stage.style.visibility = 'hidden';
    });
    var ro = window.ResizeObserver ? new ResizeObserver(function () { fit(); }) : null;
    if (ro) ro.observe(view); else window.addEventListener('resize', fit);

    function onKey(e) {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
      if (e.key === '+' || e.key === '=') zoomCenter(1.4);
      else if (e.key === '-') zoomCenter(1 / 1.4);
      else if (e.key === '0') resetView();
      else if (e.key === 'ArrowLeft' && o.onPrev) o.onPrev();
      else if (e.key === 'ArrowRight' && o.onNext) o.onNext();
    }
    document.addEventListener('keydown', onKey);

    setTool('move'); syncBtns();

    return {
      setSrc: function (src, opt) {
        opt = opt || {};
        st.shapes = []; st.redo = []; st.cur = null; st.tried = false; st.fb = opt.fallback || ''; st.alt = opt.alt || ''; st.src = src;
        resetView(); load.hidden = false; err.hidden = true; img.alt = opt.alt || '';
        nameEl.textContent = opt.alt || ''; cnt.textContent = opt.counter || '';
        draw();
        if (opt.thumb && opt.thumb !== src) {              // thumbnail tampil instan, gambar penuh menyusul
          img.src = opt.thumb;
          var pre = new Image();
          pre.onload = function () { if (st.src === src) { st.tried = false; img.src = src; } };
          pre.onerror = function () { if (st.src === src && st.fb) { st.tried = true; img.src = st.fb; } };
          pre.src = src;
        } else img.src = src;
      },
      setFull: function (on) { root.classList.toggle('is-full', !!on); var b = root.querySelector('.vw-fullbtn'); b.innerHTML = ic(on ? 'min' : 'max'); b.title = on ? 'Keluar layar penuh' : 'Mode layar penuh'; setTimeout(fit, 30); },
      setCounter: function (t) { cnt.textContent = t || ''; },
      refit: fit,
      destroy: function () { document.removeEventListener('keydown', onKey); if (ro) ro.disconnect(); else window.removeEventListener('resize', fit); host.innerHTML = ''; }
    };
  };
})();
