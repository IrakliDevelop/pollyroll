# Sound research

What was tried, measured, and chosen for Pollyroll's impact sounds, so a later change can start
from evidence instead of from scratch. Dates are when the work was done.

- Dice: recorded clacks in `pollyroll/sounds` (0.5.0, 2026-10-19).
- Coin: modal synth with recorded clinks blended in, chosen in the lab on 2026-10-19, built, then
  **not shipped**: in the demo the owner judged it "not great", so 0.6.0 coins are silent. See
  [Coin sound in the tray (not shipped)](#coin-sound-in-the-tray-not-shipped).

The Coin Flip Lab's source is in [coin-lab/](coin-lab/) and rebuilds locally (see
[Rebuilding the coin lab](#rebuilding-the-coin-lab)).

## Licensing rules for embedded sound

A sound that ships inside the npm package must allow redistribution of the raw audio inside an
open-source package. CC0 or public domain is required; CC-BY would need credit in the package and
was avoided.

| Source                    | Verdict    | Why                                                                                |
| ------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| Kenney (kenney.nl)        | Usable     | CC0, every pack, no account                                                        |
| Freesound, CC0 filter     | Usable     | CC0 per sound (check each page; uploaders mix licenses); free account to download  |
| BigSoundBank              | Usable     | CC0, no account                                                                    |
| OpenGameArt               | Per item   | Mixed licenses; filter to CC0                                                      |
| Wikimedia Commons         | Per item   | Public-domain items only; many are CC-BY-SA                                        |
| Pixabay                   | Not usable | License bars distributing content "on a Standalone basis"                          |
| Sonniss GDC bundles       | Not usable | Forbids redistributing the files on their own or inside an asset pack              |
| Zapsplat, Mixkit, BBC SFX | Not usable | No standalone redistribution / non-commercial (from summaries; pages not readable) |

## Dice clacks (0.5.0)

- Source: Kenney Casino Audio (CC0), `dice-throw-1..3`.
- Synthesis failed twice by ear:
  - A modal thud fitted to the energy spectrum sounded "like a burp".
  - A rattle of short high resonances "can't get close".
- Measured at 0.25 ms: a recorded clack is 2 to 5 micro-impacts 1 to 3 ms apart. Each rings at
  5 to 6.5 kHz and falls 20 dB within 0.75 to 6 ms, with an optional 1 to 1.5 kHz table knock.
- Shipped: 7 clacks cut from the three throws. They are low-passed at 8 kHz, because the 8 to
  12 kHz hiss made some clacks sound papery. One MP3 at 16 kHz and 16 kbps, 1,188 B, base64,
  1.27 kB min+gzip.
- Ogg Opus was rejected because it needs Safari 18.4 or later; MP3 decodes everywhere.
- WebKit does not trim the MP3 encoder delay (69 ms). Clack starts are anchored at the first
  sample above 20% of the clip's peak, which sits above MP3 pre-echo (see `clackStarts` in
  `src/render/sound.ts`).
- Owner verdict: "really solid. Not ideal, but solid"; keep all seven clacks for variety.

## Coin

### Sources tried

| Clip                                                  | Source               | License       | Used for                   |
| ----------------------------------------------------- | -------------------- | ------------- | -------------------------- |
| `handleCoins`, `handleCoins2`, `metalClick`           | Kenney RPG Audio     | CC0           | 8 single clinks            |
| `impactMetal_light_000..004`                          | Kenney Impact Sounds | CC0           | Metal tap take (rejected)  |
| Coin spinning on a table #4 (€2 coin, varnished wood) | BigSoundBank s2700   | CC0           | Reference; 12 rim contacts |
| Coin Drop (Vinrax)                                    | OpenGameArt          | CC0           | Reference; 3 drop hits     |
| Coin dropped on wooden floor (ezwa)                   | Wikimedia Commons    | Public domain | Reference; 4 drop hits     |

Kenney Casino Audio has no metal sounds (cards, poker chips and dice only).

Freesound CC0 candidates that were not downloaded, because they need an account:

- [Coin_Spin_Drop_01](https://freesound.org/people/artisan187/sounds/818514/) by artisan187.
  Spins, wobbles and stops; 4 s; the best match.
- [Spinning Coin](https://freesound.org/people/CassieTee/sounds/209462/) by CassieTee.
  Spinning down on wood.
- [coin 3](https://freesound.org/people/arseniiv/sounds/257347/) by arseniiv. Settles after a
  flip.
- [2 € Coin Flip](https://freesound.org/people/fedecortex/sounds/587022/) by fedecortex.
- [Coin Spin (long)](https://freesound.org/people/jon.k.clancy/sounds/402934/) by jon.k.clancy.
- Short flips:
  [Mediasaur](https://freesound.org/people/Mediasaur/sounds/788074/),
  [Baconation](https://freesound.org/people/Baconation/sounds/592481/).

InspectorJ's popular coin flip on Freesound is CC-BY, not CC0.

### Measurements

Ring modes (strongest spectral peaks):

| Clip                        | Modes                                     | Notes                                                  |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| Kenney clink (coin on coin) | 4.9, 8.5, 13.2, 17.5 kHz                  | Ratio 1.73 of the first two = free thin disc           |
| Kenney clinks, doublets     | 4875 / 4992 Hz, 4406 / 4500 Hz (2.1–2.4%) | The beating "shimmer" of a real coin                   |
| Wikimedia small coin        | 10.0, 10.4, 17.8 kHz                      | Close to theory for a 24 mm, 1.75 mm coin (≈ 11.7 kHz) |
| €2 coin on wood             | 0.6–2.4 kHz (table), little ring          | Bimetallic coin; the joint damps the ring              |
| OpenGameArt table drop      | 0.7–1.1 kHz and 3.1–3.8 kHz               | Mostly table knock                                     |
| Kenney light metal impacts  | 0.9 kHz plus 2.6–4.6 kHz                  | A pan or tool, not a coin                              |

Energy by band (whole clip):

| Clip                         | < 1 kHz | 1–4 kHz | 4–8 kHz | > 8 kHz |
| ---------------------------- | ------- | ------- | ------- | ------- |
| €2 coin on wood              | 13%     | 85%     | 1%      | 0%      |
| OpenGameArt table drop       | 17%     | 63%     | 19%     | 0%      |
| Kenney clinks                | 0%      | 7–43%   | 46–47%  | 10–46%  |
| First synth (hard surface)   | 0%      | 0%      | 81%     | 19%     |
| Synth on wood (chosen model) | 19%     | 72%     | 9%      | 0%      |
| Blend on wood (chosen)       | 21%     | 69%     | 9%      | 0%      |

Timing:

- The €2 coin wobbles with rim contacts about 40 ms apart (25 per second) at first.
- A wobbling coin behaves as Euler's disk: the contact rate rises roughly as (time left)^−1/3
  until it stops dead.

### Why a real coin on wood is not "metallic"

The owner noticed that every early take sounded strongly metallic while the real recordings did
not. The measurements explain it:

1. **Contact time.** Metal striking metal touches for a few microseconds, which excites every
   ring mode. Wood gives, so a coin landing on wood stays in contact far longer, and a long
   contact cannot excite vibrations faster than about 1/(contact time). The coin's 5 to 17 kHz
   ring barely starts.
2. **The table radiates.** A wooden table rings at 0.6 to 2.4 kHz over a far larger area than a
   7 g coin, and it drains the coin's ring while the coin rests on it.
3. **The Kenney clinks are coins striking coins** in a hand: no table, short contacts, bright.
   The first synth was fitted to them and inherited that.
4. **The €2 coin is bimetallic.** The joint between its two metals damps its ring further.

A consequence for size: on wood almost nothing above 8 kHz survives. So recorded coin clinks can
use the same 16 kHz MP3 as the dice clacks, and likely a lower rate.

### The synth model (Coin Flip Lab `core.js`)

- **Coin ring.** Each hit excites four modes at ratios 1, 1.73, 2.72 and 3.57 of the coin pitch,
  with levels 1, 0.55, 0.35 and 0.2. Each mode is a doublet of two damped sines split by the
  shimmer percentage.
  - Decay τ = ring length / ratio^0.8.
  - Higher modes scale as strength^(1 + 0.25k), so soft hits are duller.
  - Damped sines use the two-term resonator recursion, so there is no `sin` per sample.
- **Contact roll-off** (wood and felt): each mode's amplitude is multiplied by
  1/√(1 + (f / contact)^4).
- **Table body** (wood): seven modes at 610, 980, 1240, 1600, 1750, 2060 and 2340 Hz, with
  random levels 0.3–1 per hit, ±2% detune and τ = table ring length. Fitted to the €2 and
  OpenGameArt recordings.
- **Strike click:** white noise through an RBJ band-pass (Q 1.5) at the knock pitch, τ 2.5 ms.
- **Ring length by event:** in the air ×6, landing and bounce ×1, wobble contact ×0.45,
  lying flat ×0.12. Felt multiplies all of them by 0.35.
- **Blend:** each landing and bounce also plays one recorded clink. The clink is
  low-pass-filtered (4th-order) at the contact frequency on wood, trimmed to the clink length
  with a 3 ms fade, and played at the clink level with a ±4% pitch change.

Fitted defaults when the blend was chosen:

| Parameter          | Value   | Parameter           | Value  |
| ------------------ | ------- | ------------------- | ------ |
| Coin pitch         | 4.9 kHz | Wobble length       | 600 ms |
| Ring length        | 60 ms   | Wobble loudness     | −12 dB |
| Shimmer (split)    | 2.2%    | Wobble end rate     | 140 /s |
| Brightness         | 1       | Contact softness    | 3 kHz  |
| Table knock        | −12 dB  | Table body          | 0 dB   |
| Knock pitch        | 1.2 kHz | Table ring length   | 12 ms  |
| Blend: clink level | −4 dB   | Blend: clink length | 25 ms  |

The lab's flip timeline is a stand-in for the physics:

- a landing at strength 1;
- bounces at 0.5 and then half again each time, with gaps of 80–110 ms shrinking ×0.62;
- an Euler-disk wobble from 16 contacts per second up to the end rate, at the wobble loudness
  and fading to 40%;
- a final "flat" tap at 0.3.

In the tray, the physics supplies these events.

### Owner verdicts (2026-10-19)

- Metal tap (Kenney impacts pitched up 1.5×): no go.
- Synth, coin clinks and hybrid (clink landing, synth wobble) all work.
- Synth sounded better than hybrid.
- Blend (synth plus a short clink on each landing and bounce) sounded best, and was chosen.
- Every early take was too metallic next to the real recordings, which led to the wooden-table
  model above.
- The online recordings sound best, as expected for real audio.

### Options for a future change

- **A real spin-down recording** (Coin_Spin_Drop_01 or Spinning Coin on Freesound) would beat
  any model. Costs:
  - A few seconds of audio, so several KB even at 16 kHz MP3.
  - Its timing would not follow the physics. The tray would need to play it as one clip at
    settle, not per impact.
- **More clinks for the blend**, cut from the online drops, which are already measured.
- **Per-surface models:** the lab has hard (glass, stone) and felt variants.

### Coin sound in the tray (not shipped)

Built for 0.6.0 and removed before release. To restore it, start from these commits on
`feat/0.6.0`:

- 80d1992: the synth port, the bank of buffers, the rim contacts and the tray wiring.
- 196f17e: per-coin tap timing, the shared rim-contact cap and separate decode states.
- 0eef0f4: taps stopped when audio is suspended.
- 0e2941f and 9a44497: the `coinClinks` data, 6 clinks in a 578 B MP3.

What the tray version did:

- **Events:**
  - Coin impacts played the synth hit, plus a clink at −4 dB.
  - Each change of a coin's lowest hull vertex played a rim tick, while the coin was tilted
    more than 2° and its lowest point was within 0.02 of the floor.
  - A soft tap played at each coin's rest frame.
- **Measured in real rolls:**
  - Rim contacts were sparse: a median of 3 per coin for `1dc`, and 14 of 50 coins had none.
  - The simulated wobble is short (median 167 ms), so the lab's long Euler-disk rattle never
    happened.
- **Owner verdict in the demo:** "the sound is not great".
- **Untested guesses for a next attempt:**
  - The short, sparse physics events may matter more than the timbre.
  - The synth's level relative to the dice clacks was never tuned by ear in the tray.

## Rebuilding the coin lab

The lab embeds the recordings as WAV, so the sources are fetched, not committed:

```bash
docs/research/coin-lab/fetch-sources.sh
cd docs/research/coin-lab && node build.mjs page
```

- `node build.mjs page` writes `coin-flip-lab.html`, a self-contained page of about 1 MB.
- `node check.mjs` renders every take of every flip to WAV in Node.
- `node analysis/bands.mjs <files>` prints the energy table.
- `node analysis/peaks.mjs <files>` prints ring modes and decays.
- `node analysis/onsets.mjs <files>` finds single hits to cut.

All three need `ffmpeg` on the PATH.
