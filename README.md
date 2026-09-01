# Corn's Combat Reminders

Players forget the fiddly things in combat. Sneak Attack on the right turn, a
Bardic Inspiration die you meant to hand out, the rider on a magic item, a saving
throw bonus that only applies sometimes. Corn's Combat Reminders is a Foundry VTT
module for D&D 5e that lets each player write their own reminders and pick the
exact moment each one fires, like your attack roll, the top of your turn, dropping
below half HP, or finishing a long rest. When that moment arrives, the reminder
posts to chat for the character you own, so the prompt reaches you in play instead
of living on a sticky note next to your monitor.

## Requirements

- Foundry VTT v13 or later (verified on v14.367)
- D&D 5e system v5.0.0 or later, verified on v5.3.3 (the roll and damage
  triggers read the activity-based system hook signatures stabilized in 5.x;
  the combat-flow triggers work without them)

## Install

Manifest URL:

```
https://github.com/miniaturepancake/foundryvtt-corns-combat-reminders/releases/latest/download/module.json
```

## Use

Each player sets up their own list:

1. Open Configure Settings and find the Corn's Combat Reminders section.
2. Click Configure Reminders to open the window.
3. Click Add Reminder to get a new row.
4. Type the reminder text and pick a trigger from the dropdown.
5. Repeat for as many reminders as you want. Two rows can share a trigger.
6. Click Save.

![The Configure Reminders window with two example reminders](https://raw.githubusercontent.com/miniaturepancake/foundryvtt-corns-combat-reminders/main/assets/settings.png)

Each row has a few controls. The power toggle on the left silences a reminder
without deleting it, so a saved-but-off reminder never posts. The secret-agent
toggle on the right whispers that reminder privately to you instead of posting
it to public chat. The up and down chevrons reorder rows. Pressing Enter in a
text field saves and closes, the same as clicking Save.

Reminders are stored per browser for the logged-in user, so a player configures
their own list and it does not affect anyone else. Because the list lives in the
browser rather than in the world, it does not travel to another browser or
machine, and clearing site data clears it. Worth knowing if you play from more
than one computer.

## Triggers

Combat flow
- Start of combat
- Start of round
- Top of your turn
- End of your turn
- End of combat

Your rolls
- On your attack roll
- Attack roll, natural 20
- Attack roll, natural 1
- On your damage roll
- On a saving throw
- On an ability check
- On a skill check
- On a death save
- On rolling initiative

Happens to you
- When you are damaged
- When you drop to 0 HP
- When you fall below half HP
- When you are healed

Rest
- After a short rest
- After a long rest

## Notes and limits

- A reminder posts from one client only, so it fires once. Of the acting
  character's logged-in player owners, every client agrees on the same one, and
  that client is the one that posts. If no player owner is logged in (a GM-owned
  actor or NPC, or a solo GM session), the first active GM posts instead, using
  that GM's own reminder list.
- The list is tied to the user, not the character. A player running two
  characters gets the same reminders on both.
- "When you are damaged" keys off the system's HP-change hooks, so it covers
  damage applied through the system and direct HP changes alike. The natural 20,
  natural 1, dropped-to-0, and below-half variants are read straight from the
  die or the HP value, so they are reliable.
- Hit-or-miss against a target is intentionally not a trigger. Core 5e does not
  resolve that authoritatively without a heavy automation dependency, which this
  module avoids. "When you are damaged" covers most of that intent.
- If a GM rolls on behalf of a player's character, the reminder may not post,
  since the posting client is the player's, not the GM's.

## AI disclosure

Module contains no AI-generated art or game content. I came up with the idea and
guided the design decisions; Claude (Anthropic) assisted with the code, settings,
and documentation.

## License

MIT
