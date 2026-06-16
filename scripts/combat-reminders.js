// Combat Reminders
// Player-authored reminders that post to chat on combat and roll events.
//
// Design notes:
//   - Each reminder is { trigger, text }. The list is stored per user (client scope).
//   - Only the acting character's owning client posts, so each reminder fires once.
//   - The trigger catalog is data-driven. Adding a trigger later is one new entry plus,
//     if it needs an internal event that no emitter covers yet, one new Hooks.on. The UI
//     and dispatch read the catalog, so nothing else changes.

const MODULE_ID = "corns-combat-reminders";

// --------------------------------------------------------------------------
// Trigger catalog
// --------------------------------------------------------------------------
// id      stable key saved on each reminder. Never rename an existing id.
// label   shown in the dropdown.
// group   dropdown section heading.
// event   internal event key an emitter dispatches (see the Hooks below).
// test    optional (ctx) => boolean filter on the event context.
// param   reserved. When a future trigger needs a second field (e.g. which
//         condition), give it a descriptor here and extend renderParamField.
//         Old saved reminders without the field read as "no filter", so adding
//         one needs no migration.
const TRIGGERS = [
  // Combat flow
  { id: "combatStart", label: "Start of combat",   group: "Combat flow",      event: "combatStart" },
  { id: "roundStart",  label: "Start of round",    group: "Combat flow",      event: "roundStart" },
  { id: "turnStart",   label: "Top of your turn",  group: "Combat flow",      event: "turnStart" },
  { id: "turnEnd",     label: "End of your turn",  group: "Combat flow",      event: "turnEnd" },
  { id: "combatEnd",   label: "End of combat",     group: "Combat flow",      event: "combatEnd" },

  // Your rolls
  { id: "attackRoll",  label: "On your attack roll",        group: "Your rolls", event: "attack" },
  { id: "attackNat20", label: "Attack roll, natural 20",    group: "Your rolls", event: "attack", test: (c) => c.d20 === 20 },
  { id: "attackNat1",  label: "Attack roll, natural 1",     group: "Your rolls", event: "attack", test: (c) => c.d20 === 1 },
  { id: "damageRoll",  label: "On your damage roll",        group: "Your rolls", event: "damageRoll" },
  { id: "savingThrow", label: "On a saving throw",          group: "Your rolls", event: "save" },
  { id: "abilityCheck",label: "On an ability check",        group: "Your rolls", event: "abilityCheck" },
  { id: "skillCheck",  label: "On a skill check",           group: "Your rolls", event: "skillCheck" },
  { id: "deathSave",   label: "On a death save",            group: "Your rolls", event: "deathSave" },
  { id: "initiative",  label: "On rolling initiative",      group: "Your rolls", event: "initiative" },

  // Happens to you
  { id: "damaged",       label: "When you are damaged",         group: "Happens to you", event: "damaged" },
  { id: "droppedToZero", label: "When you drop to 0 HP",        group: "Happens to you", event: "damaged", test: (c) => c.newHP === 0 && c.oldHP > 0 },
  { id: "bloodied",      label: "When you fall below half HP",  group: "Happens to you", event: "damaged", test: (c) => c.maxHP > 0 && c.newHP < c.maxHP / 2 && c.oldHP >= c.maxHP / 2 },
  { id: "healed",        label: "When you are healed",          group: "Happens to you", event: "healed" },

  // Rest (both share the rest event; the test picks short vs long off result.type)
  { id: "shortRest",     label: "After a short rest",           group: "Rest", event: "rest", test: (c) => c.type === "short" },
  { id: "longRest",      label: "After a long rest",            group: "Rest", event: "rest", test: (c) => c.type === "long" }
];

const DEFAULT_TRIGGER = TRIGGERS[0].id;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Resolve an actor from a hook subject that may be an Actor, an Activity, or an Item.
function asActor(subject) {
  if (!subject) return null;
  if (subject.documentName === "Actor") return subject;
  return subject.actor ?? subject.item?.actor ?? null;
}

