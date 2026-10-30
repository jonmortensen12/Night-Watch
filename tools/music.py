"""Render Night Watch's music from recorded instruments.

    python3 tools/samples.py      # once: the FluidR3 instrument recordings
    python3 tools/music.py [name ...]

Every piece is written out below as notes, rendered note by note from the
FluidR3 GM recordings (the same instruments Mission Control and Dry Fly use), put
through a hall reverb, and encoded into web/music/ as MP3 - MP3 because
every browser decodes it, the iPad's included, which Opus in Ogg is not.

Loops are made to loop: the reverb tail that runs past the end is folded
back onto the start, and the file carries a little of the end before bar 1
and a little of the start after the last bar, so the game can loop between
music.json's loopStart and loopEnd without a seam whatever a decoder does
with the first few milliseconds of an MP3.

Licence: FluidR3 GM by Frank Wen, CC BY 3.0. The game credits it.
"""
import json, math, os, random, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SAMPLES = os.path.join(HERE, 'samples')
OUT = os.path.join(REPO, 'web', 'music')
SR = 44100
NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

# ---------------------------------------------------------------- instruments
# sus: a held note, carried past the end of the recording by crossfading
# repeats of its steady middle. ring: how long a struck note is left to ring
# after its written length. send: how much goes to the hall.
INST = {
    'horn':     dict(gm='french_horn', gain=0.55, pan=-0.25, send=0.45, rel=0.35, sus=True),
    'trumpet':  dict(gm='trumpet', gain=0.42, pan=0.2, send=0.35, rel=0.25, sus=True),
    'brass':    dict(gm='brass_section', gain=0.38, pan=0.05, send=0.4, rel=0.3, sus=True),
    'trombone': dict(gm='trombone', gain=0.45, pan=0.25, send=0.3, rel=0.2, sus=True),
    'tuba':     dict(gm='tuba', gain=0.5, pan=0.1, send=0.2, rel=0.2, sus=True),
    'strings':  dict(gm='string_ensemble_1', gain=0.36, pan=0.0, send=0.5, rel=0.6, sus=True),
    'spicc':    dict(gm='string_ensemble_1', gain=0.34, pan=-0.1, send=0.3, rel=0.08, sus=False, ring=0.12),
    'trem':     dict(gm='tremolo_strings', gain=0.34, pan=0.1, send=0.45, rel=0.4, sus=True),
    'pizz':     dict(gm='pizzicato_strings', gain=0.55, pan=0.15, send=0.3, rel=0.2, sus=False, ring=0.6),
    'bass':     dict(gm='contrabass', gain=0.5, pan=0.0, send=0.2, rel=0.3, sus=True),
    'cello':    dict(gm='cello', gain=0.42, pan=0.15, send=0.35, rel=0.4, sus=True),
    'timp':     dict(gm='timpani', gain=0.7, pan=0.0, send=0.4, rel=0.4, sus=False, ring=1.4),
    'taiko':    dict(gm='taiko_drum', gain=0.62, pan=0.0, send=0.3, rel=0.3, sus=False, ring=0.9),
    'harp':     dict(gm='orchestral_harp', gain=0.45, pan=-0.3, send=0.5, rel=0.8, sus=False, ring=2.0),
    'celesta':  dict(gm='celesta', gain=0.32, pan=0.3, send=0.55, rel=0.8, sus=False, ring=1.4),
    'glock':    dict(gm='glockenspiel', gain=0.24, pan=0.35, send=0.55, rel=0.8, sus=False, ring=1.4),
    'flute':    dict(gm='flute', gain=0.42, pan=0.2, send=0.5, rel=0.25, sus=True),
    'choir':    dict(gm='choir_aahs', gain=0.3, pan=0.0, send=0.65, rel=0.8, sus=True),
    'piano':    dict(gm='acoustic_grand_piano', gain=0.42, pan=0.0, send=0.35, rel=0.6, sus=False, ring=2.2),
    'hit':      dict(gm='orchestra_hit', gain=0.5, pan=0.0, send=0.5, rel=0.5, sus=False, ring=1.5),
    'revcym':   dict(gm='reverse_cymbal', gain=0.35, pan=0.0, send=0.3, rel=0.0, sus=False, ring=0.0),
    # the bunker's instruments
    'organ':    dict(gm='church_organ', gain=0.26, pan=0.0, send=0.6, rel=0.7, sus=True),
    'xylo':     dict(gm='xylophone', gain=0.42, pan=0.25, send=0.35, rel=0.3, sus=False, ring=0.6),
    'harpsi':   dict(gm='harpsichord', gain=0.34, pan=-0.25, send=0.35, rel=0.4, sus=False, ring=1.0),
    'bassoon':  dict(gm='bassoon', gain=0.5, pan=-0.15, send=0.35, rel=0.25, sus=True),
    'oboe':     dict(gm='oboe', gain=0.4, pan=0.2, send=0.45, rel=0.25, sus=True),
    'bells':    dict(gm='tubular_bells', gain=0.42, pan=0.0, send=0.6, rel=1.5, sus=False, ring=3.5),
    'mbox':     dict(gm='music_box', gain=0.34, pan=0.15, send=0.55, rel=0.8, sus=False, ring=1.6),
}

_cache = {}


def midi_of(name):
    """'C#5', 'Bb3', 'G4' -> MIDI number."""
    letter, rest = name[0], name[1:]
    acc = 0
    while rest and rest[0] in '#b':
        acc += 1 if rest[0] == '#' else -1
        rest = rest[1:]
    pc = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[letter] + acc
    return 12 * (int(rest) + 1) + pc


