const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const Mix = require("./mixcheck-analyze.js");
const Report = require("./mixcheck-report.js");

function ffmpegEbur(wavPath) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", wavPath, "-af", "ebur128=peak=true", "-f", "null", "-"],
    { encoding: "utf8" }
  );
  const text = result.stderr || "";
  const last = (pattern) => {
    const found = [...text.matchAll(pattern)];
    return found.length ? found[found.length - 1] : null;
  };
  const integrated = last(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g);
  const peak = last(/Peak:\s+(-?\d+(?:\.\d+)?) dBFS/g);
  const lra = last(/LRA:\s+(-?\d+(?:\.\d+)?) LU/g);
  if (!integrated || !peak) throw new Error(text.slice(-800));
  return {
    integrated: Number(integrated[1]),
    truePeak: Number(peak[1]),
    lra: lra ? Number(lra[1]) : null,
  };
}

function clamp16(x) {
  const v = Math.max(-1, Math.min(1, x));
  return v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
}

function writeWav(file, left, right, sampleRate) {
  const channels = right ? 2 : 1;
  const frames = left.length;
  const dataSize = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    buffer.writeInt16LE(clamp16(left[i]), offset);
    offset += 2;
    if (right) {
      buffer.writeInt16LE(clamp16(right[i]), offset);
      offset += 2;
    }
  }
  fs.writeFileSync(file, buffer);
}

function readWav(file) {
  const buf = fs.readFileSync(file);
  return Mix.parseWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function sine(sampleRate, seconds, freq, amp, phase) {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate + (phase || 0));
  }
  return out;
}

test("K-weighting at 48 kHz matches the published BS.1770 coefficients", () => {
  const c = Mix.kWeightCoefficients(48000);
  assert.ok(Math.abs(c.shelf.b0 - 1.53512485958697) < 1e-9);
  assert.ok(Math.abs(c.shelf.b1 - -2.69169618940638) < 1e-9);
  assert.ok(Math.abs(c.shelf.a1 - -1.69065929318241) < 1e-9);
  assert.ok(Math.abs(c.highpass.a1 - -1.99004745483398) < 1e-9);
  assert.ok(Math.abs(c.highpass.a2 - 0.99007225036621) < 1e-9);
});

const ffmpegOk = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;

test("integrated loudness and true peak agree with ffmpeg ebur128", { skip: !ffmpegOk }, async () => {
  const sampleRate = 48000;
  const amp = Math.pow(10, -23 / 20);
  const tone = sine(sampleRate, 10, 1000, amp, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mixcheck-"));
  const file = path.join(dir, "minus23.wav");
  writeWav(file, tone, tone, sampleRate);
  const measured = await Mix.analyze(readWav(file));
  const reference = ffmpegEbur(file);
  assert.ok(Math.abs(measured.loudness.integrated - reference.integrated) < 0.15, `${measured.loudness.integrated} vs ${reference.integrated}`);
  assert.ok(Math.abs(measured.truePeak.dbtp - reference.truePeak) < 0.2, `${measured.truePeak.dbtp} vs ${reference.truePeak}`);
  assert.equal(measured.loudness.range, 0);

  const hot = sine(sampleRate, 4, 1000, Math.pow(10, -1 / 20), -Math.PI / 2);
  const hotFile = path.join(dir, "minus1.wav");
  writeWav(hotFile, hot, hot, sampleRate);
  const hotMeasured = await Mix.analyze(readWav(hotFile));
  const hotReference = ffmpegEbur(hotFile);
  assert.ok(Math.abs(hotMeasured.truePeak.dbtp - hotReference.truePeak) < 0.2);
  assert.equal(hotMeasured.truePeak.status, "safe");
});

test("a centered sub holds in mono and an inverted sub drops out", async () => {
  const sampleRate = 48000;
  const sub = sine(sampleRate, 2, 40, 0.25, 0);
  const holds = await Mix.analyze({ left: sub, right: sub, sampleRate, source: "wav", channels: 2 });
  const inverted = Float32Array.from(sub, (sample) => -sample);
  const drops = await Mix.analyze({ left: sub, right: inverted, sampleRate, source: "wav", channels: 2 });
  assert.equal(holds.mono.status, "holds");
  assert.equal(drops.mono.status, "drops");
  assert.ok(drops.mono.correlation < -0.9);
});

test("kick and sub cases land on the plain-language calls", async () => {
  const sampleRate = 48000;
  const n = sampleRate * 6;
  const wall = new Float32Array(n);
  const hole = new Float32Array(n);
  const punch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const pos = t % 0.345;
    wall[i] = 0.4 * Math.sin((2 * Math.PI * 50 * i) / sampleRate);
    if (pos < 0.008) wall[i] += ((i % 17) / 17 - 0.5) * 0.9;
    const ducked = pos < 0.09 ? 0.02 : 1;
    hole[i] = ducked * 0.35 * Math.sin((2 * Math.PI * 45 * i) / sampleRate);
    const kick = pos < 0.08 ? Math.exp(-pos / 0.04) : 0;
    punch[i] = 0.22 * Math.sin((2 * Math.PI * 50 * i) / sampleRate) + kick * 0.7 * Math.sin((2 * Math.PI * 90 * i) / sampleRate);
  }
  const read = (buffer) => Mix.analyze({ left: buffer, right: buffer, sampleRate, source: "wav", channels: 2 }, { includeDebug: true });
  const wallRead = await read(wall);
  const holeRead = await read(hole);
  const punchRead = await read(punch);
  assert.equal(wallRead.kick.status, "sub-on-kick", JSON.stringify(wallRead.kick.debug));
  assert.equal(holeRead.kick.status, "kick-holes-sub", JSON.stringify(holeRead.kick.debug));
  assert.equal(punchRead.kick.status, "readable", JSON.stringify(punchRead.kick.debug));
});