// Natural d20 face from a D20Roll, or null if it can't be read.
function naturalD20(roll) {
  const die = roll?.dice?.find((d) => d.faces === 20);
  return die ? die.total : null;
}

// True only on the one client that should post for this actor, so each reminder
// fires once. Prefer the first active non-GM player owner (sorted by id so every
// client agrees), so a player's own client posts. If no player owner is active
// (a GM-owned actor or NPC, or a solo GM session), fall back to the first active
// GM. The GM is only a fallback, so it never double-posts on top of a player.
function isAnnouncer(actor) {
  const sortById = (a, b) => a.id.localeCompare(b.id);

  const playerOwners = game.users
    .filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"))
    .sort(sortById);
  if (playerOwners.length) return playerOwners[0].id === game.user.id;

  const gms = game.users.filter((u) => u.active && u.isGM).sort(sortById);
  return gms.length > 0 && gms[0].id === game.user.id;
}

function currentUserReminders() {
  return game.settings.get(MODULE_ID, "reminders") ?? [];
}

function postReminder(actor, text, whisper = false) {
  if (!text || !text.trim()) return;
  const data = {
    // alias is a plain-text field; Foundry escapes it when rendering the
    // message header, so it is not run through esc() here (that would
    // double-encode names containing & or '). Only content is raw HTML.
    speaker: { alias: `Reminder, ${actor.name}` },
    content: `<div class="combat-reminder-message"><i class="fas fa-bell"></i><span>${esc(text)}</span></div>`
  };
  // Whisper to self: only the client that posts (this user) sees it.
  if (whisper) data.whisper = [game.user.id];
  ChatMessage.create(data);
}

// Central dispatch: for an internal event on an actor, post this user's matching
// reminders. Gated so only the owning client runs it.
function emit(event, actor, ctx = {}) {
  if (!actor || !isAnnouncer(actor)) return;
  for (const r of currentUserReminders()) {
    if (r.enabled === false) continue; // disabled rows are saved but never post
    const def = TRIGGERS.find((t) => t.id === r.trigger);
    if (!def || def.event !== event) continue;
    if (def.test && !def.test(ctx)) continue;
    postReminder(actor, r.text, r.whisper === true);
  }
}

// --------------------------------------------------------------------------
// Emitters
// --------------------------------------------------------------------------
// Combat flow (core Foundry hooks)
Hooks.on("combatStart", (combat, updateData) => {
  for (const c of combat.combatants) emit("combatStart", c.actor);
  for (const c of combat.combatants) emit("roundStart", c.actor);
  // The opening turn does not arrive through combatTurnChange, so handle it here.
  const first = combat.turns?.[updateData?.turn ?? 0];
  if (first) emit("turnStart", first.actor);
});

Hooks.on("combatTurnChange", (combat, prior, current) => {
  // Skip the null -> 0 transition at combat start; combatStart already covered it.
  if (prior?.turn === null || prior?.turn === undefined) return;

  const prev = combat.combatants.get(prior.combatantId);
  if (prev) emit("turnEnd", prev.actor);

  if ((current?.round ?? 0) > (prior?.round ?? 0)) {
    for (const c of combat.combatants) emit("roundStart", c.actor);
  }

  const cur = combat.combatants.get(current.combatantId);
  if (cur) emit("turnStart", cur.actor);
});

Hooks.on("deleteCombat", (combat) => {
  for (const c of combat.combatants) emit("combatEnd", c.actor);
});

// Your rolls (dnd5e system hooks, names verified against the dnd5e Hooks wiki)
Hooks.on("dnd5e.rollAttack", (rolls, data) => {
  emit("attack", asActor(data?.subject), { d20: naturalD20(rolls?.[0]) });
});
Hooks.on("dnd5e.rollDamage", (rolls, data) => {
  emit("damageRoll", asActor(data?.subject));
});
Hooks.on("dnd5e.rollSavingThrow", (rolls, data) => {
  emit("save", asActor(data?.subject));
});
Hooks.on("dnd5e.rollAbilityCheck", (rolls, data) => {
  emit("abilityCheck", asActor(data?.subject));
});
Hooks.on("dnd5e.rollSkill", (rolls, data) => {
  emit("skillCheck", asActor(data?.subject));
});
Hooks.on("dnd5e.rollDeathSave", (rolls, data) => {
  emit("deathSave", asActor(data?.subject));
});
Hooks.on("dnd5e.rollInitiative", (actor) => {
  emit("initiative", actor);
});

