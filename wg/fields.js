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
   launcher has no business offering a position field) and, optionally, when
   `only:"widget"` marks a parameter that means nothing for a given view.

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
  var o = opts || {}, built = [], i, sp;

  function reload() { for (var k = 0; k < built.length; k++) built[k].load(); }

  for (i = 0; i < WG.SPEC.length; i++) {
    sp = WG.SPEC[i];
    if (sp.ui === false) continue;                          /* URL-only */
    if (sp.adv) continue;                    /* still in URLs, not in the UI */
    if (o.skipWidgetOnly && sp.only === "widget") continue;

    /* Closure per row, so the patch key is the row's own. */
    built.push(buildRow(sp, (function (spec) {
      return function (value) {
        var patch = {};
        patch[spec.k] = value;
        WG.setConfig(patch);
        WG.applyTheme();             /* live: theme and scale, no reload */
        reload();                    /* reflect clamping back into the fields */
        if (o.onChange) o.onChange();
      };
    })(sp)));
    built[built.length - 1].load();
    container.appendChild(built[built.length - 1].el);
  }

  return { reload: reload };
};

})(window);
