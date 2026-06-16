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
  { id: "healed",        label: "When you are healed",          group: "Happens to you", event: "healed" }
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

// True only on the one client that should post for this actor: the first active
// player-owner (sorted by id so every client agrees). NPCs with no player owner
// post nothing.
function isAnnouncer(actor) {
  const owners = game.users
    .filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"))
    .sort((a, b) => a.id.localeCompare(b.id));
  return owners.length > 0 && owners[0].id === game.user.id;
}

function currentUserReminders() {
  return game.settings.get(MODULE_ID, "reminders") ?? [];
}

function postReminder(actor, text) {
  if (!text || !text.trim()) return;
  ChatMessage.create({
    speaker: { alias: `Reminder, ${actor.name}` },
    content: `<div class="combat-reminder-message">${esc(text)}</div>`
  });
}

// Central dispatch: for an internal event on an actor, post this user's matching
// reminders. Gated so only the owning client runs it.
function emit(event, actor, ctx = {}) {
  if (!actor || !isAnnouncer(actor)) return;
  for (const r of currentUserReminders()) {
    const def = TRIGGERS.find((t) => t.id === r.trigger);
    if (!def || def.event !== event) continue;
    if (def.test && !def.test(ctx)) continue;
    postReminder(actor, r.text);
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
  const delta = changes?.hp ?? changes?.total ?? 0; // negative for damage
  const oldHP = newHP - delta;
  const maxHP = foundry.utils.getProperty(actor, "system.attributes.hp.max") ?? 0;
  emit("damaged", actor, { oldHP, newHP, maxHP });
});
Hooks.on("dnd5e.healActor", (actor) => {
  emit("healed", actor);
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
    actions: {
      addRow: ReminderConfig.#onAddRow,
      deleteRow: ReminderConfig.#onDeleteRow,
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
          <select name="trigger-${i}" class="cr-trigger">${ReminderConfig.#triggerOptions(r.trigger)}</select>
          <input type="text" name="text-${i}" class="cr-text" value="${esc(r.text)}" placeholder="Reminder text" />
          ${ReminderConfig.#renderParamField(def, r, i)}
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
      text: row.querySelector(".cr-text")?.value ?? ""
    }));
  }

  static #onAddRow() {
    this.#syncFromDOM();
    this.reminders.push({ trigger: DEFAULT_TRIGGER, text: "" });
    this.render();
  }

  static #onDeleteRow(event, target) {
    this.#syncFromDOM();
    this.reminders.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static async #onSave() {
    this.#syncFromDOM();
    const clean = this.reminders.filter((r) => r.text && r.text.trim().length);
    await game.settings.set(MODULE_ID, "reminders", clean);
    ui.notifications.info("Corn's Combat Reminders saved.");
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
