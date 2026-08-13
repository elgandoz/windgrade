/* ══════════════════════════════════════════════════════════════════════
   wg/qr.js, QR encoder for the launcher page.

   Byte mode, error correction level M, versions 1-10 (up to 213 bytes).
   A configured widget URL is around 100, so the ceiling is never in sight.

   Hand-written on purpose. A CDN library would add a dependency and a
   network call; a QR web service would also hand someone else the pilot's
   configuration just to draw a square. Neither is worth it for this.

   Loaded only by index.html: widget.html and app.html never pay for it.
   ES5, like every shipped file here; the original used const/let.
   Touches no DOM, in the spirit of core.js: WG.qr(text) hands back a
   square matrix of 0/1 and the page decides how to draw it.
   ══════════════════════════════════════════════════════════════════ */

(function(global){
"use strict";

var WG = global.WG = global.WG || {};

/* ── GF(256) arithmetic, primitive polynomial 0x11D ───────────────── */

var EXP = new Array(512), LOG = new Array(256);
(function(){
  var x = 1;
  for (var i = 0; i < 255; i++){
    EXP[i] = x; LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11D;
  }
  for (var i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function mul(a, b){ return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

/* Reed-Solomon generator polynomial for n check symbols, high degree first */
function rsPoly(n){
  var p = [1];
  for (var i = 0; i < n; i++){
    var q = p.slice();
    q.push(0);                                   // multiply by x
    for (var j = 0; j < p.length; j++) q[j + 1] ^= mul(p[j], EXP[i]);
    p = q;
  }
  return p;
}

/* polynomial long division; the remainder is the error correction block */
function rsEcc(data, n){
  var gen = rsPoly(n), res = data.slice();
  for (var i = 0; i < n; i++) res.push(0);
  for (var i = 0; i < data.length; i++){
    var f = res[i];
    if (f === 0) continue;
    for (var j = 1; j < gen.length; j++) res[i + j] ^= mul(gen[j], f);
  }
  return res.slice(data.length);
}

/* ── per-version tables, error correction level M ─────────────────────
   [total codewords, ec codewords per block,
    group 1 blocks, group 1 data codewords,
    group 2 blocks, group 2 data codewords]                            */

var RS = [null,
  [ 26, 10, 1, 16, 0,  0],
  [ 44, 16, 1, 28, 0,  0],
  [ 70, 26, 1, 44, 0,  0],
  [100, 18, 2, 32, 0,  0],
  [134, 24, 2, 43, 0,  0],
  [172, 16, 4, 27, 0,  0],
  [196, 18, 4, 31, 0,  0],
  [242, 22, 2, 38, 2, 39],
  [292, 22, 3, 36, 2, 37],
  [346, 26, 4, 43, 1, 44]
];

/* alignment pattern centre coordinates */
var ALIGN = [null, [], [6,18], [6,22], [6,26], [6,30], [6,34],
               [6,22,38], [6,24,42], [6,26,46], [6,28,50]];

function dataCodewords(v){ return RS[v][2] * RS[v][3] + RS[v][4] * RS[v][5]; }

/* the byte-mode character count field widens at version 10 */
function countBits(v){ return v < 10 ? 8 : 16; }

/* ── bitstream ────────────────────────────────────────────────────── */

function utf8(s){
  var out = [];
  for (var i = 0; i < s.length; i++){
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function codewords(bytes, v){
  var cap = dataCodewords(v) * 8;
  var bits = [];
  function put(val, n){ for (var i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); }

  put(4, 4);                                     // byte mode
  put(bytes.length, countBits(v));
  for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);

  put(0, Math.min(4, cap - bits.length));        // terminator
  while (bits.length % 8) bits.push(0);

  var pad = [0xEC, 0x11];
  var p = 0;
  while (bits.length < cap) put(pad[p++ & 1], 8);

  var cw = [];
  for (var i = 0; i < bits.length; i += 8){
    var b = 0;
    for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }
  return cw;
}

/* split into blocks, add error correction, then interleave both */
function interleave(cw, v){
  var ecn = RS[v][1], g1n = RS[v][2], g1d = RS[v][3],
        g2n = RS[v][4], g2d = RS[v][5];
  var blocks = [], eccs = [];
  var p = 0;

  for (var i = 0; i < g1n; i++){ var b = cw.slice(p, p + g1d); p += g1d; blocks.push(b); eccs.push(rsEcc(b, ecn)); }
  for (var i = 0; i < g2n; i++){ var b = cw.slice(p, p + g2d); p += g2d; blocks.push(b); eccs.push(rsEcc(b, ecn)); }

  var out = [], maxD = Math.max(g1d, g2d);
  for (var k = 0; k < maxD; k++)
    for (var i = 0; i < blocks.length; i++)
      if (k < blocks[i].length) out.push(blocks[i][k]);
  for (var k = 0; k < ecn; k++)
    for (var i = 0; i < eccs.length; i++) out.push(eccs[i][k]);
  return out;
}

/* ── format and version information, both BCH coded ───────────────── */

function formatBits(mask){
  var data = (0 << 3) | mask;                  // level M is 0b00
  var d = data << 10;
  for (var i = 14; i >= 10; i--) if (d & (1 << i)) d ^= 0x537 << (i - 10);
  return ((data << 10) | d) ^ 0x5412;
}

function versionBits(v){
  var d = v << 12;
  for (var i = 17; i >= 12; i--) if (d & (1 << i)) d ^= 0x1F25 << (i - 12);
  return (v << 12) | d;
}

/* ── mask patterns ────────────────────────────────────────────────── */

function masked(m, y, x){
  switch (m){
    case 0: return (y + x) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (y + x) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((y * x) % 2) + ((y * x) % 3) === 0;
    case 6: return ((((y * x) % 2) + ((y * x) % 3)) % 2) === 0;
    default: return ((((y + x) % 2) + ((y * x) % 3)) % 2) === 0;
  }
}

/* ── matrix ───────────────────────────────────────────────────────────
   null means "still free"; the data pass fills only those, which is what
   keeps it clear of the function patterns without a second bookkeeping
   array.                                                               */

function build(v, data, mask){
  var size = v * 4 + 17;
  var m = new Array(size);
  for (var i = 0; i < size; i++){
    m[i] = new Array(size);
    for (var j = 0; j < size; j++) m[i][j] = null;
  }

  function finder(r, c){
    for (var y = -1; y <= 7; y++) for (var x = -1; x <= 7; x++){
      var yy = r + y, xx = c + x;
      if (yy < 0 || yy >= size || xx < 0 || xx >= size) continue;
      var on = (x >= 0 && x <= 6 && (y === 0 || y === 6)) ||
                 (y >= 0 && y <= 6 && (x === 0 || x === 6)) ||
                 (x >= 2 && x <= 4 && y >= 2 && y <= 4);
      m[yy][xx] = on ? 1 : 0;                    // the -1 ring is the separator
    }
  }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (var i = 8; i < size - 8; i++){           // timing patterns
    var b = i % 2 === 0 ? 1 : 0;
    m[6][i] = b;
    m[i][6] = b;
  }

  var A = ALIGN[v];
  for (var i = 0; i < A.length; i++) for (var j = 0; j < A.length; j++){
    var r = A[i], c = A[j];
    if ((r === 6 && c === 6) || (r === 6 && c === size - 7) ||
        (r === size - 7 && c === 6)) continue;   // would sit on a finder
    for (var y = -2; y <= 2; y++) for (var x = -2; x <= 2; x++)
      m[r + y][c + x] = Math.max(Math.abs(x), Math.abs(y)) !== 1 ? 1 : 0;
  }

  var fb = formatBits(mask);
  for (var i = 0; i < 15; i++){
    var bit = (fb >> i) & 1;
    if (i < 6) m[i][8] = bit;
    else if (i < 8) m[i + 1][8] = bit;
    else m[size - 15 + i][8] = bit;

    if (i < 8) m[8][size - i - 1] = bit;
    else if (i < 9) m[8][15 - i] = bit;
    else m[8][14 - i] = bit;
  }
  m[size - 8][8] = 1;                            // always dark

  if (v >= 7){
    var vb = versionBits(v);
    for (var i = 0; i < 18; i++){
      var bit = (vb >> i) & 1;
      m[Math.floor(i / 3)][i % 3 + size - 11] = bit;
      m[i % 3 + size - 11][Math.floor(i / 3)] = bit;
    }
  }

  /* zigzag up and down two columns at a time, masking as we go */
  var dir = -1, row = size - 1, idx = 0;
  for (var col = size - 1; col > 0; col -= 2){
    if (col === 6) col--;                        // the timing column is not data
    for (;;){
      for (var c = 0; c < 2; c++){
        var x = col - c;
        if (m[row][x] !== null) continue;
        var bit = 0;
        if (idx >> 3 < data.length) bit = (data[idx >> 3] >> (7 - (idx & 7))) & 1;
        idx++;
        m[row][x] = masked(mask, row, x) ? bit ^ 1 : bit;
      }
      row += dir;
      if (row < 0 || row >= size){ row -= dir; dir = -dir; break; }
    }
  }
  return m;
}

/* ── mask selection ───────────────────────────────────────────────── */

function penalty(m){
  var n = m.length;
  var score = 0;

  for (var i = 0; i < n; i++){                   // rule 1: runs of five or more
    for (var pass = 0; pass < 2; pass++){
      var run = 1;
      for (var j = 1; j < n; j++){
        var a = pass ? m[j][i] : m[i][j];
        var b = pass ? m[j - 1][i] : m[i][j - 1];
        if (a === b) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  for (var i = 0; i < n - 1; i++)                // rule 2: solid 2x2 blocks
    for (var j = 0; j < n - 1; j++){
      var s = m[i][j] + m[i][j + 1] + m[i + 1][j] + m[i + 1][j + 1];
      if (s === 0 || s === 4) score += 3;
    }

  /* rule 3: the 1:1:3:1:1 finder signature preceded *or* followed by four
     light modules. Out of bounds counts as light, since the quiet zone is
     light too. That is what catches the real finder patterns, which scanners
     do confuse. Flanked on both sides is still one occurrence, not two.  */
  var core = [1,0,1,1,1,0,1];
  function scan(i, vertical){
    function at(t){
      if (t < 0 || t >= n) return 0;             // quiet zone reads as light
      return vertical ? m[t][i] : m[i][t];
    }
    var s = 0, j = 0;
    while (j <= n - 7){
      var hit = true;
      for (var k = 0; k < 7 && hit; k++) if (at(j + k) !== core[k]) hit = false;
      if (!hit){ j++; continue; }

      var before = true, after = true;
      for (var k = 1; k <= 4 && before; k++) if (at(j - k) !== 0) before = false;
      for (var k = 0; k < 4 && after; k++) if (at(j + 7 + k) !== 0) after = false;

      /* One flanked signature is one occurrence even when light on both
         sides, so a counted hit consumes its seven modules. An uncounted
         one can only be re-entered four modules along, given the shape. */
      if (before || after){ s += 40; j += 7; }
      else j += 4;
    }
    return s;
  }
  for (var i = 0; i < n; i++) score += scan(i, false) + scan(i, true);

  var dark = 0;                                  // rule 4: overall balance
  for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) dark += m[i][j];
  score += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;

  return score;
}

/* ── public ───────────────────────────────────────────────────────────
   Returns {size, modules} where modules[y][x] is 1 for a dark module,
   or null when the text is longer than version 10 can hold.             */

WG.qr = function(text){
  var bytes = utf8(String(text));

  var v = 0;
  for (var i = 1; i <= 10; i++)
    if (4 + countBits(i) + 8 * bytes.length <= dataCodewords(i) * 8){ v = i; break; }
  if (!v) return null;

  var data = interleave(codewords(bytes, v), v);

  var best = null, bestScore = Infinity;
  for (var mask = 0; mask < 8; mask++){
    var m = build(v, data, mask);
    var s = penalty(m);
    if (s < bestScore){ bestScore = s; best = m; }
  }
  return {size: best.length, modules: best};
};

})(window);