test("24-bit WAV samples round-trip", () => {
  const data = Buffer.alloc(44 + 6);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + 6, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(48000, 24);
  data.writeUInt32LE(48000 * 6, 28);
  data.writeUInt16LE(6, 32);
  data.writeUInt16LE(24, 34);
  data.write("data", 36);
  data.writeUInt32LE(6, 40);
  data.writeUInt8(0, 44);
  data.writeUInt8(0, 45);
  data.writeUInt8(0x40, 46);
  data.writeUInt8(0, 47);
  data.writeUInt8(0, 48);
  data.writeUInt8(0xc0, 49);
  const audio = Mix.parseWav(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  assert.equal(audio.channels, 2);
  assert.ok(Math.abs(audio.left[0] - 0.5) < 0.0001);
  assert.ok(Math.abs(audio.right[0] + 0.5) < 0.0001);
});

test("chooseSession follows the one-button map", () => {
  const base = { loudness: "bass-window", mono: "holds", kick: "readable", peak: "safe", balanceStrong: 0, balanceMild: 0 };
  const expect = (patch, session, reason) => {
    const choice = Mix.chooseSession(Object.assign({}, base, patch));
    assert.equal(choice.session, session, JSON.stringify(patch));
    assert.equal(choice.reason, reason, JSON.stringify(patch));
  };
  expect({ mono: "drops" }, "quick", "mono");
  expect({ mono: "thins" }, "quick", "mono");
  expect({ kick: "sub-on-kick" }, "quick", "masking");
  expect({ kick: "kick-holes-sub" }, "quick", "masking");
  expect({ peak: "over" }, "quick", "peak");
  expect({ peak: "hot" }, "quick", "peak");
  expect({ mono: "drops", kick: "sub-on-kick" }, "quick", "low-end");
  expect({ mono: "drops", peak: "hot" }, "quick", "technical");
  expect({ width: "top-narrow" }, "quick", "width");
  expect({ width: "top-wide" }, "quick", "width");
  expect({ width: "top-narrow", mono: "drops" }, "quick", "image");
  expect({ referenceGap: "loudness" }, "standard", "reference");
  expect({ referenceGap: "large" }, "standard", "reference");
  expect({ referenceGap: "width" }, "quick", "width");
  expect({}, "standard", "polish");
  expect({ loudness: "streaming" }, "standard", "polish");
  expect({ loudness: "hot" }, "standard", "loudness");
  expect({ loudness: "quiet" }, "standard", "loudness");
  expect({ balanceStrong: 2 }, "standard", "consult");
  expect({ balanceMild: 2 }, "standard", "consult");
  expect({ balanceMild: 1 }, "standard", "polish");
  expect({ mono: "drops", balanceStrong: 2 }, "deep", "stacked");
  expect({ kick: "fighting", balanceStrong: 2 }, "deep", "stacked");
  expect({ mono: "drops", kick: "sub-on-kick", peak: "over" }, "deep", "stacked");
  expect({ loudness: "silent" }, null, "silent");
});

test("the report's only booking link matches the session", () => {
  const raw = {
    durationSec: 90,
    sampleRate: 48000,
    channels: 2,
    source: "wav",
    warnings: [],
    loudness: { integrated: -8.4, range: 4.2, band: "bass-window" },
    truePeak: { dbtp: -1.4, sampleDbfs: -1.6, status: "safe" },
    mono: { status: "drops", correlation: -0.8, cancellationDb: -12 },
    kick: { status: "readable" },
    width: {
      overall: { correlation: 0.72, powerDb: -12, status: "ok" },
      low: { correlation: 0.98, powerDb: -10, status: "narrow" },
      top: { correlation: 0.41, powerDb: -18, status: "ok" },
    },
    bands: { sub: 4, bass: 2, lowmid: -3, mid: 0, presence: -1, air: -5 },
  };
  const view = Report.buildView(raw, "dnb");
  assert.equal(view.next.session, "quick");
  assert.equal(view.next.href, "https://cal.com/rhodes-resonance/30min");
  assert.match(view.next.button, /\$40/);
  assert.match(view.next.body, /mono/i);
  assert.equal(view.cards.filter((card) => card.id === "limits").length, 1);
  assert.equal(view.cards.filter((card) => card.id === "width").length, 1);

  raw.mono = { status: "holds", correlation: 0.98, cancellationDb: -0.2 };
  const polish = Report.buildView(raw, "neuro");
  assert.equal(polish.next.session, "standard");
  assert.equal(polish.next.href, "https://cal.com/rhodes-resonance/60min");
  assert.match(polish.next.button, /\$75/);
  assert.equal(polish.laneLabel, "neuro");
});

test("a full-band mix in the pocket books the hour, and an inverted low end books Quick Fix", async () => {
  const sampleRate = 48000;
  const seconds = 8;
  const n = sampleRate * seconds;
  const rand = mulberry32(0x5eed);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1;

  const pieces = {};
  for (const band of Mix.BANDS) {
    const filtered = Mix.filterBand(noise, sampleRate, band.lo, band.hi);
    let sum = 0;
    for (let i = 0; i < filtered.length; i++) sum += filtered[i] * filtered[i];
    const rms = Math.sqrt(sum / filtered.length) || 1;
    const gain = (0.08 / rms) * Math.pow(10, Mix.LANES.dnb.target[band.id] / 20);
    pieces[band.id] = filtered.map((sample) => sample * gain);
  }
  const sideRand = mulberry32(0x51de);
  const sideNoise = new Float32Array(n);
  for (let i = 0; i < n; i++) sideNoise[i] = sideRand() * 2 - 1;
  const sidePieces = {};
  for (const id of ["presence", "air"]) {
    const band = Mix.BANDS.find((item) => item.id === id);
    const filtered = Mix.filterBand(sideNoise, sampleRate, band.lo, band.hi);
    let sum = 0;
    for (let i = 0; i < filtered.length; i++) sum += filtered[i] * filtered[i];
    const rms = Math.sqrt(sum / filtered.length) || 1;
    let pieceSum = 0;
    for (let i = 0; i < n; i++) pieceSum += pieces[id][i] * pieces[id][i];
    const pieceRms = Math.sqrt(pieceSum / n) || 1;
    const gain = (0.85 * pieceRms) / rms;
    sidePieces[id] = filtered.map((sample) => sample * gain);
  }

  function mix(invertLow) {
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (const band of Mix.BANDS) {
      const sign = invertLow && (band.id === "sub" || band.id === "bass") ? -1 : 1;
      const side = sidePieces[band.id];
      for (let i = 0; i < n; i++) {
        const sideSample = side ? side[i] : 0;
        left[i] += pieces[band.id][i] + sideSample;
        right[i] += sign * pieces[band.id][i] - sideSample;
      }
    }
    for (let i = 0; i < n; i++) {
      const pos = (i / sampleRate) % 0.345;
      if (pos < 0.05) {
        const kick = Math.exp(-pos / 0.025) * 0.35 * Math.sin((2 * Math.PI * 90 * i) / sampleRate);
        const click = pos < 0.004 ? (rand() * 2 - 1) * 0.15 : 0;
        left[i] += kick + click;
        right[i] += kick + click;
      }
    }
    return { left, right };
  }

  async function normalize(buffers) {
    const draft = await Mix.analyze({ ...buffers, sampleRate, source: "wav", channels: 2 });
    let peak = 0;
    for (let i = 0; i < n; i++) {
      peak = Math.max(peak, Math.abs(buffers.left[i]), Math.abs(buffers.right[i]));
    }
    const loudGain = Math.pow(10, (-9 - draft.loudness.integrated) / 20);
    const peakGain = peak > 0 ? Math.pow(10, -2 / 20) / peak : 1;
    const gain = Math.min(loudGain, peakGain);
    const left = Float32Array.from(buffers.left, (sample) => sample * gain);
    const right = Float32Array.from(buffers.right, (sample) => sample * gain);
    return Mix.analyze({ left, right, sampleRate, source: "wav", channels: 2 });
  }

  const healthy = await normalize(mix(false));
  const flipped = await normalize(mix(true));
  const healthyView = Report.buildView(healthy, "dnb");
  const flippedView = Report.buildView(flipped, "dnb");
  assert.equal(healthy.mono.status, "holds", JSON.stringify(healthy.mono));
  assert.equal(healthyView.next.session, "standard", JSON.stringify({
    loud: healthy.loudness,
    peak: healthy.truePeak,
    kick: healthy.kick,
    bands: healthy.bands,
    next: healthyView.next && healthyView.next.reason,
    width: healthy.width,
  }));
  assert.equal(healthyView.next.href, Report.SESSIONS.standard.href);
  assert.equal(flipped.mono.status, "drops", JSON.stringify(flipped.mono));
  assert.equal(flippedView.next.session, "quick", JSON.stringify({
    loud: flipped.loudness,
    peak: flipped.truePeak,
    kick: flipped.kick,
    bands: flipped.bands,
    reason: flippedView.next && flippedView.next.reason,
  }));
  assert.equal(flippedView.next.href, "https://cal.com/rhodes-resonance/30min");
  const buttons = [healthyView.next.href, flippedView.next.href];
  assert.equal(new Set(buttons).size, 2);
});

test("stereo width keeps a narrow sub and calls an out-of-phase top too wide", async () => {
  const sampleRate = 48000;
  const n = sampleRate * 2;
  const rand = mulberry32(3);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1;
  const low = Mix.filterBand(noise, sampleRate, 30, 90);
  const high = Mix.filterBand(noise, sampleRate, 5000, 12000);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = low[i] * 0.4 + high[i] * 0.3;
    right[i] = low[i] * 0.4 - high[i] * 0.3;
  }
  const result = await Mix.analyze({ left, right, sampleRate, source: "wav", channels: 2 });
  assert.equal(result.width.low.status, "narrow", JSON.stringify(result.width));
  assert.ok(result.width.top.correlation < 0.05, JSON.stringify(result.width));
  assert.equal(result.width.top.status, "too-wide");
  const card = Report.buildView(result, "dnb").cards.find((item) => item.id === "width");
  assert.equal(card.figure, "Wide up top");
  assert.match(card.body, /4 kHz/);
  assert.match(card.body, /120 Hz/);
});