def load(gm, m):
    key = (gm, m)
    if key in _cache:
        return _cache[key]
    path = os.path.join(SAMPLES, gm, NAMES[m % 12] + str(m // 12 - 1) + '.mp3')
    if not os.path.exists(path):
        raise SystemExit(f'missing sample {path} - run python3 tools/samples.py')
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'f32le',
                          '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    a = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    # start at the note's onset, not the mp3's leading silence
    loud = np.nonzero(np.abs(a).max(axis=1) > 0.003)[0]
    if len(loud):
        a = a[max(0, loud[0] - int(0.002 * SR)):]
    _cache[key] = a
    return a


def extend(s, n):
    """A held note longer than its recording: crossfade repeats of the middle."""
    if n <= len(s):
        return s[:n]
    a, b, xf = int(0.8 * SR), len(s) - int(0.4 * SR), int(0.15 * SR)
    if b - a < xf * 3:
        return np.concatenate([s, np.zeros((n - len(s), 2))])
    loop = s[a:b]
    out = s[:b].copy()
    fade = np.linspace(0, 1, xf)[:, None]
    while len(out) < n:
        head = out[-xf:] * (1 - fade) + loop[:xf] * fade
        out = np.concatenate([out[:-xf], head, loop[xf:]])
    return out[:n]


# ---------------------------------------------------------------- the score
CHORDS = {'': [0, 4, 7], 'm': [0, 3, 7], 'dim': [0, 3, 6], 'sus': [0, 5, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10]}


def chord(name):
    """'Am' -> (root pc, [pcs]); 'E/D' keeps E major over a D bass: (bass pc, pcs)."""
    bass = None
    if '/' in name:
        name, b = name.split('/')
        bass = midi_of(b + '0') % 12
    root = name[0]
    i = 1
    if len(name) > 1 and name[1] in '#b':
        root += name[1]
        i = 2
    r = midi_of(root + '0') % 12
    q = CHORDS[name[i:]]
    return (r if bass is None else bass), [(r + x) % 12 for x in q], r


def voice(pcs, lo, hi):
    """Every chord tone between two MIDI notes, low to high."""
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


def near(pc, lo, hi):
    """The pitch class's first note at or above lo (within hi)."""
    for m in range(lo, hi + 1):
        if m % 12 == pc:
            return m
    return lo


class Score:
    def __init__(self, bpm, bars, beats=4, seed=1):
        self.bpm, self.bars, self.beats = bpm, bars, beats
        self.notes = []          # (inst, t_sec, dur_sec, midi, vel)
        self.fx = []             # synthesised drums: (kind, t_sec, vel)
        self.rng = random.Random(seed)

    def sec(self, beat):
        return beat * 60.0 / self.bpm

    @property
    def length(self):
        return self.sec(self.bars * self.beats)

    def note(self, inst, beat, dur, pitch, vel=0.8):
        m = midi_of(pitch) if isinstance(pitch, str) else pitch
        # humanised a little: a few milliseconds and a few percent
        jit = self.rng.uniform(-0.006, 0.006) if INST[inst].get('sus') or inst not in ('taiko', 'timp') else self.rng.uniform(-0.003, 0.003)
        self.notes.append((inst, max(0, self.sec(beat) + jit), self.sec(dur), m, vel * self.rng.uniform(0.95, 1.04)))

    def line(self, inst, beat, tokens, vel=0.8, shift=0, legato=1.0):
        """'G4:1 C5:1.5 r:0.5' from a beat; returns the beat after."""
        for tok in tokens.split():
            p, d = tok.split(':')
            d = float(d)
            if p != 'r':
                self.note(inst, beat, d * legato, midi_of(p) + shift, vel)
            beat += d
        return beat

    def hold(self, inst, beat, dur, pitches, vel=0.6):
        for p in pitches:
            self.note(inst, beat, dur, p, vel)

    def drum(self, kind, beat, vel=0.8):
        self.fx.append((kind, max(0, self.sec(beat) + self.rng.uniform(-0.003, 0.003)), vel * self.rng.uniform(0.92, 1.05)))


# ---------------------------------------------------------------- synthesised drums
def snare(vel):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(int(vel * 1e6) % 9973)
    noise = rng.standard_normal(n)
    # band-limited: the top of the noise taken off, then the bottom, so it
    # reads as a drum and not as hiss
    noise = np.convolve(noise, np.ones(5) / 5, mode='same')
    noise = noise - np.convolve(noise, np.ones(24) / 24, mode='same')
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05)
    s = (noise * np.exp(-t / 0.07) * 0.9 + body * 0.5) * vel * 0.26
    return np.stack([s, s], axis=1)


def crash(vel):
    """A real cymbal: FluidR3's reverse cymbal, played forwards again."""
    s = load('reverse_cymbal', 60)[::-1].copy()
    loud = np.nonzero(np.abs(s).max(axis=1) > 0.01)[0]
    s = s[loud[0]:] if len(loud) else s
    fade = int(0.3 * SR)
    s[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return s * vel * 0.55


def crash_noise(vel):
    n = int(2.6 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(7)
    l, r = rng.standard_normal(n), rng.standard_normal(n)
    band = lambda x: (lambda y: y - np.convolve(y, np.ones(10) / 10, mode='same'))(np.convolve(x, np.ones(3) / 3, mode='same'))
    env = np.exp(-t / 0.9) * (1 - np.exp(-t / 0.004))
    return np.stack([band(l) * env, band(r) * env], axis=1) * vel * 0.2


def reverb_ir():
    n = int(2.6 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(3)
    ir = rng.standard_normal((n, 2)) * np.exp(-t / 0.6)[:, None]
    # darker as it decays: a running average whose width grows with time
    k = 12
    ir = np.stack([np.convolve(ir[:, c], np.ones(k) / k, mode='same') for c in range(2)], axis=1)
    ir[:int(0.018 * SR)] = 0
    return ir / np.sqrt((ir ** 2).sum() / 2) * 0.55


def render(score, tail=3.0, loop=True):
    L = int(round(score.length * SR))
    N = L + int(tail * SR)
    dry = np.zeros((N, 2))
    wet = np.zeros((N, 2))
    for inst, t, dur, m, vel in score.notes:
        spec = INST[inst]
        s = load(spec['gm'], m)
        if inst == 'revcym':
            # a reverse cymbal swells INTO its beat: line its end up with it
            start = int(t * SR) - len(s)
            seg = s.copy()
            if start < 0:
                seg, start = seg[-start:], 0
        else:
            keep = dur + (spec['rel'] if spec['sus'] else spec.get('ring', 0.5))
            n = int(keep * SR)
            seg = extend(s, n) if spec['sus'] else s[:n].copy()
            # release: hold to the written end, then fade
            rel_n = max(1, int((spec['rel'] if spec['sus'] else min(spec.get('ring', 0.5), 0.3)) * SR))
            fade_from = max(0, len(seg) - rel_n)
            env = np.ones(len(seg))
            env[fade_from:] = np.cos(np.linspace(0, np.pi / 2, len(seg) - fade_from)) ** 2
            seg = seg * env[:, None]
            start = int(t * SR)
        g = spec['gain'] * (vel ** 1.5)
        p = (spec['pan'] + 1) * np.pi / 4
        seg = seg * np.array([math.cos(p), math.sin(p)]) * g * 1.41
        end = min(N, start + len(seg))
        if end <= start:
            continue
        dry[start:end] += seg[:end - start]
        wet[start:end] += seg[:end - start] * spec['send']
    for kind, t, vel in score.fx:
        s = snare(vel) if kind == 'snare' else crash(vel)
        start = int(t * SR)
        end = min(N, start + len(s))
        dry[start:end] += s[:end - start]
        wet[start:end] += s[:end - start] * 0.35
    ir = reverb_ir()
    size = 1 << int(np.ceil(np.log2(N + len(ir))))
    rev = np.stack([np.fft.irfft(np.fft.rfft(wet[:, c], size) * np.fft.rfft(ir[:, c], size), size)[:N] for c in range(2)], axis=1)
    mix = dry + rev
    if loop:
        # the tail past the last bar belongs at the start of the next time round
        mix[:N - L] += mix[L:]
        mix = mix[:L]
    else:
        loud = np.nonzero(np.abs(mix).max(axis=1) > 0.0008)[0]
        mix = mix[:(loud[-1] + int(0.05 * SR)) if len(loud) else N]
        fade = min(len(mix), int(0.05 * SR))
        mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return mix


def master(mix, rms_target=0.11, peak=0.8):
    rms = np.sqrt((mix ** 2).mean()) + 1e-9
    mix = mix * (rms_target / rms)
    # a gentle limiter rather than a clip
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)
    mx = np.abs(mix).max()
    if mx > peak:
        mix *= peak / mx
    return mix


def encode(mix, path):
    data = mix.astype(np.float32).tobytes()
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2',
                    '-i', '-', '-c:a', 'libmp3lame', '-b:a', '128k', path], input=data, check=True)


# ================================================================ the pieces
def ostinato(sc, inst, bar, name, pattern, lo, hi, vel, step=0.5, dur=0.45):
    """An arpeggiated figure over a bar: pattern indexes the chord's tones
    from the lowest in range (0, 1, 2...), -1 being the bass note."""
    bass, pcs, root = chord(name)
    tones = voice(pcs, lo, hi)
    # start the figure on the root
    while tones and tones[0] % 12 != root:
        tones = tones[1:]
    for i, k in enumerate(pattern):
        b = bar * sc.beats + i * step
        if b >= (bar + 1) * sc.beats:
            break
        m = near(bass, lo - 12, hi) if k == -1 else tones[min(k, len(tones) - 1)]
        sc.note(inst, b, dur, m, vel)


def pad(sc, inst, bar, name, lo, hi, vel, beats=None):
    _, pcs, _ = chord(name)
    sc.hold(inst, bar * sc.beats, beats or sc.beats, voice(pcs, lo, hi), vel)


def bassline(sc, inst, bar, name, octave_lo, vel, beats=None):
    bass, _, _ = chord(name)
    sc.note(inst, bar * sc.beats, beats or sc.beats, near(bass, octave_lo, octave_lo + 11), vel)


def roll(sc, inst, beat, beats, pitch, v0, v1, step=0.125):
    n = int(beats / step)
    for i in range(n):
        sc.note(inst, beat + i * step, step, pitch, v0 + (v1 - v0) * i / max(1, n - 1))


def snare_roll(sc, beat, beats, v0, v1, step=0.125):
    n = int(beats / step)
    for i in range(n):
        sc.drum('snare', beat + i * step, v0 + (v1 - v0) * i / max(1, n - 1))




# ================================================================ the pieces
def nightwatch():
    """The main theme: a night sky with something moving in it. Strings
    ticking over, a horn tune, celesta stars, taiko when it gets going.
    D minor, 116 bpm."""
    sc = Score(116, 32, seed=11)
    prog = (['Dm', 'Bb', 'F', 'C'] +
            ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'] +
            ['Bb', 'F', 'C', 'Dm', 'Bb', 'F', 'Gm', 'A'] +
            ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'] +
            ['Dm', 'Bb', 'Gm', 'A'])
    for bar, ch in enumerate(prog):
        sect = 'intro' if bar < 4 else 'A' if bar < 12 else 'B' if bar < 20 else "A'" if bar < 28 else 'turn'
        bass, pcs, root = chord(ch)
        v = {'intro': 0.5, 'A': 0.58, 'B': 0.64, "A'": 0.68, 'turn': 0.6}[sect]
        ostinato(sc, 'spicc', bar, ch, [0, 2, 1, 2, 0, 2, 1, 2], 50, 69, v)
        sc.note('bass', bar * 4, 4, near(bass, 26, 37), 0.45)
        sc.note('cello', bar * 4, 2, near(bass, 38, 49), 0.4)
        if bar % 2 == 1:
            # stars
            tones = voice(pcs, 79, 98)
            for k, m in enumerate(tones[:4]):
                sc.note('celesta', bar * 4 + 2.5 + k * 0.25, 0.6, m, 0.36)
        if sect != 'intro':
            for b, tv in ((0, 0.8), (1.5, 0.45), (2, 0.7), (3.5, 0.5)):
                sc.note('taiko', bar * 4 + b, 0.5, 'C3' if b in (0, 2) else 'G3', tv)
            sc.note('timp', bar * 4, 1, near(bass, 41, 53), 0.5)
        if sect in ('B', "A'"):
            pad(sc, 'strings', bar, ch, 57, 72, 0.36)
            sc.drum('snare', bar * 4 + 1, 0.5)
            sc.drum('snare', bar * 4 + 3, 0.55)
        if sect == 'B':
            pad(sc, 'choir', bar, ch, 55, 67, 0.36)
        if sect == 'turn':
            pad(sc, 'trem', bar, ch, 50, 65, 0.42)
    melA = ['D4:1.5 A3:0.5 D4:1 F4:1', 'F4:1.5 E4:0.5 D4:2', 'C4:1 F4:1 A4:1.5 G4:0.5', 'G4:3 E4:1',
            'A4:1.5 F4:0.5 D4:1 A4:1', 'Bb4:2 A4:1 G4:1', 'G4:1 Bb4:1 D5:1.5 C5:0.5', 'C#5:3 A4:1']
    melB = ['D5:2 F5:2', 'C5:1.5 A4:0.5 F4:2', 'E5:1 G5:1 E5:1 C5:1', 'D5:3 A4:1',
            'F5:2 D5:1 Bb4:1', 'A4:1 C5:1 F5:2', 'G5:1.5 F5:0.5 D5:1 Bb4:1', 'A4:2 C#5:2']
    for i, ln in enumerate(melA):
        sc.line('horn', (4 + i) * 4, ln, 0.78)
        sc.line('trumpet', (20 + i) * 4, ln, 0.74, shift=12)
        sc.line('horn', (20 + i) * 4, ln, 0.66)
    for i, ln in enumerate(melB):
        sc.line('trumpet', (12 + i) * 4, ln, 0.72)
        sc.line('strings', (12 + i) * 4, ln, 0.34, shift=-12)
    for bar in (4, 12, 20):
        sc.note('revcym', bar * 4, 0.1, 'C4', 0.55)
        sc.drum('crash', bar * 4, 0.75)
    roll(sc, 'timp', 30 * 4, 8, 'A2', 0.2, 0.75)
    snare_roll(sc, 31 * 4, 4, 0.15, 0.7)
    return sc


def constellation():
    """Wonder with a pulse: harp and celesta turning over, a flute up high,
    pizzicato and timpani underneath so it still moves. E Lydian, 100 bpm."""
    sc = Score(100, 24, seed=21)
    prog = ['E', 'F#/E', 'C#m', 'A', 'E', 'F#/E', 'A', 'B',
            'C#m', 'A', 'E', 'B', 'C#m', 'A', 'F#m', 'B',
            'E', 'F#/E', 'A', 'B', 'E', 'F#/E', 'Am', 'B']
    for bar, ch in enumerate(prog):
        bass, pcs, root = chord(ch)
        ostinato(sc, 'celesta', bar, ch, [0, 1, 2, 3, 4, 3, 2, 1], 71, 92, 0.38, dur=0.5)
        ostinato(sc, 'harp', bar, ch, [-1, 0, 1, 2, 3, 2, 1, 0], 48, 68, 0.46, step=0.5, dur=0.9)
        for k in range(8):
            sc.note('pizz', bar * 4 + k * 0.5, 0.5, near(bass, 40, 51) + (12 if k % 4 == 2 else 0), 0.5 if k % 2 == 0 else 0.38)
        sc.note('bass', bar * 4, 4, near(bass, 28, 39), 0.4)
        sc.note('timp', bar * 4, 1, near(bass, 40, 52), 0.42)
        sc.note('timp', bar * 4 + 2, 1, near(bass, 40, 52), 0.3)
        if bar >= 4:
            pad(sc, 'strings', bar, ch, 56, 71, 0.33)
        if 8 <= bar < 16:
            pad(sc, 'choir', bar, ch, 56, 68, 0.34)
            for b in (0, 1.5, 2, 3):
                sc.note('taiko', bar * 4 + b, 0.5, 'G3', 0.4 if b else 0.55)
        if bar >= 16:
            for b in (0, 1.5, 2, 3, 3.5):
                sc.note('taiko', bar * 4 + b, 0.5, 'C3' if b in (0, 2) else 'G3', 0.6 if b in (0, 2) else 0.4)
    flute = ['B5:2 G#5:1 B5:1', 'A#5:1.5 G#5:0.5 F#5:2', 'G#5:1 E5:1 C#5:2', 'E5:3 F#5:1',
             'B5:2 C#6:1 D#6:1', 'E6:1.5 D#6:0.5 C#6:2', 'C#6:1 B5:1 A5:1 G#5:1', 'F#5:4',
             'E6:2 D#6:1 C#6:1', 'C#6:1.5 B5:0.5 A5:2', 'B5:2 G#5:1 E5:1', 'F#5:3 D#5:1',
             'E5:1 G#5:1 C#6:2', 'B5:1 A5:1 E5:2', 'F#5:1 A5:1 C#6:1 F#6:1', 'D#6:4']
    for i, ln in enumerate(flute):
        sc.line('flute', i * 4, ln, 0.72)
        if i >= 8:
            sc.line('strings', i * 4, ln, 0.32, shift=-12)
    for i, ln in enumerate(['G#4:4', 'A#4:4', 'C#5:4', 'B4:2 D#5:2', 'E5:4', 'C#5:4', 'C5:4', 'B4:2 D#5:2']):
        sc.line('horn', (16 + i) * 4, ln, 0.62)
        sc.line('trumpet', (16 + i) * 4, ln, 0.5, shift=12)
    for bar in (7, 15, 23):
        for k, p in enumerate(['B6', 'D#7', 'F#7', 'B7']):
            sc.note('glock', bar * 4 + 2 + k * 0.5, 0.5, p, 0.35)
    for bar in (8, 16):
        roll(sc, 'timp', bar * 4 - 2, 2, 'B2', 0.15, 0.5)
        sc.note('revcym', bar * 4, 0.1, 'C4', 0.5)
        sc.drum('crash', bar * 4, 0.7)
    return sc


def redshift():
    """Everything at once: taiko, a low brass riff, tremolo strings,
    trumpets. C minor, 138 bpm."""
    sc = Score(138, 32, seed=31)
    A = ['Cm', 'Cm', 'Ab', 'Bb', 'Cm', 'Cm', 'Ab', 'G']
    B = ['Fm', 'Ab', 'Eb', 'Bb', 'Fm', 'Ab', 'G', 'G']
    prog = ['Cm', 'Cm', 'Ab', 'G'] + A + B + A + ['Ab', 'Bb', 'G', 'G']
    for bar, ch in enumerate(prog):
        sect = 'intro' if bar < 4 else 'A' if bar < 12 else 'B' if bar < 20 else "A'" if bar < 28 else 'turn'
        bass, pcs, root = chord(ch)
        r = near(root, 36, 47)
        for k, off in enumerate([0, 0, 3, 0, 5, 3, 0, -2]):
            sc.note('trombone', bar * 4 + k * 0.5, 0.42, r + off, 0.6 if k % 2 == 0 else 0.5)
            sc.note('tuba', bar * 4 + k * 0.5, 0.42, r + off - 12, 0.5)
        for k in range(8):
            sc.note('taiko', bar * 4 + k * 0.5, 0.5, 'C3' if k in (0, 3, 6) else 'G3', 0.85 if k in (0, 3, 6) else 0.4)
        sc.note('timp', bar * 4, 1, near(bass, 41, 53), 0.6)
        pad(sc, 'trem', bar, ch, 55, 70, 0.4 if sect != 'intro' else 0.3)
        sc.note('bass', bar * 4, 4, near(bass, 24, 35), 0.5)
        if sect != 'intro':
            sc.drum('snare', bar * 4 + 1, 0.55)
            sc.drum('snare', bar * 4 + 3, 0.6)
        if sect == 'B':
            pad(sc, 'choir', bar, ch, 55, 67, 0.42)
        if sect in ("A'", 'turn'):
            for b in (0, 2.5):
                sc.hold('horn', bar * 4 + b, 0.7, voice(pcs, 53, 65), 0.55)
    melA = ['C5:1 Eb5:1 G5:2', 'F5:1.5 Eb5:0.5 D5:2', 'Eb5:1 C5:1 Ab4:2', 'Bb4:3 D5:1',
            'C5:1 Eb5:1 G5:1 C6:1', 'Bb5:1.5 Ab5:0.5 G5:2', 'Ab5:1 G5:1 F5:1 Eb5:1', 'D5:2 B4:2']
    melB = ['F5:2 Ab5:2', 'C6:2 Ab5:2', 'G5:1.5 F5:0.5 Eb5:2', 'D5:2 F5:2',
            'Ab5:1 G5:1 F5:1 C5:1', 'Eb5:2 C5:2', 'D5:1 Eb5:1 F5:1 G5:1', 'B4:2 D5:2']
    for i, ln in enumerate(melA):
        sc.line('trumpet', (4 + i) * 4, ln, 0.78)
        sc.line('trumpet', (20 + i) * 4, ln, 0.82)
        sc.line('horn', (20 + i) * 4, ln, 0.62, shift=-12)
    for i, ln in enumerate(melB):
        sc.line('horn', (12 + i) * 4, ln, 0.8, shift=-12)
        sc.line('strings', (12 + i) * 4, ln, 0.4)
    for bar in (4, 12, 20):
        sc.note('revcym', bar * 4, 0.1, 'C4', 0.6)
        sc.drum('crash', bar * 4, 0.85)
        sc.note('hit', bar * 4, 0.5, 'C4', 0.55)
    snare_roll(sc, 30 * 4, 8, 0.15, 0.8)
    roll(sc, 'timp', 31 * 4, 4, 'G2', 0.35, 0.85)
    return sc


def boss():
    """The dreadnought: grinding low brass in a limping rhythm, a choir,
    taiko, and the trumpets once it is in range. F# minor, 140 bpm."""
    sc = Score(140, 24, seed=41)
    prog = ['F#m', 'F#m', 'D', 'C#', 'F#m', 'F#m', 'G', 'C#',
            'Bm', 'F#m', 'D', 'C#', 'Bm', 'F#m', 'G', 'C#',
            'F#m', 'D', 'Bm', 'C#', 'F#m', 'D', 'G', 'C#']
    for bar, ch in enumerate(prog):
        bass, pcs, root = chord(ch)
        r = near(root, 34, 45)
        for b, d in ((0, 0.6), (0.75, 0.6), (1.5, 0.9), (2.5, 1.4)):
            sc.note('trombone', bar * 4 + b, d, r + 12, 0.66)
            sc.note('tuba', bar * 4 + b, d, r, 0.6)
        for k in range(8):
            sc.note('taiko', bar * 4 + k * 0.5, 0.5, 'C3' if k in (0, 3, 5) else 'G3', 0.9 if k in (0, 3, 5) else 0.42)
        sc.note('timp', bar * 4, 1, near(bass, 40, 52), 0.65)
        sc.note('timp', bar * 4 + 1.5, 1, near(bass, 40, 52), 0.5)
        pad(sc, 'choir', bar, ch, 50, 64, 0.42)
        pad(sc, 'trem', bar, ch, 57, 72, 0.4)
        if bar % 4 == 3:
            sc.note('hit', bar * 4 + 3, 0.5, near(root, 60, 71), 0.55)
        if bar >= 8:
            sc.drum('snare', bar * 4 + 1, 0.55)
            sc.drum('snare', bar * 4 + 3, 0.6)
            for b in (0, 2.5):
                sc.hold('horn', bar * 4 + b, 0.6, voice(pcs, 53, 65), 0.58)
    mel = ['F#5:2 G5:1 F#5:1', 'E5:1 C#5:1 A4:2', 'B4:1 D5:1 F#5:2', 'E#5:4',
           'A5:1.5 G#5:0.5 F#5:2', 'G5:2 F#5:1 E5:1', 'D5:1 F#5:1 B5:2', 'C#6:4']
    for i, ln in enumerate(mel):
        sc.line('trumpet', (8 + i) * 4, ln, 0.8)
        sc.line('trumpet', (16 + i) * 4, ln, 0.84)
        sc.line('horn', (16 + i) * 4, ln, 0.6, shift=-12)
    for bar in (8, 16):
        sc.drum('crash', bar * 4, 0.9)
        sc.note('revcym', bar * 4, 0.1, 'C4', 0.6)
    snare_roll(sc, 23 * 4, 4, 0.2, 0.8)
    return sc


def lobby():
    """Waiting for everybody: piano under a starry sky, celesta, harp,
    strings, a flute joining. A minor, 72 bpm."""
    sc = Score(72, 16, seed=51)
    prog = ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E',
            'F', 'G', 'Em', 'Am', 'F', 'G', 'Esus', 'E']
    for bar, ch in enumerate(prog):
        bass, pcs, root = chord(ch)
        sc.note('piano', bar * 4, 2, near(bass, 40, 51), 0.48)
        ostinato(sc, 'piano', bar, ch, [0, 1, 2, 1, 3, 2, 1, 2], 52, 70, 0.32, step=0.5, dur=0.7)
        pad(sc, 'strings', bar, ch, 55, 69, 0.26)
        sc.note('bass', bar * 4, 4, near(bass, 28, 39), 0.28)
        if bar % 2 == 1:
            for k, m in enumerate(voice(pcs, 81, 100)[:4]):
                sc.note('celesta', bar * 4 + 2 + k * 0.5, 0.8, m, 0.3)
    mel = ['E5:2 C5:1 B4:1', 'A4:2 C5:2', 'G5:1.5 F5:0.5 E5:2', 'D5:3 r:1',
           'E5:2 A5:2', 'A5:1 G5:1 F5:2', 'F5:1.5 E5:0.5 D5:2', 'B4:3 r:1',
           'C5:1 D5:1 E5:2', 'F5:1 E5:1 D5:2', 'G5:2 E5:2', 'C5:3 r:1',
           'A5:2 F5:2', 'G5:1 F5:1 E5:1 D5:1', 'B4:2 E5:2', 'G#4:4']
    for i, ln in enumerate(mel):
        sc.line('piano', i * 4, ln, 0.5, shift=12)
        if i >= 8:
            sc.line('flute', i * 4, ln, 0.42)
    for bar in (3, 7, 11, 15):
        for k, p in enumerate(['E5', 'A5', 'C6', 'E6']):
            sc.note('harp', bar * 4 + 3 + k * 0.25, 0.5, p, 0.32)
    return sc


