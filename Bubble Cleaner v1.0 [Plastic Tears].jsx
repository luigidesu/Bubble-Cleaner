/*
<javascriptresource>
<name>Bubble Cleaner [Plastic Tears]</name>
<enableinfo>true</enableinfo>
<category>Plastic Tears</category>
<about>
Bubble Cleaner v1.0 by Plastic Tears

https://plastictears.com/
</about>
</javascriptresource>
*/


// Bubble Cleaner v1.0 [Plastic Tears]
//
// Paints over the text inside speech bubbles.
// Select the bubbles (magic wand, marquee, lasso, whatever you like), then run it.
// You can select a lot of bubbles at once.
// The paint goes on a layer called "Cleaning", the page itself isn't touched.


// ---------------- Settings ----------------

// What to paint the bubbles with:
//   "white"            pure white
//   "black"            pure black
//   "black and white"  white bubbles white, black bubbles black
//   "colour"           each bubble keeps its own color (for colored pages)
var MODE = "colour";

// The layer it paints on. It uses the first one of these it finds,
// if there's none it makes a new "Cleaning" layer.
var TARGETS    = ["Whiteout", "Cleaning"];
var LAYER_NAME = "Cleaning";


// You shouldn't need these, only if something looks off.

// It painted over art inside the selection? Lower it.
// Big lettering got left behind? Raise it.
var HOLE_LIMIT = 25;

// A thin line of old text is left against the bubble outline? Set it to 3.
var TRIM = 2;

// A tiny bubble got skipped? Set it to 4.
var SPECK_OPEN = 2;

// Colour mode only.
// One bubble came out in two shades? Raise it.
// Two bubbles with different colors got the same one? Lower it.
var COLOUR_TOL = 26;

// Colour mode only. Colors this close to white or black become pure white or black.
var SNAP = 6;


// Leave these alone.
var SNAP_SAT    = 12;
var TONE_SPLIT  = 128;        // brightness that splits light from dark
var TONE_MIX    = 0.02;
var MAX_BUBBLES = 40;         // max different colors in one run
var FLOOD_TOL   = 64;         // don't set to 0
var SPECK       = 6;          // anything smaller than this is noise
var GROW_TOL    = 30;
var REF_HEIGHT  = 1200;
var SCALE_TRIM  = false;
var SINGLE_UNDO = true;       // the whole run is one undo step
var LIGHTEN_LAYERS = ["Whiteout"];  // layers set to Lighten, only white gets painted on these


#target photoshop;

function cTID(s) { return app.charIDToTypeID(s); }
function sTID(s) { return app.stringIDToTypeID(s); }
function D()     { return new ActionDescriptor(); }

// curly quotes for the messages
var LQ = String.fromCharCode(0x201C), RQ = String.fromCharCode(0x201D);

// runs a Photoshop command, and says which one if it fails
function play(name, id, d) {
    try { executeAction(sTID(id), d, DialogModes.NO); }
    catch (e) { throw new Error("Step " + LQ + name + RQ + " failed.\n\n" + e.message); }
}

// same fill as the White/Black Bubbles actions
function fillWith(which) {
    var d = D();
    d.putEnumerated(cTID("Usng"), cTID("FlCn"), cTID(which));
    d.putUnitDouble(cTID("Opct"), cTID("#Prc"), 100);
    d.putEnumerated(cTID("Md  "), cTID("BlnM"), cTID("Nrml"));
    play("Fill", "fill", d);
}

function fillColour(c) {
    restoreChannels();
    if (isPureWhite(c)) return fillWith("Wht ");
    if (isPureBlack(c)) return fillWith("Blck");
    var d = D(), col = D();
    col.putDouble(cTID("Rd  "), c[0]);
    col.putDouble(cTID("Grn "), c[1]);
    col.putDouble(cTID("Bl  "), c[2]);
    d.putEnumerated(cTID("Usng"), cTID("FlCn"), cTID("Clr "));
    d.putObject(cTID("Clr "), cTID("RGBC"), col);
    d.putUnitDouble(cTID("Opct"), cTID("#Prc"), 100);
    d.putEnumerated(cTID("Md  "), cTID("BlnM"), cTID("Nrml"));
    play("Fill (sampled colour)", "fill", d);
}

