/* Card modes: our grouping of the game's actionmaps into the views a pilot thinks in.
 * Based on the game's own actionmap labels/categories (FLIGHT, ON FOOT, Vehicle, …), not on JD's table.
 * Any actionmap not listed falls into "General". Colours match the v1 cards where the mode exists there. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KBModes = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MODES = [
    { id: "flight",   name: "Flight",         colour: "#1f6fb4", maps: ["seat_general", "spaceship_general", "vehicle_mfd", "spaceship_view", "spaceship_movement", "spaceship_quantum", "spaceship_docking", "spaceship_power", "spaceship_hud", "spaceship_radar", "IFCS_controls"] },
    { id: "weapons",  name: "Weapons",        colour: "#7b4fbf", maps: ["spaceship_targeting", "spaceship_targeting_advanced", "spaceship_target_hailing", "spaceship_weapons", "spaceship_missiles", "spaceship_defensive", "spaceship_auto_weapons"] },
    { id: "mining",   name: "Mining",         colour: "#a87900", maps: ["spaceship_mining"] },
    { id: "salvage",  name: "Salvage",        colour: "#2a8a2a", maps: ["spaceship_salvage"] },
    { id: "scanning", name: "Scanning",       colour: "#0e8a8a", maps: ["spaceship_scanning"] },
    { id: "turrets",  name: "Turrets",        colour: "#c2399b", maps: ["turret_movement", "turret_advanced", "RemoteRigidEntityController"] },
    { id: "ground",   name: "Ground vehicle", colour: "#8c564b", maps: ["vehicle_general", "vehicle_driver"] },
    { id: "foot",     name: "On foot",        colour: "#d9650b", maps: ["player", "prone", "incapacitated", "tractor_beam", "zero_gravity_eva", "zero_gravity_traversal", "player_emotes", "hacking", "mining"] },
    { id: "general",  name: "General",        colour: "#555555", maps: [] },
  ];
  const BY_MAP = new Map();
  for (const m of MODES) for (const a of m.maps) BY_MAP.set(a, m);
  const GENERAL = MODES[MODES.length - 1];
  function modeOf(actionmap) { return BY_MAP.get(actionmap) || GENERAL; }
  function order(id) { return MODES.findIndex((m) => m.id === id); }
  return { MODES, modeOf, order };
});