// Happens to you (dnd5e HP-change hooks; fire on any HP change)
Hooks.on("dnd5e.damageActor", (actor, changes) => {
  const newHP = foundry.utils.getProperty(actor, "system.attributes.hp.value") ?? 0;
  // changes.hp is the change to real HP (negative for damage). Damage fully
  // absorbed by temp HP leaves changes.hp at 0, so oldHP === newHP and the
  // drop-to-0 / below-half tests correctly do not fire; the plain "damaged"
  // trigger still posts. This is intended, not a missing case.
  const delta = changes?.hp ?? changes?.total ?? 0;
  const oldHP = newHP - delta;
  // effectiveMax accounts for tempmax modifiers; fall back to max.
  const maxHP = foundry.utils.getProperty(actor, "system.attributes.hp.effectiveMax")
    ?? foundry.utils.getProperty(actor, "system.attributes.hp.max") ?? 0;
  emit("damaged", actor, { oldHP, newHP, maxHP });
});
Hooks.on("dnd5e.healActor", (actor) => {
  emit("healed", actor);
});

// Rest (dnd5e fires this once after a rest completes; result.type is "short" or
// "long", so one emitter serves both rest triggers)
Hooks.on("dnd5e.restCompleted", (actor, result) => {
  emit("rest", actor, { type: result?.type });
});

// --------------------------------------------------------------------------
// Config application
// --------------------------------------------------------------------------
const { ApplicationV2 } = foundry.applications.api;

class ReminderConfig extends ApplicationV2 {
  constructor(options = {}) {
    super(options);
    this.reminders = foundry.utils.deepClone(currentUserReminders());
  }

  static DEFAULT_OPTIONS = {
    id: "combat-reminders-config",
    tag: "form",
    classes: ["combat-reminders-config"],
    window: { title: "Corn's Combat Reminders", icon: "fas fa-bell", resizable: true },
    position: { width: 640, height: "auto" },
    // A form handler so pressing Enter in a text field submits cleanly (save and
    // close) instead of triggering a handler-less native submit. submitOnChange
    // is off so editing a field does not persist until the user commits.
    form: {
      handler: ReminderConfig.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: false
    },
    actions: {
      addRow: ReminderConfig.#onAddRow,
      deleteRow: ReminderConfig.#onDeleteRow,
      moveUp: ReminderConfig.#onMoveUp,
      moveDown: ReminderConfig.#onMoveDown,
      save: ReminderConfig.#onSave
    }
  };