test("a reference changes the comparison and still leaves one booking button", () => {
  const raw = {
    durationSec: 90,
    sampleRate: 48000,
    channels: 2,
    source: "wav",
    warnings: [],
    loudness: { integrated: -8, range: 3, band: "bass-window" },
    truePeak: { dbtp: -1.5, sampleDbfs: -1.8, status: "safe" },
    mono: { status: "holds", correlation: 0.98, cancellationDb: -0.2 },
    kick: { status: "readable" },
    width: {
      overall: { correlation: 0.7, powerDb: -12, status: "ok" },
      low: { correlation: 0.97, powerDb: -10, status: "narrow" },
      top: { correlation: 0.4, powerDb: -18, status: "ok" },
    },
    bands: { sub: 4, bass: 2, lowmid: -3, mid: 0, presence: -1, air: -5 },
  };
  const quieter = JSON.parse(JSON.stringify(raw));
  quieter.loudness = { integrated: -14, range: 3, band: "streaming" };
  const level = Report.buildView(raw, "dnb", { raw: quieter, name: "ref.wav" });
  assert.equal(level.compareLabel, "next to ref.wav");
  assert.equal(level.next.session, "standard");
  assert.equal(level.next.reason, "reference");
  assert.equal(level.next.href, "https://cal.com/rhodes-resonance/60min");
  assert.equal(level.cards.filter((card) => card.id === "width").length, 1);
  const loudCard = level.cards.find((card) => card.id === "loudness");
  assert.match(loudCard.notes.join(" "), /reference/i);

  const wide = JSON.parse(JSON.stringify(raw));
  wide.width.top = { correlation: -0.1, powerDb: -16, status: "too-wide" };
  const image = Report.buildView(wide, "rollers", { raw, name: "ref.wav" });
  assert.equal(image.next.session, "quick");
  assert.equal(image.next.reason, "width");
  assert.equal(image.next.href, "https://cal.com/rhodes-resonance/30min");
  const widthCard = image.cards.find((card) => card.id === "width");
  assert.match(widthCard.notes.join(" "), /reference/i);
  assert.equal([...image.cards, image.next].filter((item) => item && item.href).length, 1);
});

