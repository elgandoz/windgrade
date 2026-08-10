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
     stored. Everything else is a number field. */
  var isBool = (sp.t === "int" && sp.min === 0 && sp.max === 1);
  var input = document.createElement("input");
  if (isBool) {
    input.type = "checkbox";
  } else {
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
  if (sp.k === "zoom") {
    pair = document.createElement("b");
    pair.className = "pair";
    row.appendChild(pair);
  }

  function load() {
    var v = WG.getConfig()[sp.k];
    if (isBool) input.checked = !!v; else input.value = v;
    if (pair) pair.textContent = "XCTrack: " + (WG.XCT_SCALE[v] || "?");
  }

  input.addEventListener("change", function () {
    onInput(isBool ? (input.checked ? 1 : 0) : input.value);
  });

  return { el: row, load: load };
}

WG.fields = function (container, opts) {
  var o = opts || {}, built = [], i, sp;

  function reload() { for (var k = 0; k < built.length; k++) built[k].load(); }

  for (i = 0; i < WG.SPEC.length; i++) {
    sp = WG.SPEC[i];
    if (sp.ui === false) continue;                          /* URL-only */
    if (o.skipWidgetOnly && sp.only === "widget") continue;

    /* Closure per row, so the patch key is the row's own. */
    built.push(buildRow(sp, (function (spec) {
      return function (value) {
        var patch = {};
        patch[spec.k] = value;
        WG.setConfig(patch);
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