# ---------------------------------------------------------------- the bunker
def waltz(sc, bar, ch, inst_bass, inst_chord, lo, hi, vb, vc):
    """Oom-pah-pah: the bass on one, the chord on two and three."""
    bass, pcs, root = chord(ch)
    sc.note(inst_bass, bar * 3, 1, near(bass, 38, 49), vb)
    for b in (1, 2):
        sc.hold(inst_chord, bar * 3 + b, 0.9, voice(pcs, lo, hi), vc)


def danse():
    """Danse of the Dead: a skeletons' waltz. Xylophone tune over
    pizzicato and harpsichord, a bassoon in the middle, the organ and the
    brass for the last time round. D minor, 3/4, 168 bpm."""
    sc = Score(168, 52, beats=3, seed=61)
    A = ['Dm', 'E', 'A7', 'A', 'Dm', 'Gm', 'Dm', 'A', 'Dm', 'Bb', 'Gm', 'Gm', 'Dm', 'A', 'Dm', 'Dm']
    B = ['F', 'C', 'Dm', 'A', 'Bb', 'F', 'Gm', 'A', 'F', 'C', 'Dm', 'A', 'Bb', 'Gm', 'A', 'Dm']
    prog = ['Dm', 'Dm', 'A', 'A'] + A + B + A
    for bar, ch in enumerate(prog):
        sect = 'intro' if bar < 4 else 'A' if bar < 20 else 'B' if bar < 36 else "A'"
        bass, pcs, root = chord(ch)
        waltz(sc, bar, ch, 'pizz', 'pizz', 55, 67, 0.62, 0.42)
        if sect != 'intro':
            for b in (1, 2):
                sc.hold('harpsi', bar * 3 + b, 0.8, voice(pcs, 62, 74), 0.36)
        sc.note('bass', bar * 3, 3, near(bass, 26, 37), 0.42)
        if bar % 2 == 0:
            sc.note('timp', bar * 3, 1, near(bass, 40, 52), 0.42 if sect != "A'" else 0.6)
        if sect in ('B', "A'"):
            sc.hold('organ', bar * 3, 3, voice(pcs, 50, 64), 0.3 if sect == 'B' else 0.36)
        if sect == "A'":
            sc.hold('brass', bar * 3, 0.8, voice(pcs, 55, 67), 0.5)
            sc.drum('snare', bar * 3 + 1, 0.4)
            sc.drum('snare', bar * 3 + 2, 0.4)
    melA = ['D5:1 F5:1 A5:1', 'G#5:2 A5:1', 'E5:1 G5:1 A5:1', 'C#5:3',
            'D5:1 F5:1 A5:1', 'Bb5:1 A5:1 G5:1', 'F5:1 E5:1 D5:1', 'E5:3',
            'D5:1 F5:1 A5:1', 'D6:2 C6:1', 'Bb5:1 A5:1 G5:1', 'G5:2 Bb5:1',
            'A5:1 F5:1 D5:1', 'E5:1 C#5:1 A4:1', 'D5:1 E5:1 F5:1', 'D5:3']
    melB = ['A3:2 C4:1', 'G3:2 E3:1', 'F3:1 A3:1 D4:1', 'C#4:3', 'D4:2 F4:1', 'C4:2 A3:1', 'Bb3:1 D4:1 G4:1', 'E4:3',
            'F4:2 A4:1', 'G4:2 E4:1', 'F4:1 E4:1 D4:1', 'E4:2 A3:1', 'D4:1 F4:1 Bb4:1', 'A4:1 G4:1 Bb4:1', 'A4:2 E4:1', 'D4:3']
    for i, ln in enumerate(melA):
        sc.line('xylo', (4 + i) * 3, ln, 0.82)
        sc.line('xylo', (36 + i) * 3, ln, 0.86)
        sc.line('trumpet', (36 + i) * 3, ln, 0.6, legato=0.8)
        sc.line('strings', (36 + i) * 3, ln, 0.34, shift=-12)
    for i, ln in enumerate(melB):
        sc.line('bassoon', (20 + i) * 3, ln, 0.78)
        sc.line('cello', (20 + i) * 3, ln, 0.4)
        if i >= 8:
            sc.line('oboe', (20 + i) * 3, ln, 0.5, shift=12)
    for bar in (4, 20, 36):
        sc.drum('crash', bar * 3, 0.6)
        sc.note('bells', bar * 3, 2, 'D4', 0.5)
    roll(sc, 'timp', 51 * 3, 3, 'A2', 0.3, 0.75)
    return sc


