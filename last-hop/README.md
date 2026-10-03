# LAST HOP

A CCNA 200-301 boss-fight game. A city's backbone is failing and you're the on-call engineer. Each boss is a failure mode that has taken over part of the network. Correct answers repair links and damage the boss. Wrong answers cost you uptime.

Only the first boss is playable so far. **The Mask** (1.0 Network Fundamentals) has 49 questions. The other five bosses, The Outage and Exam mode are listed as locked until their questions are written.

## Run it

The game loads its questions as JSON, which browsers block from `file://`. Serve the folder:

```sh
cd last-hop
python3 -m http.server 8000
# open http://localhost:8000
```

It is plain HTML, CSS and JS with no build step, so GitHub Pages can host it as is.

To get a single self-contained file (questions and fonts inlined, no server or network needed):

```sh
node tools/bundle.js dist/last-hop.html
```

## Controls

Every action works with a mouse, a touch screen or a key. On a keyboard, the bar along the bottom of the screen shows the keys for the current screen.

| Key | Action |
|---|---|
| `Q` / `E` | Previous / next tab (Home, Match, Mastery, How to play) |
| `Enter` | Select, kick off, continue |
| `Esc` | Back |
| `↑` / `↓` | Move through lists, answers and terminal lines |
| `←` / `→` | Switch between Boss match and Practice on the match setup screen |
| `1` `2` `3` | Pick a question card |
| `A` `B` `C` `D` | Answer a multiple-choice question |
| `F` | Flag the selected terminal line |
| `L` | Lock in an order |
| `X` / `H` | Packet Capture / TAC Case |
| `R` | Reload, right after a miss |

## How a match works

| Mechanic | Rule |
|---|---|
| Boss HP | Blueprint weight × 18. The Mask is 20%, so it has 360 HP. |
| Cards | Each turn deals up to 3 question cards from different topics. The number on a card is its damage. You choose. |
| Damage | Base by type × (0.7 + 0.3 × difficulty) × weak point × streak. Bronze cards: Recall 5. Silver: Scenario 8, Put in order 9. Gold: Calculate 10, Read the output 12. |
| Phases | At 66% HP, difficulty-2 questions. At 33%, difficulty 3 with a clock (20 to 45 s by type). |
| Weak points | 4 hidden topics per boss take ×1.8 damage. Answering one correctly reveals it for every later match. |
| Uptime | You start at 99.999% (5 nines). A miss costs 0.5 nines. At 90.000% the SLA is breached and the match is lost. |
| Streak | Each consecutive correct answer adds +0.2× damage, up to ×2.0. A miss resets it. |
| Aftershocks | A missed question returns 3 turns later and has to be cleared. Questions missed in earlier matches come up first. |
| Items | Packet Capture ×2 removes wrong options. TAC Case ×3 gives a hint for 0.2 nines (and 10 s on the clock). Reload ×1 undoes a miss. |

**Practice** gives you free hints, no clock and no uptime loss. Ratings still update, but best uptime isn't saved. The **Mastery** screen rates every exam topic 0 to 99 from your last eight answers on it, once it has at least three. Progress is saved in your browser's localStorage.

In simulation, a player who picks the hardest-hitting card wins about 88% of matches at 80% accuracy and about half at 70%. That puts the difficulty curve close to a real passing bar.

## Project layout

```
index.html                 page shell
css/style.css              all styling
js/engine.js               rules: damage, phases, streaks, uptime, aftershocks, answer checking (no DOM)
js/arena.js                SVG topology and the boss figure
js/audio.js                synthesized server-room hum, relay clicks, alarm (WebAudio, no files)
js/app.js                  screens and battle UI
data/blueprint.json        CCNA 200-301 v1.1 domains, weights and objectives
data/bosses.json           roster, weak points, boss dialogue
data/questions/*.json      one question bank per domain
tools/validate.js          schema check, math recomputation, run simulation
tools/bundle.js            single-file build
fonts/                     self-hosted Barlow, Barlow Condensed and IBM Plex Mono (SIL OFL, see fonts/OFL.txt)
```

## Adding questions

Questions are data, so adding one never touches game code. Every question has:

```jsonc
{
  "id": "nf-050",            // unique
  "obj": "1.6",              // blueprint objective, must exist in blueprint.json
  "type": "calc",            // recall | scenario | calc | output | order
  "diff": 2,                 // 1-3: sets the phase it appears in and its damage
  "title": "Short card title",
  "prompt": "The question",
  "hint": "What the TAC case says",
  "explain": "Why the answer is right"
}
```

Then by type:

- **recall / scenario**: `choices: [{ "t": "...", "why": "why this is wrong" }]` and `answer` (index). Write distractors from real mistakes, and give every wrong choice a `why`. Choices are shuffled at runtime.
- **calc**: `kind` (`ipv4`, `mask`, `ipv6`, `hex`, `number`, `text`) and `answer`. Input is normalized, so `/26` matches `255.255.255.192` and `2001:db8::1` matches the expanded form. Unparseable input is rejected without penalty.
- **output**: `terminal: { prompt, cmd, lines[] }`, `answer: [lineIndex]`, and optional `lineWhy: { "lineIndex": "why that line isn't the proof" }`. Terminal output must be accurate to real IOS, Windows or Linux output.
- **order**: `items` listed in the correct order. They are shuffled at runtime.

Then run the validator:

```sh
node tools/validate.js
```

It checks the schema and objective tags. It also recomputes every subnetting and EUI-64 answer with independent math, and simulates runs to confirm the boss can be won and lost. To add a new boss, set `"available": true` and point `questions` at its bank in `data/bosses.json`.

## Blueprint note

Domain weights and objective numbers follow the CCNA 200-301 **v1.1** exam topics: Fundamentals 20%, Access 20%, IP Connectivity 25%, IP Services 10%, Security 15%, Automation 10%. Cisco revises exam topics, so check the current list on cisco.com before relying on them.