function makeLayer(name) {
    var d = D(), r = new ActionReference(), u = D();
    r.putClass(cTID("Lyr "));
    d.putReference(cTID("null"), r);
    u.putString(cTID("Nm  "), name);
    d.putObject(cTID("Usng"), cTID("Lyr "), u);
    play("New layer", "make", d);
}

function contract(px, atBounds) {
    var d = D();
    d.putUnitDouble(cTID("By  "), cTID("#Pxl"), px);
    d.putBoolean(sTID("selectionModifyEffectAtCanvasBounds"), !!atBounds);
    play("Contract " + px + "px", "contract", d);
}

// Select > Grow, works on whatever channel is active
function grow(tol) {
    var d = D(), r = new ActionReference();
    r.putProperty(cTID("Chnl"), sTID("selection"));
    d.putReference(cTID("null"), r);
    d.putInteger(cTID("Tlrn"), tol);
    play("Grow", "grow", d);
}

function inverse() { play("Inverse", "inverse", undefined); }

function deselect() {
    var d = D(), r = new ActionReference();
    r.putProperty(cTID("Chnl"), sTID("selection"));
    d.putReference(cTID("null"), r);
    d.putEnumerated(cTID("T   "), cTID("Ordn"), cTID("None"));
    play("Deselect", "set", d);
}

// makes the active channel pure black and white
function thresholdBinary() {
    var d = D();
    d.putInteger(cTID("Lvl "), 128);
    executeAction(sTID("thresholdClassEvent"), d, DialogModes.NO);
}

// Color Range > Highlights inside the selection
function colorRangeLight(limit) {
    restoreChannels();
    var d = D();
    d.putEnumerated(cTID("Clrs"), cTID("Clrs"), cTID("Hghl"));
    d.putInteger(sTID("highlightsFuzziness"), 0);
    d.putInteger(sTID("highlightsLowerLimit"), limit);
    d.putInteger(sTID("colorModel"), 0);
    play("Color Range (tone split)", "colorRange", d);
}

function hasSelection(doc) {
    try { doc.selection.bounds; return true; } catch (e) { return false; }
}

// sizes in pixels, whatever units the rulers are set to
function selBoundsPx(doc) {
    var r = new ActionReference();
    r.putProperty(cTID("Prpr"), sTID("selection"));
    r.putEnumerated(cTID("Dcmn"), cTID("Ordn"), cTID("Trgt"));
    var s = executeActionGet(r).getObjectValue(sTID("selection"));
    return [Math.round(s.getUnitDoubleValue(cTID("Left"))), Math.round(s.getUnitDoubleValue(cTID("Top "))),
            Math.round(s.getUnitDoubleValue(cTID("Rght"))), Math.round(s.getUnitDoubleValue(cTID("Btom")))];
}

function pageSizePx(doc) {
    var r = new ActionReference();
    r.putEnumerated(cTID("Dcmn"), cTID("Ordn"), cTID("Trgt"));
    var d = executeActionGet(r), k = doc.resolution / 72;
    return [Math.round(d.getUnitDoubleValue(sTID("width")) * k),
            Math.round(d.getUnitDoubleValue(sTID("height")) * k)];
}


// ---------------- Channels ----------------
// The work happens in temporary alpha channels, so the layers aren't touched
// until the paint goes down. Switching channels is slow, so it keeps track.

var chanDirty  = false;     // an alpha channel is active
var chanActive = null;      // which one
var compShown  = false;     // the color channels are visible too

function compositeActive(doc) {
    try {
        var a = doc.activeChannels;
        if (a.length !== doc.componentChannels.length) return false;
        for (var i = 0; i < a.length; i++) {
            if (a[i].kind !== ChannelType.COMPONENT) return false;
        }
        return true;
    } catch (e) {
        return false;
    }
}

function useChannel(doc, ch) {
    if (chanDirty && chanActive === ch) return;
    doc.activeChannels = [ch];
    chanDirty = true; chanActive = ch; compShown = false;
}

// back to the normal color channels
function restoreChannels(doc) {
    if (!chanDirty) return;
    doc = doc || app.activeDocument;
    doc.activeChannels = doc.componentChannels;
    chanDirty = false; chanActive = null; compShown = false;
}

// lets it read colors without leaving the alpha channel
function readable(doc) {
    if (!chanDirty || compShown) return;
    var c = doc.componentChannels;
    for (var i = 0; i < c.length; i++) c[i].visible = true;
    compShown = true;
}