def hollow():
    """Hollow Hill: a music box going round in the dark, a heartbeat on
    the taiko, an organ and a choir, bells tolling, an oboe. E minor, 92 bpm."""
    sc = Score(92, 24, seed=71)
    prog = ['Em', 'C', 'Am', 'B', 'Em', 'C', 'Am', 'B',
            'C', 'G', 'Am', 'Em', 'C', 'Am', 'B', 'B',
            'Em', 'C', 'Am', 'B', 'Em', 'C', 'B', 'Em']
    for bar, ch in enumerate(prog):
        bass, pcs, root = chord(ch)
        ostinato(sc, 'mbox', bar, ch, [0, 2, 1, 2, 0, 2, 1, 3], 76, 96, 0.4)
        beat = 0.5 + 0.03 * bar
        sc.note('taiko', bar * 4, 0.5, 'C3', min(0.85, beat + 0.1))
        sc.note('taiko', bar * 4 + 0.5, 0.5, 'G3', min(0.7, beat - 0.1))
        sc.note('taiko', bar * 4 + 2, 0.5, 'C3', min(0.8, beat))
        sc.note('taiko', bar * 4 + 2.5, 0.5, 'G3', min(0.65, beat - 0.15))
        sc.note('bass', bar * 4, 4, near(bass, 28, 39), 0.4)
        if bar >= 4:
            sc.hold('organ', bar * 4, 4, voice(pcs, 52, 66), 0.3)
        if bar >= 8:
            for k in range(8):
                sc.note('pizz', bar * 4 + k * 0.5, 0.5, near(bass, 40, 51) + (12 if k % 4 == 3 else 0), 0.5 if k % 2 == 0 else 0.36)
            sc.note('timp', bar * 4, 1, near(bass, 40, 52), 0.45)
        if 8 <= bar < 16:
            sc.hold('choir', bar * 4, 4, voice(pcs, 55, 67), 0.36)
        if bar >= 16:
            pad(sc, 'trem', bar, ch, 55, 70, 0.36)
            sc.drum('snare', bar * 4 + 1, 0.35)
            sc.drum('snare', bar * 4 + 3, 0.4)
    mel = ['B4:2 G4:1 E4:1', 'E4:2 G4:2', 'C5:1.5 B4:0.5 A4:2', 'F#4:4',
           'B4:2 C5:1 B4:1', 'G4:2 E4:2', 'A4:1 C5:1 E5:2', 'D#5:4']
    for i, ln in enumerate(mel):
        sc.line('oboe', (4 + i) * 4, ln, 0.74)
        sc.line('horn', (16 + i) * 4, ln, 0.66, shift=12)
        sc.line('strings', (16 + i) * 4, ln, 0.36)
    for bar in (0, 8, 16):
        sc.note('bells', bar * 4, 3, 'E3', 0.6)
        sc.note('bells', bar * 4 + 2, 2, 'B3', 0.42)
    snare_roll(sc, 23 * 4, 4, 0.15, 0.6)
    return sc


