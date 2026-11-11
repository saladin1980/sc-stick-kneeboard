/* Stage B resolver: a player's actionmaps export + the game data -> effective joystick binds.
 * A port of tool/resolve_binds.py resolve_full(); the test suite checks both give the same binds.
 * Pure functions; the same code runs in the browser and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KBResolve = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** Which joystick the game's defaults land on. Evidence says js1 (left for Sal); NOT confirmed in-game.
   *  The page's "my default stick" toggle overrides it per profile. */
  const DEFAULT_STICK_INSTANCE = 1;

  const JS_RE = /^js(\d+)_(.*)$/;

  function parseProduct(product) {
    return String(product || "").replace(/\s*\{[0-9A-Fa-f-]+\}\s*$/, "").trim();
  }

  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  function unent(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, b) =>
      b[0] === "#" ? String.fromCodePoint(b[1] === "x" || b[1] === "X" ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10))
                   : (ENT[b] !== undefined ? ENT[b] : m));
  }
  function attrs(s) {
    const out = {};
    for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = unent(m[2] !== undefined ? m[2] : m[3]);
    return out;
  }

  /**
   * text: the export file's text. One small tag reader, the same in the browser and in Node, for the
   * game's machine-written format. Returns {devices: Map(inst -> name), rebinds: [...]}.
   */
  function parseExport(text) {
    const clean = String(text).replace(/<!--[\s\S]*?-->/g, "");
    if (!/<ActionMaps\b/.test(clean)) throw new Error("not a Star Citizen actionmaps export (no <ActionMaps>)");
    const devices = new Map(), rebinds = [], kbRebinds = [];
    let am = null, act = null;
    for (const m of clean.matchAll(/<(\/?)(options|actionmap|action|rebind)\b([^>]*?)(\/?)>/g)) {
      const [, close, tag, rest, selfClose] = m;
      if (close) {
        if (tag === "actionmap") am = null;
        if (tag === "action") act = null;
        continue;
      }
      const a = attrs(rest);
      if (tag === "options") {
        if (a.type === "joystick" && a.instance) devices.set(Number(a.instance), parseProduct(a.Product));
      } else if (tag === "actionmap") {
        am = selfClose ? null : a.name;
      } else if (tag === "action") {
        act = selfClose ? null : a.name;
      } else if (tag === "rebind" && am && act) {
        const j = JS_RE.exec(a.input || "");
        const k = KB_RE.exec(a.input || "");
        if (j) rebinds.push({ actionmap: am, action: act, instance: Number(j[1]), raw: j[2].trim(),
                              activation: a.activationMode || null });
        else if (k) kbRebinds.push({ actionmap: am, action: act, raw: k[1].trim(), activation: a.activationMode || null });
      }
    }
    return { devices, rebinds, kbRebinds };
  }

  // ---- keyboard (Stage C): a port of tool/resolve_binds.py resolve_keyboard()
  const KB_RE = /^kb1_(.*)$/;
  const KEY_ALIAS = { "]": "rbracket", "[": "lbracket" };
  const MODIFIERS = new Set(["lshift", "rshift", "lctrl", "rctrl", "lalt", "ralt"]);
  /** Order doesn't decide the key: 7 game defaults put the modifier last ("u+lshift", "f6+lalt").
   *  The key is the non-modifier token; if every token is a modifier (a lone "lalt"), the last one is the key. */
  function splitKeys(raw) {
    const parts = raw.split("+").map((p) => p.trim()).filter(Boolean).map((p) => KEY_ALIAS[p] || p.toLowerCase());
    if (!parts.length) return [[], ""];
    const keys = parts.filter((p) => !MODIFIERS.has(p));
    if (!keys.length) return [parts.slice(0, -1), parts[parts.length - 1]];
    return [parts.filter((p) => MODIFIERS.has(p)), keys[keys.length - 1]];
  }

  /** One keyboard slot per action: any kb1_ rebind (blank too) replaces that action's keyboard defaults. */
  function resolveKeyboard(exp, data) {
    const meta = new Map();
    for (const am of data.actionmaps) for (const a of am.actions) meta.set(am.name + "|" + a.name, a);
    const rebound = new Set((exp.kbRebinds || []).map((r) => r.actionmap + "|" + r.action));
    const out = [];
    const mk = (am, a, key, mods, source, activation, known) => ({
      device: "Keyboard", actionmap: am, action: a.name, input: key, modifiers: mods,
      label: a.label || humanize(a.name), source, activation: activation || null,
      ui: known ? a.ui !== false : true, guessed: !a.label });
    for (const am of data.actionmaps) {
      for (const a of am.actions) {
        if (rebound.has(am.name + "|" + a.name)) continue;
        for (const raw of a.keyboard || []) {
          const [mods, key] = splitKeys(raw);
          out.push(mk(am.name, a, key, mods, "default", a.activation, true));
        }
      }
    }
    for (const r of exp.kbRebinds || []) {
      if (!r.raw) continue;
      const [mods, key] = splitKeys(r.raw);
      const known = meta.has(r.actionmap + "|" + r.action);
      out.push(mk(r.actionmap, known ? meta.get(r.actionmap + "|" + r.action) : { name: r.action, label: null }, key, mods, "rebind", r.activation, known));
    }
    return out;
  }

  function splitModifier(raw) {
    if (raw.includes("+")) {
      const i = raw.indexOf("+");
      const rest = raw.slice(i + 1).split("+");
      return [raw.slice(0, i), rest[rest.length - 1]];
    }
    return [null, raw];
  }

  function humanize(id) {
    const parts = id.split("_");
    const words = parts.length > 1 && parts[0].length <= 3 ? parts.slice(1) : parts;
    const s = words.join(" ");
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  /**
   * defaultInstance: a joystick instance number, or "all".
   * Returns binds: {device, instance, actionmap, action, input, label, source, modifier, activation, ui}
   */
  function resolveFull(exp, data, defaultInstance) {
    const di = defaultInstance === undefined ? DEFAULT_STICK_INSTANCE : defaultInstance;
    const meta = new Map();     // "am|action" -> {label, ui}
    const maps = [];
    for (const am of data.actionmaps) {
      const actions = [];
      for (const a of am.actions) {
        // guessed: the game data has no name for it, so the label is made from the action id
        meta.set(am.name + "|" + a.name, { label: a.label || humanize(a.name), ui: a.ui !== false, guessed: !a.label });
        actions.push(a);
      }
      maps.push([am.name, actions]);
    }
    const insts = Array.from(exp.devices.keys()).sort((a, b) => a - b);
    const targets = di === "all" ? insts : insts.filter((i) => i === Number(di));
    // one joystick slot per action: any joystick rebind (any stick, blank too) replaces the default
    const rebound = new Set(exp.rebinds.map((r) => r.actionmap + "|" + r.action));
    const dev = (i) => exp.devices.get(i) || `Joystick ${i}`;
    const out = [];
    for (const [amName, actions] of maps) {
      for (const a of actions) {
        if (rebound.has(amName + "|" + a.name)) continue;
        for (const inst of targets) {
          for (const raw of a.joystick || []) {
            const [mod, inp] = splitModifier(raw);
            const m = meta.get(amName + "|" + a.name);
            out.push({ device: dev(inst), instance: inst, actionmap: amName, action: a.name, input: inp,
              label: m.label, source: "default", modifier: mod, activation: a.activation || null, ui: m.ui, guessed: m.guessed });
          }
        }
      }
    }
    for (const r of exp.rebinds) {
      if (!r.raw) continue;
      const [mod, inp] = splitModifier(r.raw);
      // an action missing from this game version's data (renamed/removed): keep it, flag the guessed name
      const m = meta.get(r.actionmap + "|" + r.action) || { label: humanize(r.action), ui: true, guessed: true };
      out.push({ device: dev(r.instance), instance: r.instance, actionmap: r.actionmap, action: r.action,
        input: inp, label: m.label, source: "rebind", modifier: mod, activation: r.activation, ui: m.ui, guessed: m.guessed });
    }
    return out;
  }

  return { DEFAULT_STICK_INSTANCE, parseExport, parseProduct, resolveFull, resolveKeyboard, splitKeys, humanize, splitModifier };
});
