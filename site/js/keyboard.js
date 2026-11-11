/* US ANSI full-size keyboard (104 keys + F-row + nav + numpad), our own drawing data: no licence question.
 * Each key: [game token, legend, x (units), y (units), width (units), height (units)].
 * Tokens are Star Citizen's keyboard names (kb1_<token>); tokens never seen in game data use the obvious name. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KBKeyboard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const K = [];
  const row = (y, x0, keys) => { let x = x0; for (const [t, l, w = 1] of keys) { if (t) K.push([t, l, x, y, w, 1]); x += w; } };

  // F-row (y = 0)
  row(0, 0, [["escape", "Esc"], [null, "", 1], ["f1", "F1"], ["f2", "F2"], ["f3", "F3"], ["f4", "F4"], [null, "", 0.5],
             ["f5", "F5"], ["f6", "F6"], ["f7", "F7"], ["f8", "F8"], [null, "", 0.5], ["f9", "F9"], ["f10", "F10"], ["f11", "F11"], ["f12", "F12"]]);
  row(0, 15.5, [["print", "PrtSc"], ["scrolllock", "ScrLk"], ["pause", "Pause"]]);
  // main block (y = 1.5 .. 5.5)
  const Y = 1.5;
  row(Y, 0, [["grave", "`"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"], ["8", "8"], ["9", "9"], ["0", "0"],
             ["minus", "-"], ["equals", "="], ["backspace", "Backspace", 2]]);
  row(Y + 1, 0, [["tab", "Tab", 1.5], ["q", "Q"], ["w", "W"], ["e", "E"], ["r", "R"], ["t", "T"], ["y", "Y"], ["u", "U"], ["i", "I"], ["o", "O"], ["p", "P"],
                 ["lbracket", "["], ["rbracket", "]"], ["backslash", "\\", 1.5]]);
  row(Y + 2, 0, [["capslock", "Caps Lock", 1.75], ["a", "A"], ["s", "S"], ["d", "D"], ["f", "F"], ["g", "G"], ["h", "H"], ["j", "J"], ["k", "K"], ["l", "L"],
                 ["semicolon", ";"], ["apostrophe", "'"], ["enter", "Enter", 2.25]]);
  row(Y + 3, 0, [["lshift", "Left Shift", 2.25], ["z", "Z"], ["x", "X"], ["c", "C"], ["v", "V"], ["b", "B"], ["n", "N"], ["m", "M"],
                 ["comma", ","], ["period", "."], ["slash", "/"], ["rshift", "Right Shift", 2.75]]);
  row(Y + 4, 0, [["lctrl", "Left Ctrl", 1.25], ["lwin", "Win", 1.25], ["lalt", "Left Alt", 1.25], ["space", "Space", 6.25],
                 ["ralt", "Right Alt", 1.25], ["rwin", "Win", 1.25], ["apps", "Menu", 1.25], ["rctrl", "Right Ctrl", 1.25]]);
  // navigation cluster
  row(Y, 15.5, [["insert", "Insert"], ["home", "Home"], ["pgup", "PgUp"]]);
  row(Y + 1, 15.5, [["delete", "Delete"], ["end", "End"], ["pgdn", "PgDn"]]);
  row(Y + 3, 16.5, [["up", "↑"]]);
  row(Y + 4, 15.5, [["left", "←"], ["down", "↓"], ["right", "→"]]);
  // numpad
  row(Y, 19, [["numlock", "Num Lock"], ["np_divide", "Num /"], ["np_multiply", "Num *"], ["np_subtract", "Num -"]]);
  row(Y + 1, 19, [["np_7", "Num 7"], ["np_8", "Num 8"], ["np_9", "Num 9"]]);
  row(Y + 2, 19, [["np_4", "Num 4"], ["np_5", "Num 5"], ["np_6", "Num 6"]]);
  row(Y + 3, 19, [["np_1", "Num 1"], ["np_2", "Num 2"], ["np_3", "Num 3"]]);
  row(Y + 4, 19, [["np_0", "Num 0", 2], ["np_period", "Num ."]]);
  K.push(["np_add", "Num +", 22, Y + 1, 1, 2]);
  K.push(["np_enter", "Num Enter", 22, Y + 3, 1, 2]);

  const WIDTH_U = 23, HEIGHT_U = Y + 5;
  const BY_TOKEN = new Map(K.map((k) => [k[0], k]));
  const MOD_NAME = { lshift: "LShift", rshift: "RShift", lctrl: "LCtrl", rctrl: "RCtrl", lalt: "LAlt", ralt: "RAlt" };
  return { KEYS: K, WIDTH_U, HEIGHT_U, BY_TOKEN, MOD_NAME, LAYOUT: "US ANSI full-size" };
});