def witchboss():
    """Broomstick: the witch's theme. Strings running in threes, brass
    stabs, the organ, xylophone cackling on top. G minor, 3/4, 180 bpm."""
    sc = Score(180, 36, beats=3, seed=81)
    P = ['Gm', 'Gm', 'D', 'D', 'Gm', 'Gm', 'Cm', 'D', 'Eb', 'Eb', 'Cm', 'Cm', 'Gm', 'D', 'Gm', 'D']
    prog = P + P + ['Eb', 'Cm', 'D', 'D']
    for bar, ch in enumerate(prog):
        bass, pcs, root = chord(ch)
        ostinato(sc, 'spicc', bar, ch, [0, 1, 2], 55, 74, 0.6, step=1, dur=0.9)
        sc.note('bass', bar * 3, 3, near(bass, 26, 37), 0.5)
        sc.note('tuba', bar * 3, 1, near(bass, 26, 37), 0.55)
        sc.hold('brass', bar * 3 + 1, 0.5, voice(pcs, 55, 67), 0.5)
        sc.hold('brass', bar * 3 + 2, 0.5, voice(pcs, 55, 67), 0.45)
        sc.note('taiko', bar * 3, 0.5, 'C3', 0.8)
        sc.note('taiko', bar * 3 + 2, 0.5, 'G3', 0.5)
        if bar % 2 == 0:
            sc.note('timp', bar * 3, 1, near(bass, 40, 52), 0.6)
        if bar >= 16:
            sc.hold('organ', bar * 3, 3, voice(pcs, 52, 66), 0.32)
            sc.drum('snare', bar * 3 + 1, 0.45)
    mel = ['D5:1 G5:1 Bb5:1', 'A5:2 G5:1', 'F#5:1 A5:1 D6:1', 'C6:2 A5:1', 'Bb5:1 A5:1 G5:1', 'D5:2 G5:1', 'Eb5:1 G5:1 C6:1', 'A5:3',
           'Bb5:1 C6:1 D6:1', 'Eb6:2 D6:1', 'C6:1 Bb5:1 A5:1', 'G5:2 Eb5:1', 'D5:1 G5:1 Bb5:1', 'A5:1 F#5:1 D5:1', 'G5:1 D5:1 Bb4:1', 'A4:3']
    for i, ln in enumerate(mel):
        sc.line('xylo', i * 3, ln, 0.75)
        sc.line('trumpet', (16 + i) * 3, ln, 0.78, legato=0.85)
        sc.line('xylo', (16 + i) * 3, ln, 0.6, shift=12)
    for bar in (0, 16, 32):
        sc.drum('crash', bar * 3, 0.8)
        sc.note('hit', bar * 3, 0.5, 'G3', 0.55)
    snare_roll(sc, 34 * 3, 6, 0.2, 0.8)
    return sc