  // Build the dropdown, grouped by catalog group.
  static #triggerOptions(selected) {
    const groups = [...new Set(TRIGGERS.map((t) => t.group))];
    return groups
      .map((g) => {
        const opts = TRIGGERS.filter((t) => t.group === g)
          .map((t) => `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${esc(t.label)}</option>`)
          .join("");
        return `<optgroup label="${esc(g)}">${opts}</optgroup>`;
      })
      .join("");
  }

  // Reserved seam for parameterized triggers. Returns extra inline fields for a
  // row. Today every trigger returns nothing.
  static #renderParamField(/* def, reminder, index */) {
    return "";
  }

  async _renderHTML() {
    const rows = this.reminders
      .map((r, i) => {
        const def = TRIGGERS.find((t) => t.id === r.trigger);
        return `
        <div class="cr-row" data-index="${i}">
          <div class="cr-order">
            <button type="button" class="cr-move" data-action="moveUp" data-index="${i}" title="Move up"><i class="fas fa-chevron-up"></i></button>
            <button type="button" class="cr-move" data-action="moveDown" data-index="${i}" title="Move down"><i class="fas fa-chevron-down"></i></button>
          </div>
          <label class="cr-toggle" title="Enabled. Uncheck to silence this reminder without deleting it.">
            <input type="checkbox" class="cr-enabled" ${r.enabled === false ? "" : "checked"} />
            <i class="fas fa-power-off"></i>
          </label>
          <select name="trigger-${i}" class="cr-trigger">${ReminderConfig.#triggerOptions(r.trigger)}</select>
          <input type="text" name="text-${i}" class="cr-text" value="${esc(r.text)}" placeholder="Reminder text" />
          ${ReminderConfig.#renderParamField(def, r, i)}
          <label class="cr-toggle" title="Whisper privately to you instead of posting to public chat.">
            <input type="checkbox" class="cr-whisper" ${r.whisper ? "checked" : ""} />
            <i class="fas fa-user-secret"></i>
          </label>
          <button type="button" class="cr-delete" data-action="deleteRow" data-index="${i}" title="Delete reminder">
            <i class="fas fa-trash"></i>
          </button>
        </div>`;
      })
      .join("");

    return `
      <p class="cr-intro">These reminders post to chat for the character you own. Add a row, type the text, and choose when it fires.</p>
      <div class="cr-rows">${rows || `<p class="cr-empty">No reminders yet. Click Add Reminder to start.</p>`}</div>
      <div class="cr-controls">
        <button type="button" data-action="addRow"><i class="fas fa-plus"></i> Add Reminder</button>
      </div>
      <footer class="cr-footer">
        <button type="button" class="cr-save" data-action="save"><i class="fas fa-save"></i> Save</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  // Read current field values back into this.reminders before any re-render, so
  // edits survive add and delete.
  #syncFromDOM() {
    const root = this.element;
    if (!root) return;
    this.reminders = [...root.querySelectorAll(".cr-row")].map((row) => ({
      trigger: row.querySelector(".cr-trigger")?.value ?? DEFAULT_TRIGGER,
      text: row.querySelector(".cr-text")?.value ?? "",
      enabled: row.querySelector(".cr-enabled")?.checked ?? true,
      whisper: row.querySelector(".cr-whisper")?.checked ?? false
    }));
  }

  static #onAddRow() {
    this.#syncFromDOM();
    this.reminders.push({ trigger: DEFAULT_TRIGGER, text: "", enabled: true, whisper: false });
    this.render();
  }

  static #onDeleteRow(event, target) {
    this.#syncFromDOM();
    this.reminders.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static #onMoveUp(event, target) {
    this.#syncFromDOM();
    const i = Number(target.dataset.index);
    if (i <= 0) return;
    [this.reminders[i - 1], this.reminders[i]] = [this.reminders[i], this.reminders[i - 1]];
    this.render();
  }

  static #onMoveDown(event, target) {
    this.#syncFromDOM();
    const i = Number(target.dataset.index);
    if (i >= this.reminders.length - 1) return;
    [this.reminders[i + 1], this.reminders[i]] = [this.reminders[i], this.reminders[i + 1]];
    this.render();
  }

  // Persist the current rows, dropping any with empty text.
  async #persist() {
    this.#syncFromDOM();
    const clean = this.reminders.filter((r) => r.text && r.text.trim().length);
    await game.settings.set(MODULE_ID, "reminders", clean);
    ui.notifications.info("Corn's Combat Reminders saved.");
  }

  static async #onSave() {
    await this.#persist();
    this.close();
  }

  // Form submit (e.g. Enter in a text field). Saves and closes, matching Save.
  static async #onSubmit() {
    await this.#persist();
    this.close();
  }
}

// --------------------------------------------------------------------------
// Registration
// --------------------------------------------------------------------------
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "reminders", {
    scope: "client",
    config: false,
    type: Array,
    default: []
  });

  game.settings.registerMenu(MODULE_ID, "configMenu", {
    name: "Corn's Combat Reminders",
    label: "Configure Reminders",
    hint: "Add your own reminders and choose when each one fires.",
    icon: "fas fa-bell",
    type: ReminderConfig,
    restricted: false
  });
});
