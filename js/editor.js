/* ─── Site Editor ──────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Auth ────────────────────────────────────────────────────────────── */
  const HASHED = 'f4d8d581c6c8bd1188783decf76a6293c8f4430dc7268622b14ac7d51d0c6432';

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const authGate   = document.getElementById('auth-gate');
  const editorShell = document.getElementById('editor-shell');
  const gatePass   = document.getElementById('gate-pass');
  const gateBtn    = document.getElementById('gate-btn');
  const gateErr    = document.getElementById('gate-err');

  function unlock() {
    authGate.style.display = 'none';
    editorShell.style.display = 'flex';
    initEditor();
  }

  // Already authenticated from main site?
  const expiry = localStorage.getItem('ap_auth');
  if (expiry && Date.now() < Number(expiry)) { unlock(); }

  gateBtn.addEventListener('click', async () => {
    const hash = await sha256(gatePass.value);
    if (hash === HASHED) {
      localStorage.setItem('ap_auth', Date.now() + 86400000);
      gateErr.style.display = 'none';
      unlock();
    } else {
      gateErr.style.display = 'block';
      gatePass.value = '';
      gatePass.focus();
    }
  });
  gatePass.addEventListener('keydown', e => { if (e.key === 'Enter') gateBtn.click(); });

  /* ── Pages ───────────────────────────────────────────────────────────── */
  const PAGES = [
    { label: 'Home',            src: 'index.html'          },
    { label: 'About',           src: 'about.html'          },
    { label: 'Hero',            src: 'hero.html'           },
    { label: 'Console',         src: 'console.html'        },
    { label: 'Feed',            src: 'feed.html'           },
    { label: 'Growth',          src: 'growth.html'         },
    { label: 'Offers',          src: 'offers.html'         },
    { label: 'Decorators',      src: 'decorators.html'     },
    { label: 'Mobile Projects', src: 'mobile-projects.html'},
    { label: 'Playground',      src: 'playground.html'     },
  ];

  /* ── State ───────────────────────────────────────────────────────────── */
  let iframe, iDoc, iWin;
  let selected   = null;   // currently selected element in iframe
  let hovered    = null;
  let changeMap  = {};      // { pageIndex: { xpath: { prop: val } } }
  let currentPage = 0;
  let originalHTML = {};   // { pageIndex: originalHTMLstring }

  /* ── Init ────────────────────────────────────────────────────────────── */
  function initEditor() {
    iframe = document.getElementById('preview');

    buildTabs();
    buildDeviceBtns();
    loadPage(0);

    document.getElementById('btn-export').addEventListener('click', exportPage);
    document.getElementById('btn-reset').addEventListener('click', resetPage);
    document.getElementById('panel-close').addEventListener('click', deselect);
  }

  /* ── Tabs ────────────────────────────────────────────────────────────── */
  function buildTabs() {
    const container = document.getElementById('page-tabs');
    PAGES.forEach((p, i) => {
      const tab = document.createElement('button');
      tab.className = 'page-tab' + (i === 0 ? ' active' : '');
      tab.textContent = p.label;
      tab.addEventListener('click', () => loadPage(i));
      container.appendChild(tab);
    });
  }

  function setActiveTab(i) {
    document.querySelectorAll('.page-tab').forEach((t, idx) => {
      t.classList.toggle('active', idx === i);
    });
  }

  /* ── Device buttons ──────────────────────────────────────────────────── */
  function buildDeviceBtns() {
    document.querySelectorAll('.dev-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.dev-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const w = btn.dataset.w;
        iframe.style.width = w;
        document.getElementById('preview-wrap').style.alignItems =
          w === '100%' ? 'flex-start' : 'flex-start';
      });
    });
  }

  /* ── Load page ───────────────────────────────────────────────────────── */
  function loadPage(idx) {
    currentPage = idx;
    setActiveTab(idx);
    deselect();

    iframe.src = PAGES[idx].src;
    iframe.onload = () => {
      iDoc = iframe.contentDocument || iframe.contentWindow.document;
      iWin = iframe.contentWindow;

      // Suppress auth.js redirects inside the iframe
      iWin.location.replace = () => {};

      // Store original HTML once
      if (!originalHTML[idx]) {
        originalHTML[idx] = iDoc.documentElement.outerHTML;
      }

      // Re-apply any saved changes for this page
      reapplyChanges(idx);

      injectInteraction();
    };
  }

  /* ── Inject hover/click into iframe ─────────────────────────────────── */
  function injectInteraction() {
    // Inject editor styles into iframe
    if (!iDoc.getElementById('__editor-styles')) {
      const style = iDoc.createElement('style');
      style.id = '__editor-styles';
      style.textContent = `
        .editor-hover    { outline: 2px dashed rgba(123,97,255,.5) !important; outline-offset: 2px !important; cursor:pointer !important; }
        .editor-selected { outline: 2px solid #7b61ff !important; outline-offset: 2px !important; }
      `;
      iDoc.head.appendChild(style);
    }

    iDoc.body.addEventListener('mouseover', onHover, true);
    iDoc.body.addEventListener('mouseout',  onHoverOut, true);
    iDoc.body.addEventListener('click',     onSelect, true);
  }

  /* ── Hover ───────────────────────────────────────────────────────────── */
  const SKIP = new Set(['HTML','BODY','HEAD','SCRIPT','STYLE','LINK','META']);

  function onHover(e) {
    const el = e.target;
    if (SKIP.has(el.tagName) || el === selected) return;
    if (hovered && hovered !== selected) hovered.classList.remove('editor-hover');
    hovered = el;
    el.classList.add('editor-hover');
  }

  function onHoverOut(e) {
    const el = e.target;
    if (el !== selected) el.classList.remove('editor-hover');
  }

  /* ── Select ──────────────────────────────────────────────────────────── */
  function onSelect(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    if (SKIP.has(el.tagName)) return;

    if (selected) {
      selected.classList.remove('editor-selected');
      selected.classList.remove('editor-hover');
    }
    selected = el;
    el.classList.add('editor-selected');
    el.classList.remove('editor-hover');
    populateSidebar(el);
  }

  function deselect() {
    if (selected) {
      selected.classList.remove('editor-selected');
      selected = null;
    }
    document.getElementById('sidebar-placeholder').style.display = '';
    document.getElementById('sidebar-panel').style.display = 'none';
  }

  /* ── Sidebar ─────────────────────────────────────────────────────────── */
  function populateSidebar(el) {
    document.getElementById('sidebar-placeholder').style.display = 'none';
    document.getElementById('sidebar-panel').style.display = '';

    const cs = iWin.getComputedStyle(el);

    // Tag label
    const classes = Array.from(el.classList)
      .filter(c => !c.startsWith('editor-'))
      .slice(0, 3).join('.');
    document.getElementById('panel-tag').textContent =
      el.tagName.toLowerCase() + (classes ? '.' + classes : '');

    // ── Text ──
    const hasText = el.childElementCount === 0 || el.childNodes.length > 0;
    document.getElementById('sec-text').style.display = hasText ? '' : 'none';
    const txtArea = document.getElementById('ctrl-text');
    txtArea.value = el.innerText || '';
    txtArea.oninput = () => {
      el.innerText = txtArea.value;
      recordChange(el, 'innerText', txtArea.value);
    };

    // ── Font size ──
    bind('ctrl-fontsize', parseInt(cs.fontSize), val => {
      applyStyle(el, 'fontSize', val + 'px');
    });

    // ── Font weight ──
    const weightEl = document.getElementById('ctrl-fontweight');
    weightEl.value = cs.fontWeight || '';
    weightEl.onchange = () => applyStyle(el, 'fontWeight', weightEl.value);

    // ── Line height ──
    bind('ctrl-lineheight',
      cs.lineHeight === 'normal' ? '' : parseFloat(cs.lineHeight) / parseFloat(cs.fontSize),
      val => applyStyle(el, 'lineHeight', val));

    // ── Letter spacing ──
    bind('ctrl-letterspacing',
      cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing),
      val => applyStyle(el, 'letterSpacing', val + 'px'));

    // ── Text align ──
    document.querySelectorAll('.align-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === cs.textAlign);
      btn.onclick = () => {
        document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyStyle(el, 'textAlign', btn.dataset.val);
      };
    });

    // ── Colors ──
    document.getElementById('ctrl-color').value = rgbToHex(cs.color);
    document.getElementById('ctrl-color').oninput = e =>
      applyStyle(el, 'color', e.target.value);

    const bgRgba = parseRgba(cs.backgroundColor);
    document.getElementById('ctrl-bgcolor').value = rgbToHex(cs.backgroundColor);
    document.getElementById('ctrl-bgcolor').oninput = e => {
      const opacity = parseFloat(document.getElementById('ctrl-bgopacity').value);
      applyStyle(el, 'backgroundColor', hexToRgba(e.target.value, opacity));
    };
    document.getElementById('ctrl-bgopacity').value = bgRgba.a ?? 1;
    document.getElementById('ctrl-bgopacity').oninput = e => {
      const hex = document.getElementById('ctrl-bgcolor').value;
      applyStyle(el, 'backgroundColor', hexToRgba(hex, parseFloat(e.target.value)));
    };

    // ── Padding ──
    bindPx('ctrl-pt', cs.paddingTop,    v => applyStyle(el, 'paddingTop',    v + 'px'));
    bindPx('ctrl-pr', cs.paddingRight,  v => applyStyle(el, 'paddingRight',  v + 'px'));
    bindPx('ctrl-pb', cs.paddingBottom, v => applyStyle(el, 'paddingBottom', v + 'px'));
    bindPx('ctrl-pl', cs.paddingLeft,   v => applyStyle(el, 'paddingLeft',   v + 'px'));

    // ── Margin ──
    bindPx('ctrl-mt', cs.marginTop,    v => applyStyle(el, 'marginTop',    v + 'px'));
    bindPx('ctrl-mr', cs.marginRight,  v => applyStyle(el, 'marginRight',  v + 'px'));
    bindPx('ctrl-mb', cs.marginBottom, v => applyStyle(el, 'marginBottom', v + 'px'));
    bindPx('ctrl-ml', cs.marginLeft,   v => applyStyle(el, 'marginLeft',   v + 'px'));

    // ── Width / Height ──
    const wEl = document.getElementById('ctrl-width');
    const hEl = document.getElementById('ctrl-height');
    wEl.value = el.style.width || '';
    hEl.value = el.style.height || '';
    wEl.oninput = () => applyStyle(el, 'width',  wEl.value);
    hEl.oninput = () => applyStyle(el, 'height', hEl.value);

    // ── Border ──
    bind('ctrl-radius', parseInt(cs.borderRadius) || 0,
      v => applyStyle(el, 'borderRadius', v + 'px'));
    document.getElementById('ctrl-bordercolor').value = rgbToHex(cs.borderColor);
    document.getElementById('ctrl-bordercolor').oninput = e =>
      applyStyle(el, 'borderColor', e.target.value);
    bind('ctrl-borderwidth', parseInt(cs.borderWidth) || 0,
      v => applyStyle(el, 'borderWidth', v + 'px'));

    // ── Computed ──
    const keys = ['display','position','flexDirection','alignItems','justifyContent','overflow','zIndex','opacity'];
    document.getElementById('computed-styles').textContent =
      keys.map(k => `${k}: ${cs[k]}`).join('\n');
  }

  /* ── Apply style + record ────────────────────────────────────────────── */
  function applyStyle(el, prop, val) {
    el.style[prop] = val;
    recordChange(el, prop, val);
  }

  function recordChange(el, prop, val) {
    const xp = getXPath(el);
    if (!changeMap[currentPage]) changeMap[currentPage] = {};
    if (!changeMap[currentPage][xp]) changeMap[currentPage][xp] = {};
    changeMap[currentPage][xp][prop] = val;
  }

  function reapplyChanges(idx) {
    const map = changeMap[idx];
    if (!map) return;
    Object.entries(map).forEach(([xp, props]) => {
      const el = getByXPath(xp, iDoc);
      if (!el) return;
      Object.entries(props).forEach(([prop, val]) => {
        if (prop === 'innerText') el.innerText = val;
        else el.style[prop] = val;
      });
    });
  }

  /* ── Export ──────────────────────────────────────────────────────────── */
  function exportPage() {
    if (!iDoc) return;
    // Remove editor classes before export
    iDoc.querySelectorAll('.editor-hover, .editor-selected').forEach(el => {
      el.classList.remove('editor-hover', 'editor-selected');
    });
    const editorStyle = iDoc.getElementById('__editor-styles');
    if (editorStyle) editorStyle.remove();

    const html = '<!DOCTYPE html>\n' + iDoc.documentElement.outerHTML;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = PAGES[currentPage].src;
    a.click();

    // Re-inject editor styles after export
    setTimeout(() => injectInteraction(), 100);
  }

  /* ── Reset ───────────────────────────────────────────────────────────── */
  function resetPage() {
    if (!confirm('Reset all changes on this page?')) return;
    delete changeMap[currentPage];
    loadPage(currentPage);
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function bind(id, val, onChange) {
    const el = document.getElementById(id);
    el.value = isNaN(val) || val === '' ? '' : val;
    el.oninput = () => onChange(el.value);
  }

  function bindPx(id, csVal, onChange) {
    bind(id, parseInt(csVal) || 0, onChange);
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb === 'transparent') return '#000000';
    const m = rgb.match(/\d+/g);
    if (!m || m.length < 3) return '#000000';
    return '#' + m.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  }

  function parseRgba(str) {
    if (!str) return { r:0, g:0, b:0, a:1 };
    const m = str.match(/[\d.]+/g);
    if (!m) return { r:0, g:0, b:0, a:1 };
    return { r: +m[0], g: +m[1], b: +m[2], a: m[3] !== undefined ? +m[3] : 1 };
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function getXPath(el) {
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let idx = 1;
      let sib = node.previousSibling;
      while (sib) { if (sib.nodeType === 1 && sib.tagName === node.tagName) idx++; sib = sib.previousSibling; }
      parts.unshift(`${node.tagName.toLowerCase()}[${idx}]`);
      node = node.parentNode;
    }
    return '/' + parts.join('/');
  }

  function getByXPath(xpath, doc) {
    try {
      const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return result.singleNodeValue;
    } catch { return null; }
  }

})();