def zlobby():
    """Waiting in the bunker: a music box, celesta, a soft organ and a far
    bell. A minor, 66 bpm."""
    sc = Score(66, 12, seed=91)
    prog = ['Am', 'F', 'Dm', 'E', 'Am', 'F', 'Dm', 'E', 'F', 'G', 'Am', 'E']
    for bar, ch in enumerate(prog):
        bass, pcs, root = chord(ch)
        sc.hold('organ', bar * 4, 4, voice(pcs, 48, 62), 0.22)
        sc.note('bass', bar * 4, 4, near(bass, 28, 39), 0.28)
        ostinato(sc, 'harp', bar, ch, [-1, 0, 1, 2], 45, 64, 0.32, step=1, dur=1)
    mel = ['E5:1 A5:1 C6:1 B5:1', 'A5:2 F5:2', 'D5:1 F5:1 A5:1 G#5:1', 'B5:4',
           'E6:1 C6:1 A5:1 E5:1', 'F5:2 A5:2', 'D6:1 C6:1 B5:1 A5:1', 'G#5:4',
           'A5:1 C6:1 F6:2', 'D6:1 B5:1 G5:2', 'E5:1 A5:1 C6:1 E6:1', 'B5:4']
    for i, ln in enumerate(mel):
        sc.line('mbox', i * 4, ln, 0.6)
        if i >= 4:
            sc.line('celesta', i * 4, ln, 0.32, shift=12)
    for bar in (0, 6):
        sc.note('bells', bar * 4, 3, 'A3', 0.35)
    return sc


