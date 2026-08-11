/* ══════════════════════════════════════════════════════════════════════
   wg/fields.js — settings controls, generated from WG.SPEC.

   One renderer for every page that offers settings, so a new parameter
   needs no hand-written control anywhere and the launcher can never drift
   from a settings sheet. Markup is deliberately plain — a .field row with a
   <label>, a <small> hint and one input — and each page styles it.

   The only DOM-touching file besides the pages. core.js stays clean of the
   DOM, which is what keeps the engine testable in node.

     var f = WG.fields(el, {onChange: fn, skipWidgetOnly: true});
     f.reload();     // pull values back out of WG.getConfig(), e.g. after reset

   Rows are skipped when SPEC says `ui:false` (URL-only, like lat/lng — the
   launcher has no business offering a position field), when `hidden:true`
   marks a parameter that keeps working in URLs but gets no control at all,
   and, optionally, when `only:"widget"` marks a parameter that means nothing
   for a given view.

   LAYOUT: a row with no `grp` goes straight into the container. Everything
   else lands inside ONE collapsed <details>, under a heading per group, in
   SPEC order. Nineteen rows in a flat list is not a configurator, it is an
   inventory — and the two that decide whether the overlay works at all
   (`scale`, `alt`) were the hardest to find in it. Groups are headings
   rather than nested accordions on purpose: a second click to reach
   "Scale bar height" buys nothing once the first one has already been paid.

   Empty groups are dropped, so `skipWidgetOnly` cannot leave a heading with
   nothing under it, and the whole accordion is dropped if it would be empty.

   Not loaded by widget.html: it has no settings.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
"use strict";

var WG = global.WG = global.WG || {};

function buildRow(sp, onInput) {
  var row = document.createElement("div");
  row.className = "field";

  var lab = document.createElement("label");
  lab.htmlFor = "f_" + sp.k;
  lab.appendChild(document.createTextNode(sp.lab));
  if (sp.help) {
    var hint = document.createElement("small");
    hint.textContent = sp.help;
    lab.appendChild(hint);
  }
  row.appendChild(lab);

  /* A 0/1 integer with min 0 max 1 is a checkbox to a pilot, however it is
     stored. An enum is a select. Everything else is a number field. */
  var isBool = (sp.t === "int" && sp.min === 0 && sp.max === 1);
  var isEnum = (sp.t === "enum");
  var isLadder = (sp.t === "scale");
  var input, o, op;
  if (isLadder) {
    /* Ground scales, not ladder steps — the value stored is METRES, so the
       choice survives a move to a phone with a different pixel density and the
       overlay resolves it there.

       The union across densities, not this device's ladder: built from one
       device the list omitted 6km entirely, which a Pixel 9a does print, so
       that pilot could not choose what their own screen was showing. */
    input = document.createElement("select");
    var opts = WG.scaleOptions(null), n;
    for (n = 0; n < opts.length; n++) {
      op = document.createElement("option");
      op.value = opts[n];
      op.textContent = WG.fmtScale(opts[n]);
      input.appendChild(op);
    }
  } else if (isEnum) {
    input = document.createElement("select");
    for (o = 0; o < sp.opts.length; o++) {
      op = document.createElement("option");
      op.value = op.textContent = sp.opts[o];
      input.appendChild(op);
    }
  } else if (isBool) {
    input = document.createElement("input");
    input.type = "checkbox";
  } else {
    input = document.createElement("input");
    input.type = "number";
    input.inputMode = "numeric";
    if (sp.min !== undefined) input.min = sp.min;
    if (sp.max !== undefined) input.max = sp.max;
  }
  input.id = "f_" + sp.k;
  row.appendChild(input);

  /* The zoom row carries the XCTrack scale it pairs with, live, because the
     whole point of the configurator is producing a widget that matches the
     map underneath it. */
  var pair = null;
  if (sp.k === "scale") {
    pair = document.createElement("b");
    pair.className = "pair";
    row.appendChild(pair);
  }

  function load() {
    var v = WG.getConfig()[sp.k];
    if (isBool) input.checked = !!v; else input.value = v;
    /* Approximate on purpose. The step this scale becomes depends on the
       pilot's pixel density, which the launcher cannot know, so an exact-looking
       "=" here would be the same false precision the scale list just stopped
       claiming. */
    if (pair) pair.textContent =
      "≈ z" + WG.zoomForStep(WG.stepForScale(v, null)).toFixed(1);
  }

  input.addEventListener("change", function () {
    onInput(isBool ? (input.checked ? 1 : 0) : input.value);
  });

  return { el: row, load: load };
}

/* ── theme and scale ──────────────────────────────────────────────────
   Deliberately NOT in core.js. That file touches no DOM, which is what lets
   tools/test-core.js require it in node; putting a documentElement write
   there would break the whole test path for one convenience. ───────── */
WG.applyTheme = function () {
  var c = WG.getConfig(), el = document.documentElement;
  if (c.theme === "auto") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", c.theme);
  /* `size` drives text here and marker size in the overlay, and the two want
     different curves: 1 + size/100 put the default at 1.5x and overflowed the
     chip rows on a 430 px phone. 0.85..1.35 is the useful range for text; the
     overlay keeps its own mapping. Both stay monotonic in `size`, so the
     control still means one thing to a pilot. */
  el.style.setProperty("--scale", (0.85 + c.size / 200).toFixed(3));
};

WG.fields = function (container, opts) {
  var o = opts || {}, built = [], i, sp, row;
  var groups = [], byName = {};             /* first-appearance order */

  function reload() { for (var k = 0; k < built.length; k++) built[k].load(); }

  function make(spec) {
    var r = buildRow(spec, function (value) {
      var patch = {};
      patch[spec.k] = value;
      WG.setConfig(patch);
      WG.applyTheme();               /* live: theme and scale, no reload */
      reload();                      /* reflect clamping back into the fields */
      if (o.onChange) o.onChange();
    });
    built.push(r);
    r.load();
    return r.el;
  }

  for (i = 0; i < WG.SPEC.length; i++) {
    sp = WG.SPEC[i];
    if (sp.ui === false) continue;                          /* URL-only */
    if (sp.hidden) continue;                 /* still in URLs, no control */
    if (o.skipWidgetOnly && sp.only === "widget") continue;

    row = make(sp);
    if (!sp.grp) { container.appendChild(row); continue; }

    if (!byName[sp.grp]) {
      byName[sp.grp] = { name: sp.grp, rows: [] };
      groups.push(byName[sp.grp]);
    }
    byName[sp.grp].rows.push(row);
  }

  if (groups.length) {
    /* <details> rather than a class toggle: it collapses without script, it
       is what a phone's find-in-page and a screen reader already understand,
       and the arrow is the platform's own. */
    var det = document.createElement("details");
    det.className = "adv";
    if (o.advOpen) det.open = true;
    var sum = document.createElement("summary");
    sum.textContent = o.advLabel || "Advanced settings";
    det.appendChild(sum);

    for (i = 0; i < groups.length; i++) {
      var h = document.createElement("h3");
      h.className = "grp";
      h.textContent = groups[i].name;
      det.appendChild(h);
      for (var j = 0; j < groups[i].rows.length; j++) det.appendChild(groups[i].rows[j]);
    }
    container.appendChild(det);
  }

  return { reload: reload };
};

})(window);
