# LAST HOP

A CCNA 200-301 boss-fight game. A city's backbone is failing and you're the on-call engineer. Each boss is a failure mode that has taken over part of the network. Correct answers repair links and damage the boss. Wrong answers cost you uptime.

This is the vertical slice. **The Mask** (1.0 Network Fundamentals) is fully playable with 49 questions. The other five bosses and The Outage appear on the roster but stay locked until their question banks are written.

## Run it

The game loads its questions as JSON, which browsers block from `file://`. Serve the folder:

```sh
cd last-hop
python3 -m http.server 8000
# open http://localhost:8000
```

It is plain HTML, CSS and JS with no build step, so GitHub Pages can host it as is.

To get a single self-contained file (questions inlined, no server needed):

```sh
node tools/bundle.js dist/last-hop.html
```

## How a fight works

| Mechanic | Rule |
|---|---|
| Boss HP | Blueprint weight × 18. The Mask is 20%, so it has 360 HP. |
| Attack vectors | Each turn offers up to 3 questions with different objectives. You choose. |
| Damage | Base by type (Recall 5, Scenario 8, Order 9, Calculate 10, Read the output 12) × (0.7 + 0.3 × difficulty) × crit × streak |
| Phases | At 66% HP, difficulty-2 questions. At 33%, difficulty 3 with a clock (20 to 45 s by type). |
| Weak points | 4 hidden objectives per boss deal ×1.8. Landing one exposes it, and it stays exposed across runs. |
| Uptime | You start at 99.999% (5 nines). A miss costs 0.5 nines. Below 90.000% the SLA is breached. |
| Convergence | Each consecutive correct answer adds +0.2× damage, up to ×2.0. A miss resets it. |
| Aftershocks | A missed question returns 3 turns later and has to be cleared. Across runs, missed questions are weighted to come up first. |
| Items | Packet Capture ×2 removes wrong options. TAC Case ×3 gives a hint for 0.2 nines (and 10 s on the clock). Reload in 5 ×1 undoes a miss. |

**Practice mode** gives you free hints, no clock and no uptime loss. The **mastery map** colors every blueprint objective green, amber or red from your last eight answers on it. Progress is saved in your browser's localStorage.

In simulation, a player who picks the hardest-hitting card wins about 88% of runs at 80% accuracy and about half at 70%. That puts the difficulty curve close to a real passing bar.

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