def c_zwave(sc):
    sc.note('bells', 0, 3, 'D3', 0.85)
    sc.note('bells', 1.5, 3, 'A3', 0.6)
    sc.hold('organ', 0, 4, ['D3', 'A3', 'D4', 'F4'], 0.55)
    sc.note('trombone', 0.5, 3, 'D3', 0.7)
    sc.note('tuba', 0.5, 3, 'D2', 0.7)
    sc.note('timp', 0.5, 1, 'D3', 0.9)
    sc.note('xylo', 2, 0.3, 'A5', 0.6); sc.note('xylo', 2.33, 0.3, 'G#5', 0.6); sc.note('xylo', 2.66, 0.3, 'A5', 0.7)


def c_zclear(sc):
    for i, p in enumerate(['D5', 'F#5', 'A5', 'D6', 'F#6']):
        sc.note('mbox', i * 0.25, 1, p, 0.6)
    sc.hold('organ', 0.5, 3, ['D3', 'A3', 'D4', 'F#4'], 0.4)
    sc.hold('choir', 1, 3, ['D4', 'F#4', 'A4'], 0.4)
    sc.note('harp', 1.25, 1, 'D6', 0.4)


def c_witchwarn(sc):
    for i, p in enumerate(['G6', 'F#6', 'Eb6', 'D6', 'C#6', 'Bb5', 'A5', 'G5']):
        sc.note('xylo', i * 0.12, 0.3, p, 0.75)
    sc.hold('trem', 0, 4, ['G3', 'C#4', 'G4'], 0.55)
    sc.note('bells', 1, 3, 'G3', 0.75)
    sc.hold('organ', 1, 3, ['G2', 'D3', 'G3', 'Bb3', 'C#4'], 0.45)
    sc.note('hit', 3.5, 0.5, 'G3', 0.7)
    sc.note('timp', 3.5, 1, 'G2', 0.9)
    sc.drum('crash', 3.5, 0.8)


def c_zover(sc):
    sc.hold('organ', 0, 4, ['A2', 'E3', 'A3', 'C4', 'E4'], 0.5)
    sc.hold('organ', 4, 4, ['D3', 'F3', 'A3', 'D4'], 0.45)
    sc.note('bells', 0, 3, 'A3', 0.7)
    sc.note('bells', 2.5, 3, 'A3', 0.55)
    sc.note('bells', 5, 3, 'A2', 0.6)
    sc.line('bassoon', 0, 'E3:1 D3:1 C3:1 B2:1 A2:4', 0.6)


# ---------------------------------------------------------------- short cues
def cue(bpm, bars, fn, seed=7):
    sc = Score(bpm, bars, seed=seed)
    fn(sc)
    return sc


def c_count(sc):
    sc.note('timp', 0, 1, 'D3', 0.85)
    sc.note('taiko', 0, 1, 'C3', 0.6)


def c_wave(sc):
    sc.line('horn', 0, 'D4:0.5 A4:0.5 D5:2.5', 0.85)
    sc.line('trumpet', 0.5, 'A4:0.5 D5:2.5', 0.75)
    sc.hold('strings', 1, 3, ['D3', 'A3', 'D4', 'F4'], 0.5)
    sc.note('timp', 1, 1, 'D3', 0.9)
    sc.note('taiko', 1, 1, 'C3', 0.85)
    sc.note('hit', 1, 0.5, 'D4', 0.6)
    sc.drum('crash', 1, 0.8)