// copies the selection into a new channel and makes it active
function activeCopy(doc) {
    var c = doc.channels.add();
    chanDirty = true; chanActive = c; compShown = false;
    try { doc.selection.store(c, SelectionType.REPLACE); }
    catch (e) { dropActive(doc, c); throw e; }
    return c;
}

function dropActive(doc, c) {
    var wasActive = chanDirty && chanActive === c;
    try { c.remove(); } catch (e) { return; }
    if (wasActive) { chanDirty = false; chanActive = null; compShown = false; }
}

// Select > Save Selection
function storeNew(doc) {
    var d = D(), r = new ActionReference();
    r.putProperty(cTID("Chnl"), sTID("selection"));
    d.putReference(cTID("null"), r);
    play("Save selection", "duplicate", d);
    return doc.channels[doc.channels.length - 1];
}


// ---------------- Masks ----------------

// a box around the selection, a bit bigger
function bboxRect(doc, W, H, pad) {
    var b = selBoundsPx(doc);
    var x0 = Math.max(0, b[0] - pad), y0 = Math.max(0, b[1] - pad);
    var x1 = Math.min(W, b[2] + pad), y1 = Math.min(H, b[3] + pad);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

// a tiny spot just outside the selection
function outsidePatch(doc, W, H) {
    var b = selBoundsPx(doc), x, y;
    if      (b[1] >= 3)     { x = Math.max(0, b[0]); y = b[1] - 3; }
    else if (b[3] <= H - 3) { x = Math.max(0, b[0]); y = b[3] + 1; }
    else if (b[0] >= 3)     { x = b[0] - 3; y = Math.max(0, b[1]); }
    else if (b[2] <= W - 3) { x = b[2] + 1; y = Math.max(0, b[1]); }
    else                    { return null; }
    x = Math.min(Math.max(x, 0), W - 2);
    y = Math.min(Math.max(y, 0), H - 2);
    return [[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2]];
}

// Turns the selection into the area to paint: the bubble plus the text holes inside it.
// Same steps as the White Bubbles action.
function buildMask(doc, W, H, holeLimit, trim) {
    var mask = activeCopy(doc);
    try {
        if (holeLimit > 0) {
            var box = bboxRect(doc, W, H, 2 * holeLimit + trim + 8);
            inverse();
            doc.selection.select(box, SelectionType.INTERSECT);
            contract(holeLimit, false);
            grow(GROW_TOL);
            inverse();
        } else {
            var patch = outsidePatch(doc, W, H);
            if (!patch) throw new Error("The selection reaches every edge of the page, "
                                      + "so there is no outside to flood from.");
            doc.selection.select(patch);
            grow(FLOOD_TOL);
            inverse();
        }

        if (trim > 0) contract(trim, false);
        if (!hasSelection(doc)) {
            throw new Error("The mask came out empty. If HOLE_LIMIT is large "
                          + "relative to the bubble, try lowering it.");
        }
    } finally {
        dropActive(doc, mask);
    }
}

// throws away bits of the selection thinner than px, keeps the rest whole
function openSelection(doc, px) {
    var stored = activeCopy(doc);
    var ok = false;
    try {
        try { contract(px, false); } catch (e) { return false; }
        if (!hasSelection(doc)) return false;
        grow(FLOOD_TOL);
        ok = true;
    } finally {
        if (ok) { try { doc.selection.load(stored, SelectionType.INTERSECT); } catch (e) {} }
        dropActive(doc, stored);
    }
    return hasSelection(doc);
}

// makes a saved channel pure black and white (needs nothing selected to work)
function hardenChannel(doc, chan) {
    try { deselect(); useChannel(doc, chan); thresholdBinary(); }
    catch (e) {}
}

// selects one bubble out of the ones saved in chan, false when none are left
function peelComponent(doc, chan) {
    deselect(); useChannel(doc, chan); thresholdBinary();
    doc.selection.load(chan, SelectionType.REPLACE);
    if (!hasSelection(doc)) return false;
    var b = selBoundsPx(doc);
    doc.selection.select([[b[0], b[1]], [b[2], b[1]], [b[2], b[1] + 2], [b[0], b[1] + 2]],
                         SelectionType.INTERSECT);
    if (!hasSelection(doc)) return false;
    var c = selBoundsPx(doc);
    doc.selection.select([[c[0], c[1]], [c[0] + 2, c[1]], [c[0] + 2, c[3]], [c[0], c[3]]],
                         SelectionType.INTERSECT);
    if (!hasSelection(doc)) return false;
    grow(FLOOD_TOL);
    doc.selection.load(chan, SelectionType.INTERSECT);
    return hasSelection(doc);
}

// Drops anything that sits inside another group, like the letters
// when you draw a box around the text.
function dropEnclosed(doc, groups) {
    var kept = [], g, h;

    // skip pairs that are nowhere near each other
    var box = [];
    for (g = 0; g < groups.length; g++) {
        box[g] = null;
        if (groups[g].dead || !groups[g].mask) continue;
        doc.selection.load(groups[g].mask, SelectionType.REPLACE);
        if (hasSelection(doc)) box[g] = selBoundsPx(doc);
    }
    function touches(a, b) {
        return a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    }

    for (g = 0; g < groups.length; g++) {
        if (groups[g].dead || !groups[g].mask) continue;
        var alive = true;
        for (h = 0; h < groups.length && alive; h++) {
            if (h === g || groups[h].dead || !groups[h].mask) continue;
            if (!touches(box[g], box[h])) continue;
            doc.selection.load(groups[g].mask, SelectionType.REPLACE);
            doc.selection.load(groups[h].mask, SelectionType.DIMINISH);
            if (!hasSelection(doc)) { alive = false; break; }
            useChannel(doc, groups[g].mask);
            grow(FLOOD_TOL);
            doc.selection.load(groups[g].mask, SelectionType.INTERSECT);
            if (!hasSelection(doc)) { alive = false; break; }
            doc.selection.store(groups[g].mask, SelectionType.REPLACE);
        }
        if (alive) kept.push(groups[g]);
    }
    return kept;
}


// ---------------- Color ----------------

function medianOf(h) {
    var tot = 0, run = 0, v;
    for (v = 0; v < 256; v++) tot += h[v];
    if (!tot) return -1;
    for (v = 0; v < 256; v++) { run += h[v]; if (run * 2 >= tot) return v; }
    return 255;
}

// the selection's color, and how much of it is light
function readSelection(doc) {
    readable(doc);
    var chans = doc.componentChannels, m = [], c, h, v, tot = 0, light = 0;
    for (c = 0; c < chans.length; c++) {
        h = chans[c].histogram;
        m.push(medianOf(h));
        for (v = 0; v < 256; v++) { tot += h[v]; if (v >= TONE_SPLIT) light += h[v]; }
    }
    if (m.length === 1) m = [m[0], m[0], m[0]];
    return { colour: m, lightFraction: tot ? (light / tot) : 1 };
}

function sampleColour(doc) { return readSelection(doc).colour; }

function isPureWhite(c) { return c[0] === 255 && c[1] === 255 && c[2] === 255; }
function isPureBlack(c) { return c[0] === 0   && c[1] === 0   && c[2] === 0;   }

// almost white becomes white, almost black becomes black
function snapColour(c) {
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    if (mx - mn <= SNAP_SAT) {
        if (mn >= 255 - SNAP) return [255, 255, 255];
        if (mx <= SNAP)       return [0, 0, 0];
    }
    return c;
}

function colourNear(a, b, tol) {
    return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}


// ---------------- Layers ----------------

function findLayer(container, name, kind) {
    for (var i = 0; i < container.layers.length; i++) {
        var L = container.layers[i];
        if (L.name.toLowerCase() === name.toLowerCase() && L.typename === kind) return L;
        if (L.typename === "LayerSet") {
            var hit = findLayer(L, name, kind);
            if (hit) return hit;
        }
    }
    return null;
}

function isLightenLayer(name) {
    for (var i = 0; i < LIGHTEN_LAYERS.length; i++) {
        if (LIGHTEN_LAYERS[i].toLowerCase() === name.toLowerCase()) return true;
    }
    return false;
}

// blend modes where a dark fill wouldn't show
function isLightenBlend(bm) {
    return bm === BlendMode.LIGHTEN || bm === BlendMode.LIGHTERCOLOR
        || bm === BlendMode.SCREEN  || bm === BlendMode.COLORDODGE
        || bm === BlendMode.LINEARDODGE;
}

// why it can't merge into that layer, if it can't
function mergeBlocker(L) {
    if (L.allLocked || L.pixelsLocked) return "locked";
    if (!L.visible) return "hidden";
    return null;
}

// true when it's a plain normal layer it can paint on directly
function fillsInPlace(L) {
    var r = new ActionReference();
    r.putIdentifier(cTID("Lyr "), L.id);
    var d = executeActionGet(r), i;
    function has(key, want) {
        var k = sTID(key);
        if (!d.hasKey(k)) return false;
        var t = d.getType(k);
        if (t === DescValueType.BOOLEANTYPE)    return d.getBoolean(k) === want;
        if (t === DescValueType.INTEGERTYPE)    return d.getInteger(k) === want;
        if (t === DescValueType.ENUMERATEDTYPE) return d.getEnumerationValue(k) === sTID(want);
        return false;
    }
    if (!(has("layerKind", 1) && has("mode", "normal") && has("opacity", 255)
       && has("fillOpacity", 255) && has("group", false) && has("background", false)
       && has("hasUserMask", false) && has("hasVectorMask", false)
       && has("hasFilterMask", false) && d.hasKey(sTID("layerLocking")))) return false;
    if (d.getObjectValue(sTID("layerLocking")).getBoolean(sTID("protectTransparency"))) return false;
    var extras = ["layerEffects", "blendRange", "knockout", "blendInterior", "blendClipped",
                  "transparencyShapesLayer", "layerMaskAsGlobalMask", "vectorMaskAsGlobalMask"];
    for (i = 0; i < extras.length; i++) if (d.hasKey(sTID(extras[i]))) return false;
    return true;
}

function selectOnly(doc, L) {
    var r = new ActionReference(), k = sTID("targetLayers");
    r.putProperty(cTID("Prpr"), k);
    r.putEnumerated(cTID("Dcmn"), cTID("Ordn"), cTID("Trgt"));
    try {
        var d = executeActionGet(r);
        if (d.hasKey(k) && d.getList(k).count === 1 && doc.activeLayer.id === L.id) return;
    } catch (e) {}
    doc.activeLayer = L;
}

// the first TARGETS layer or group that exists
function findTarget(doc, needNormal) {
    var i, L;
    for (i = 0; i < TARGETS.length; i++) {
        if (needNormal && isLightenLayer(TARGETS[i])) continue;
        L = findLayer(doc, TARGETS[i], "ArtLayer");
        if (L) {
            if (needNormal && isLightenBlend(L.blendMode)) continue;
            return { layer: L, group: null };
        }
    }
    for (i = 0; i < TARGETS.length; i++) {
        if (needNormal && isLightenLayer(TARGETS[i])) continue;
        L = findLayer(doc, TARGETS[i], "LayerSet");
        if (L) {
            if (needNormal && isLightenBlend(L.blendMode)) continue;
            return { layer: null, group: L };
        }
    }
    return { layer: null, group: null };
}


// ---------------- Checks ----------------

function canonicalMode() {
    var m = String(MODE).toLowerCase().replace(/[^a-z]/g, "");
    if (m === "color") m = "colour";
    if (m === "blackandwhite" || m === "blackwhite" || m === "bw"
     || m === "auto") m = "bw";
    if (m === "white" || m === "black" || m === "bw" || m === "colour") return m;
    throw new Error("MODE is set to " + LQ + MODE + RQ + ", which is not one of "
                  + "\"white\", \"black\", \"black and white\" or \"colour\". "
                  + "Nothing was changed.");
}

function checkDocumentMode(doc) {
    if (doc.mode === DocumentMode.BITMAP || doc.mode === DocumentMode.INDEXEDCOLOR
     || doc.mode === DocumentMode.MULTICHANNEL) {
        throw new Error("This document is in " + String(doc.mode).replace("DocumentMode.", "")
                      + " mode, which has no layers. Convert it to Grayscale or RGB first "
                      + "(Image > Mode). Nothing was changed.");
    }
}


// ---------------- Grouping ----------------
// Bubbles that need a different paint color go in different groups,
// and each group gets filled on its own.

// everything gets the same color
function groupsSingle(ctx, light, info) {
    var colour = ctx.sampled ? snapColour(info.colour) : (light ? [255, 255, 255] : [0, 0, 0]);
    buildMask(ctx.doc, ctx.W, ctx.H, ctx.limit, ctx.trim);
    return [{ mask: null, light: light, colour: colour }];
}

function buildGroupMasks(ctx, groups) {
    var doc = ctx.doc;
    for (var g = 0; g < groups.length; g++) {
        doc.selection.load(groups[g].wand, SelectionType.REPLACE);
        try { buildMask(doc, ctx.W, ctx.H, ctx.limit, ctx.trim); }
        catch (e) { groups[g].dead = true; continue; }
        if (!hasSelection(doc)) { groups[g].dead = true; continue; }
        groups[g].mask = ctx.keep(storeNew(doc));
    }
}

// Colour mode: goes bubble by bubble, reads each one's color,
// and puts bubbles of the same color together.
function groupsByColour(ctx) {
    var doc = ctx.doc, groups = [], g;

    // what's left to go through
    var remainder = ctx.keep(activeCopy(doc));
    hardenChannel(doc, remainder);

    // clear out the noise first so it doesn't count as bubbles
    doc.selection.load(remainder, SelectionType.REPLACE);
    if (openSelection(doc, Math.max(2, Math.round(ctx.limit / SPECK_OPEN)))) {
        doc.selection.store(remainder, SelectionType.REPLACE);
        hardenChannel(doc, remainder);
    }

    var retried = false, made = 0;
    for (var it = 0; made < MAX_BUBBLES && it < MAX_BUBBLES * 20; it++) {
        if (!peelComponent(doc, remainder)) {
            // one more try before giving up
            if (retried) break;
            retried = true;
            hardenChannel(doc, remainder);
            if (!peelComponent(doc, remainder)) break;
        }
        retried = false;

        var b = selBoundsPx(doc);
        if (b[2] - b[0] < SPECK && b[3] - b[1] < SPECK) {   // too small, skip it
            doc.selection.store(remainder, SelectionType.DIMINISH);
            continue;
        }
        var col = snapColour(sampleColour(doc));

        var bucket = null;
        for (g = 0; g < groups.length; g++) {
            if (colourNear(groups[g].colour, col, COLOUR_TOL)) { bucket = groups[g]; break; }
        }
        if (!bucket) {
            bucket = { colour: col, wand: ctx.keep(storeNew(doc)),
                       light: (col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11) >= TONE_SPLIT };
            groups.push(bucket);
            made++;
        } else {
            doc.selection.store(bucket.wand, SelectionType.EXTEND);
        }
        doc.selection.store(remainder, SelectionType.DIMINISH);
    }
    if (!groups.length) throw new Error("Nothing was selected.");

    buildGroupMasks(ctx, groups);
    var live = dropEnclosed(doc, groups);
    if (!live.length) throw new Error("The mask came out empty.");
    groups = live;
    return groups;
}

// Black and white mode with both kinds selected:
// splits the light bubbles from the dark ones.
function groupsByTone(ctx) {
    var doc = ctx.doc, groups = [];

    var wand = ctx.keep(storeNew(doc));

    hardenChannel(doc, wand);
    doc.selection.load(wand, SelectionType.REPLACE);
    if (!hasSelection(doc)) throw new Error("The selection is too faint: no pixel in it is "
                                       + "more than half selected, so there is nothing to fill.");

    // the light part
    var anyLight = false;
    try { colorRangeLight(TONE_SPLIT); anyLight = hasSelection(doc); }
    catch (e) { anyLight = false; }
    if (anyLight) {
        doc.selection.load(wand, SelectionType.INTERSECT);
        anyLight = hasSelection(doc);
    }
    var lightWand = anyLight ? ctx.keep(storeNew(doc)) : null;

    // get rid of the thin outlines around the letters
    var probe = Math.max(2, ctx.trim);
    var lightGroup = null, darkGroup = null;
    if (lightWand && openSelection(doc, probe)) lightGroup = ctx.keep(storeNew(doc));
    doc.selection.load(wand, SelectionType.REPLACE);
    if (lightWand) doc.selection.load(lightWand, SelectionType.DIMINISH);
    if (hasSelection(doc) && openSelection(doc, probe)) darkGroup = ctx.keep(storeNew(doc));
    if (lightGroup) groups.push({ light: true,  colour: [255, 255, 255], wand: lightGroup });
    if (darkGroup)  groups.push({ light: false, colour: [0, 0, 0],       wand: darkGroup });
    if (!groups.length) {
        throw new Error("Nothing substantial was selected - the wand "
                      + "picked up only thin edges.");
    }

    buildGroupMasks(ctx, groups);
    var kept = dropEnclosed(doc, groups);
    if (!kept.length) {
        throw new Error("Every group looked like text. Try wanding the "
                      + "bubble interior rather than drawing a box round it.");
    }
    return kept;
}

// picks which of the three above to use
function collectGroups(ctx) {
    var info = null, single = ctx.forced, light = (ctx.mode === "white");
    if (!ctx.forced) {
        info = readSelection(ctx.doc);
        if      (info.lightFraction >= 1 - TONE_MIX) { single = true; light = true;  }
        else if (info.lightFraction <= TONE_MIX)     { single = true; light = false; }
    }
    if (single)                return groupsSingle(ctx, light, info);
    if (ctx.mode === "colour") return groupsByColour(ctx);
    return groupsByTone(ctx);
}


// ---------------- Paint ----------------

function paintGroups(ctx, groups) {
    var doc = ctx.doc, g, needNormal = false;
    for (g = 0; g < groups.length; g++) {
        if (!isPureWhite(groups[g].colour)) needNormal = true;
    }

    restoreChannels(doc);
    var target  = findTarget(doc, needNormal);
    var blocker = target.layer ? mergeBlocker(target.layer) : null;
    var inPlace = !!target.layer && !blocker && fillsInPlace(target.layer);
    var merging = !!target.layer && !blocker && !inPlace;

    if (inPlace) {
        selectOnly(doc, target.layer);
    } else {
        makeLayer(merging ? target.layer.name : LAYER_NAME);
        if (target.layer)      doc.activeLayer.move(target.layer, ElementPlacement.PLACEBEFORE);
        else if (target.group) doc.activeLayer.move(target.group, ElementPlacement.INSIDE);
    }

    for (g = 0; g < groups.length; g++) {
        if (groups[g].mask) doc.selection.load(groups[g].mask, SelectionType.REPLACE);
        if (hasSelection(doc)) fillColour(groups[g].colour);
    }
    deselect();

    if (merging) {
        var keepName = target.layer.name, merged = doc.activeLayer.merge();
        if (merged.name !== keepName) merged.name = keepName;
    } else if (blocker) {
        WARNING = LQ + target.layer.name + RQ + " is " + blocker + ", so the bubbles "
                + "were left on their own " + LQ + LAYER_NAME + RQ + " layer just above it. "
                + (blocker === "hidden" ? "Show" : "Unlock")
                + " it and merge down if you want them combined.";
    }
}


// ---------------- Main ----------------

function main() {
    var doc  = app.activeDocument;
    var mode = canonicalMode();
    checkDocumentMode(doc);

    // in case an alpha channel was selected when you ran it
    if (!compositeActive(doc)) { chanDirty = true; restoreChannels(doc); }

    // colour mode only makes sense on RGB pages
    if (mode === "colour" && doc.mode !== DocumentMode.RGB) mode = "bw";

    var size = pageSizePx(doc), H = size[1], scale = H / REF_HEIGHT;
    var forced = (mode === "white" || mode === "black");
    var ctx = {
        doc: doc, W: size[0], H: H, mode: mode, forced: forced,
        limit: HOLE_LIMIT > 0 ? Math.max(1, Math.round(HOLE_LIMIT * scale)) : 0,   // bigger pages, bigger limit
        trim:  SCALE_TRIM ? Math.max(1, Math.round(TRIM * scale)) : TRIM,
        sampled: mode === "colour",
        scratch: []
    };
    ctx.keep = function (ch) { ctx.scratch.push(ch); return ch; };

    try {
        paintGroups(ctx, collectGroups(ctx));
    } finally {
        // delete the temporary channels
        for (var i = ctx.scratch.length - 1; i >= 0; i--) {
            try { ctx.scratch[i].remove(); } catch (e) {}
        }
    }
}

// a message to show at the end, when something went a bit differently
var WARNING = null;

if (!app.documents.length) {
    alert("Open a document first.");
} else if (!hasSelection(app.activeDocument)) {
    alert("Select a bubble first, then run.");
} else {
    var doc  = app.activeDocument;
    var snap = doc.activeHistoryState;
    var prev = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
    try {
        if (SINGLE_UNDO) doc.suspendHistory("Bubble Cleaner", "main()");
        else             main();
    } catch (e) {
        WARNING = null;
        try { doc.activeHistoryState = snap; } catch (e2) {}
        alert(e.message);
    } finally {
        app.displayDialogs = prev;
    }
    if (WARNING) alert(WARNING);
}