test("each lane keeps its own generic profile", () => {
  const ids = ["dnb", "neuro", "rollers", "dancefloor", "jumpup", "liquid", "breakbeat"];
  const bands = ["sub", "bass", "lowmid", "mid", "presence", "air"];
  ids.forEach((id) => {
    assert.ok(Mix.LANES[id], id);
    bands.forEach((band) => assert.equal(typeof Mix.LANES[id].target[band], "number"));
    assert.equal(Mix.LANES[id].target.mid, 0);
  });
  assert.ok(Mix.LANES.rollers.target.sub - Mix.LANES.dancefloor.target.sub > 3);
  assert.ok(Mix.LANES.jumpup.target.lowmid - Mix.LANES.neuro.target.lowmid > 3);
  assert.ok(Mix.LANES.jumpup.target.sub < Mix.LANES.rollers.target.sub - 3);
  assert.ok(Mix.LANES.neuro.target.presence - Mix.LANES.liquid.target.presence > 3);
  assert.ok(Mix.LANES.liquid.target.lowmid - Mix.LANES.dnb.target.lowmid > 3);
  assert.ok(Mix.LANES.dnb.target.sub - Mix.LANES.breakbeat.target.sub > 3);
  assert.ok(Mix.LANES.breakbeat.target.presence - Mix.LANES.dnb.target.presence > 3);
  assert.ok(Mix.LANES.dancefloor.target.bass - Mix.LANES.dnb.target.bass > 3);

  const raw = {
    durationSec: 90,
    sampleRate: 48000,
    channels: 2,
    source: "wav",
    warnings: [],
    loudness: { integrated: -8.4, range: 4, band: "bass-window" },
    truePeak: { dbtp: -1.4, sampleDbfs: -1.6, status: "safe" },
    mono: { status: "holds", correlation: 0.98, cancellationDb: -0.2 },
    kick: { status: "readable" },
    width: {
      overall: { correlation: 0.7, powerDb: -12, status: "ok" },
      low: { correlation: 0.98, powerDb: -10, status: "narrow" },
      top: { correlation: 0.4, powerDb: -18, status: "ok" },
    },
    bands: { sub: 5, bass: 0, lowmid: 2, mid: 0, presence: -3, air: -7 },
  };
  const liquid = Report.buildView(raw, "liquid");
  assert.equal(liquid.laneId, "liquid");
  assert.equal(liquid.laneLabel, "liquid");
  assert.match(liquid.compareLabel, /liquid/);
  const balance = liquid.cards.find((card) => card.id === "balance");
  assert.equal(balance.figure, "Close to the profile");
  const asNeuro = Report.buildView(raw, "neuro");
  const neuroBalance = asNeuro.cards.find((card) => card.id === "balance");
  assert.notEqual(neuroBalance.figure, "Close to the profile");
});

test("the homepage only gains a MixCheck link", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /href="mixcheck\/">MixCheck/);
  assert.match(html, /Elevate your/);
  assert.match(html, /https:\/\/cal\.com\/rhodes-resonance\/30min/);
  assert.match(html, /https:\/\/cal\.com\/rhodes-resonance\/60min/);
  assert.match(html, /https:\/\/cal\.com\/rhodes-resonance\/90minute/);
  assert.match(html, /https:\/\/cal\.com\/rhodes-resonance\/full-project/);
  assert.equal((html.match(/<h1>/g) || []).length, 1);
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