def c_clear(sc):
    for i, p in enumerate(['F4', 'A4', 'C5', 'F5']):
        sc.note('trumpet', i * 0.25, 2.5 - i * 0.25, p, 0.72)
    sc.hold('horn', 0, 3, ['F3', 'C4', 'A4'], 0.6)
    sc.hold('choir', 0.5, 3, ['F4', 'A4', 'C5'], 0.45)
    for i, p in enumerate(['C6', 'F6', 'A6', 'C7']):
        sc.note('celesta', 1 + i * 0.25, 0.6, p, 0.45)
    sc.note('timp', 0, 1, 'F2', 0.7)


def c_bosswarn(sc):
    sc.note('tuba', 0, 3.5, 'F#1', 0.85)
    sc.note('trombone', 0, 3.5, 'F#2', 0.75)
    sc.note('trombone', 0.5, 3, 'C3', 0.7)
    sc.hold('trem', 0, 4, ['F#3', 'C4', 'F#4'], 0.55)
    sc.hold('choir', 1, 3, ['F#3', 'A3', 'C4'], 0.5)
    roll(sc, 'taiko', 0, 3, 'G3', 0.3, 0.9, step=0.25)
    sc.note('hit', 3.5, 0.5, 'F#3', 0.75)
    sc.note('timp', 3.5, 1, 'F#2', 0.95)
    sc.drum('crash', 3.5, 0.9)


def c_victory(sc):
    sc.line('trumpet', 0, 'D5:0.33 D5:0.33 D5:0.33 F#5:1 A5:1 D6:3', 0.86)
    sc.hold('horn', 1, 4, ['D4', 'F#4', 'A4'], 0.62)
    sc.hold('choir', 2, 4, ['D4', 'F#4', 'A4', 'D5'], 0.5)
    sc.hold('strings', 2, 4, ['D3', 'A3', 'F#4', 'D5'], 0.45)
    sc.note('hit', 2, 0.5, 'D4', 0.75)
    sc.note('timp', 2, 1, 'D3', 0.9)
    sc.drum('crash', 2, 1.0)
    sc.note('bass', 2, 4, 'D2', 0.6)


def c_gameover(sc):
    sc.line('horn', 0, 'A4:1 G4:1 F4:1 E4:1 D4:4', 0.62)
    sc.hold('strings', 0, 4, ['D3', 'F3', 'A3'], 0.45)
    sc.hold('strings', 4, 4, ['Bb2', 'D3', 'F3', 'A3'], 0.42)
    sc.note('cello', 0, 8, 'D2', 0.5)
    sc.note('timp', 0, 1, 'D2', 0.5)
    sc.note('timp', 4, 1, 'Bb1', 0.4)
    for i, p in enumerate(['A6', 'F6', 'D6']):
        sc.note('celesta', 5 + i * 0.5, 0.8, p, 0.3)


def c_record(sc):
    for i, p in enumerate(['D6', 'F#6', 'A6', 'D7', 'F#7', 'A7']):
        sc.note('celesta', i * 0.25, 0.5, p, 0.5)
        sc.note('glock', 1.5 + i * 0.25, 0.5, p, 0.35)
    sc.line('trumpet', 1.5, 'D5:0.5 F#5:0.5 A5:0.5 D6:3', 0.84)
    sc.hold('horn', 1.5, 4.5, ['D4', 'F#4', 'A4'], 0.6)
    sc.hold('choir', 3, 3, ['D4', 'F#4', 'A4', 'D5'], 0.5)
    sc.note('hit', 3, 0.5, 'D4', 0.7)
    sc.drum('crash', 3, 0.9)


def c_pickup(sc):
    sc.line('celesta', 0, 'E6:0.2 B6:0.2 E7:0.5', 0.8)
    sc.line('glock', 0.2, 'B6:0.2 E7:0.5', 0.5)


THEMES = {
    'nightwatch': ('Night Watch', 'Strings, horns and taiko - the main theme', nightwatch, 'space'),
    'constellation': ('Constellation', 'Harp, celesta and flute, still moving', constellation, 'space'),
    'redshift': ('Red Shift', 'Taiko, low brass and trumpets - all out', redshift, 'space'),
    'danse': ('Danse of the Dead', 'A skeletons\' waltz on xylophone and harpsichord', danse, 'zombie'),
    'hollow': ('Hollow Hill', 'A music box, a heartbeat and tolling bells', hollow, 'zombie'),
}
LOOPS = {'lobby': lobby, 'boss': boss, 'zlobby': zlobby, 'witchboss': witchboss}
CUES = {
    'count': (120, 1, c_count), 'wave': (120, 1, c_wave), 'clear': (110, 1, c_clear),
    'bosswarn': (90, 2, c_bosswarn), 'victory': (120, 2, c_victory), 'gameover': (76, 2, c_gameover),
    'record': (110, 2, c_record), 'pickup': (120, 1, c_pickup),
    'zwave': (80, 1, c_zwave), 'zclear': (100, 1, c_zclear), 'witchwarn': (90, 2, c_witchwarn), 'zover': (70, 2, c_zover),
}
EDGE = 0.3        # seconds of wrap-around either side of a loop


def main():
    want = set(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    man_path = os.path.join(OUT, 'music.json')
    man = json.load(open(man_path)) if os.path.exists(man_path) else {'themes': {}, 'loops': {}, 'cues': {}}
    loops = {k: (k, '', fn, None) for k, fn in LOOPS.items()}
    for kind, table in (('themes', THEMES), ('loops', loops)):
        for key, (title, blurb, fn, mode) in table.items():
            if want and key not in want:
                continue
            sc = fn()
            mix = master(render(sc, loop=True))
            e = int(EDGE * SR)
            body = np.concatenate([mix[-e:], mix, mix[:e]])
            encode(body, os.path.join(OUT, key + '.mp3'))
            entry = {'file': key + '.mp3', 'loopStart': EDGE, 'loopEnd': EDGE + len(mix) / SR, 'bpm': sc.bpm}
            if kind == 'themes':
                entry.update(title=title, blurb=blurb, mode=mode)
            man[kind][key] = entry
            print(f'{key}: {len(mix) / SR:.1f} s loop')
    for key, (bpm, bars, fn) in CUES.items():
        if want and key not in want:
            continue
        sc = cue(bpm, bars, fn)
        quiet = key in ('pickup', 'count')
        mix = render(sc, tail=2.2 if not quiet else 1.0, loop=False)
        mix = master(mix, rms_target=0.08 if quiet else 0.12)
        encode(mix, os.path.join(OUT, key + '.mp3'))
        man['cues'][key] = {'file': key + '.mp3', 'len': round(len(mix) / SR, 2)}
        print(f'{key}: {len(mix) / SR:.1f} s')
    man['credit'] = 'Instruments: FluidR3 GM soundfont by Frank Wen (CC BY 3.0)'
    json.dump(man, open(man_path, 'w'), indent=1)


if __name__ == '__main__':
    main()
