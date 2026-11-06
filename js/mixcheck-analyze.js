// MixCheck meters. Runs in the browser and under Node (no DOM).
// Loudness follows ITU-R BS.1770 gating and K-weighting.
// True peak is an estimate: 4x windowed-sinc oversampling, not a certified meter.
// Lane profiles are generic shapes for this page, not measurements of commercial records.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MixCheck = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var BANDS = [
    { id: "sub", lo: 20, hi: 60 },
    { id: "bass", lo: 60, hi: 120 },
    { id: "lowmid", lo: 120, hi: 400 },
    { id: "mid", lo: 400, hi: 2000 },
    { id: "presence", lo: 2000, hi: 8000 },
    { id: "air", lo: 8000, hi: 16000 },
  ];

  // Band energy relative to the mids (400 Hz–2 kHz), in dB.
  // Wider bands naturally hold more pink-noise power; these offsets are
  // generic shapes for this page, not a copy of any record.
  // A gap of more than 3 dB is what the report calls a lean.
  var LANES = {
    dnb: { label: "DnB", target: { sub: 4, bass: 2, lowmid: -3, mid: 0, presence: -1, air: -5 } },
    neuro: { label: "neuro", target: { sub: 3, bass: 3, lowmid: 0, mid: 0, presence: 1, air: -4 } },
    rollers: { label: "rollers", target: { sub: 6, bass: 3, lowmid: -2, mid: 0, presence: -3, air: -8 } },
    // Kick and hooks forward. Sub stays solid, tops sit brighter than rollers.
    dancefloor: { label: "dancefloor", target: { sub: 2, bass: 6, lowmid: -1, mid: 0, presence: 2, air: -1 } },
    // Growl in the low-mids, big kick, sub present without rollers depth.
    jumpup: { label: "jump up", target: { sub: 1, bass: 6, lowmid: 4, mid: 0, presence: 0, air: -4 } },
    // Rolling weight, warmer mids, less bite than neuro.
    liquid: { label: "liquid", target: { sub: 5, bass: 0, lowmid: 2, mid: 0, presence: -3, air: -7 } },
    // Kick and snare share the job with the sub. Not a sub-led DnB shape.
    breakbeat: { label: "breakbeat", target: { sub: 0, bass: 4, lowmid: 1, mid: 0, presence: 3, air: -2 } },
  };

  var LOUDNESS = {
    // Generic window used only by this page. Not a chart position.
    bassLow: -10,
    bassHigh: -7,
    quietBelow: -16,
    silentBelow: -50,
  };

  function coded(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  function BiQuad(c) {
    this.b0 = c.b0;
    this.b1 = c.b1;
    this.b2 = c.b2;
    this.a1 = c.a1;
    this.a2 = c.a2;
    this.z1 = 0;
    this.z2 = 0;
  }

  BiQuad.prototype.process = function (x) {
    var y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  };

  function Cascade(stages) {
    this.stages = stages;
  }

  Cascade.prototype.process = function (x) {
    var y = x;
    for (var i = 0; i < this.stages.length; i++) y = this.stages[i].process(y);
    return y;
  };

  // Audio EQ cookbook, a0 normalized into the coefficients.
  function cookbook(kind, fs, fc, Q) {
    var w0 = (2 * Math.PI * fc) / fs;
    var cos = Math.cos(w0);
    var sin = Math.sin(w0);
    var alpha = sin / (2 * Q);
    var b0;
    var b1;
    var b2;
    if (kind === "lp") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    }
    var a0 = 1 + alpha;
    return {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: (-2 * cos) / a0,
      a2: (1 - alpha) / a0,
    };
  }

  function butterworth4(kind, fs, fc) {
    var q1 = 1 / (2 * Math.sin(Math.PI / 8));
    var q2 = 1 / (2 * Math.sin((3 * Math.PI) / 8));
    return new Cascade([
      new BiQuad(cookbook(kind, fs, fc, q1)),
      new BiQuad(cookbook(kind, fs, fc, q2)),
    ]);
  }

  function bandpass4(fs, lo, hi) {
    var hp = butterworth4("hp", fs, lo);
    var lp = butterworth4("lp", fs, hi);
    return {
      process: function (x) {
        return lp.process(hp.process(x));
      },
    };
  }

  // K-weighting coefficients (ITU-R BS.1770 / libebur128).
  function kWeightCoefficients(fs) {
    var shelfF0 = 1681.974450955533;
    var shelfG = 3.999843853973347;
    var shelfQ = 0.7071752369554196;
    var k = Math.tan(Math.PI * shelfF0 / fs);
    var vh = Math.pow(10, shelfG / 20);
    var vb = Math.pow(vh, 0.4996667741545416);
    var a0 = 1 + k / shelfQ + k * k;
    var shelf = {
      b0: (vh + (vb * k) / shelfQ + k * k) / a0,
      b1: (2 * (k * k - vh)) / a0,
      b2: (vh - (vb * k) / shelfQ + k * k) / a0,
      a1: (2 * (k * k - 1)) / a0,
      a2: (1 - k / shelfQ + k * k) / a0,
    };

    var hpF0 = 38.13547087602444;
    var hpQ = 0.5003270373238773;
    var hk = Math.tan(Math.PI * hpF0 / fs);
    var ha0 = 1 + hk / hpQ + hk * hk;
    var highpass = {
      b0: 1 / ha0,
      b1: -2 / ha0,
      b2: 1 / ha0,
      a1: (2 * (hk * hk - 1)) / ha0,
      a2: (1 - hk / hpQ + hk * hk) / ha0,
    };
    return { shelf: shelf, highpass: highpass };
  }

  function KWeight(fs) {
    var c = kWeightCoefficients(fs);
    this.shelf = new BiQuad(c.shelf);
    this.highpass = new BiQuad(c.highpass);
  }

  KWeight.prototype.process = function (x) {
    return this.highpass.process(this.shelf.process(x));
  };

  // ITU-R BS.1770-4 Annex 2, 48-tap 4-phase interpolator.
// Phase 0 is not the raw sample, so every phase is measured.
// Float math skips the spec's 12.04 dB integer headroom shift.
var TRUE_PEAK_PHASES = [
  [0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500],
  [-0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375],
  [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000, -0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500, 0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875],
  [-0.0083007812500, 0.0148925781250, -0.0266113281250, 0.0476074218750, -0.1022949218750, 0.9721679687500, 0.1373291015625, -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750],
];

  function TruePeak() {
    this.phases = TRUE_PEAK_PHASES;
    this.delay = new Float64Array(this.phases[0].length);
    this.pos = 0;
    this.seen = 0;
    this.max = 0;
  }

  TruePeak.prototype.process = function (x) {
    this.delay[this.pos] = x;
    this.seen++;
    if (this.seen >= this.delay.length) {
      var klen = this.delay.length;
      for (var p = 0; p < this.phases.length; p++) {
        var coef = this.phases[p];
        var y = 0;
        var idx = this.pos;
        for (var k = 0; k < klen; k++) {
          y += coef[k] * this.delay[idx];
          idx = idx === 0 ? klen - 1 : idx - 1;
        }
        var ay = y < 0 ? -y : y;
        if (ay > this.max) this.max = ay;
      }
    }
    this.pos++;
    if (this.pos === this.delay.length) this.pos = 0;
  };

  function dbFromPower(power) {
    if (!(power > 1e-20)) return -120;
    return 10 * Math.log10(power);
  }

  function mean(values) {
    var s = 0;
    for (var i = 0; i < values.length; i++) s += values[i];
    return s / values.length;
  }

  function percentileSorted(sorted, p) {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    var idx = (sorted.length - 1) * p;
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    var t = idx - lo;
    return sorted[lo] * (1 - t) + sorted[hi] * t;
  }

  function loudnessBand(lufs) {
    if (lufs == null || !isFinite(lufs) || lufs < LOUDNESS.silentBelow) return "silent";
    if (lufs < LOUDNESS.quietBelow) return "quiet";
    if (lufs < LOUDNESS.bassLow) return "streaming";
    if (lufs <= LOUDNESS.bassHigh) return "bass-window";
    return "hot";
  }

  function integratedFromHops(hopSums, hopSamples) {
    var blockHops = 4;
    if (hopSums.length < blockHops) {
      return { integrated: null, range: null, band: "silent" };
    }
    var blocks = [];
    for (var i = 0; i + blockHops <= hopSums.length; i++) {
      var s = hopSums[i] + hopSums[i + 1] + hopSums[i + 2] + hopSums[i + 3];
      blocks.push(s / (blockHops * hopSamples));
    }
    var absCut = Math.pow(10, (-70 + 0.691) / 10);
    var absBlocks = [];
    for (i = 0; i < blocks.length; i++) {
      if (blocks[i] >= absCut) absBlocks.push(blocks[i]);
    }
    if (!absBlocks.length) return { integrated: null, range: null, band: "silent" };
    var absL = -0.691 + 10 * Math.log10(mean(absBlocks));
    var relCut = Math.pow(10, (absL - 10 + 0.691) / 10);
    var relBlocks = [];
    for (i = 0; i < absBlocks.length; i++) {
      if (absBlocks[i] >= relCut) relBlocks.push(absBlocks[i]);
    }
    var use = relBlocks.length ? relBlocks : absBlocks;
    var integrated = -0.691 + 10 * Math.log10(mean(use));
    return {
      integrated: integrated,
      range: loudnessRange(hopSums, hopSamples),
      band: loudnessBand(integrated),
    };
  }

  function loudnessRange(hopSums, hopSamples) {
    var win = 30;
    if (hopSums.length < win) return null;
    var levels = [];
    var powers = [];
    for (var i = 0; i + win <= hopSums.length; i++) {
      var s = 0;
      for (var k = 0; k < win; k++) s += hopSums[i + k];
      var z = s / (win * hopSamples);
      if (!(z > 1e-15)) continue;
      var L = -0.691 + 10 * Math.log10(z);
      if (L > -70) {
        levels.push(L);
        powers.push(z);
      }
    }
    if (levels.length < 2) return null;
    var ungated = -0.691 + 10 * Math.log10(mean(powers));
    var gate = ungated - 20;
    var kept = [];
    for (i = 0; i < levels.length; i++) if (levels[i] >= gate) kept.push(levels[i]);
    if (kept.length < 2) return null;
    kept.sort(function (a, b) { return a - b; });
    return percentileSorted(kept, 0.95) - percentileSorted(kept, 0.1);
  }

  function peakStatus(dbtp) {
  // Match the number the page shows (one decimal). −1.0 dBTP is in range.
    var shown = Math.round(dbtp * 10) / 10;
    if (Object.is(shown, -0)) shown = 0;
    if (shown > 0) return "over";
    if (shown > -1) return "hot";
    return "safe";
  }

  function classifyMono(correlation, cancellationDb, powerDb) {
    if (powerDb < -50) return "quiet";
    if (correlation < 0.15 && cancellationDb < -6) return "drops";
    if (cancellationDb < -8) return "drops";
    if (correlation < 0.85 || cancellationDb < -1.5) return "thins";
    return "holds";
  }

  function correlationStats(sumLL, sumRR, sumLR, n) {
    var power = n ? (0.5 * (sumLL + sumRR)) / n : 0;
    var powerDb = dbFromPower(power);
    var den = Math.sqrt(Math.max(sumLL, 0) * Math.max(sumRR, 0));
    var correlation = den > 1e-20 ? sumLR / den : 0;
    if (correlation > 1) correlation = 1;
    if (correlation < -1) correlation = -1;
    return { correlation: correlation, powerDb: powerDb };
  }

  // Overall correlation is pulled toward the loudest band, usually the sub.
  function classifyOverallWidth(correlation, powerDb) {
    if (!(powerDb > -50)) return "quiet";
    if (correlation < 0) return "phasey";
    if (correlation >= 0.9) return "narrow";
    if (correlation < 0.15) return "wide";
    return "ok";
  }

  // Under 120 Hz, narrow is the desirable bass-music result.
  function classifyLowWidth(correlation, powerDb) {
    if (!(powerDb > -50)) return "quiet";
    if (correlation >= 0.85) return "narrow";
    if (correlation >= 0.5) return "wide";
    return "too-wide";
  }

  // Above ~4 kHz. A centered hat is narrow. Negative or near-zero agreement is too wide.
  function classifyTopWidth(correlation, powerDb) {
    if (!(powerDb > -45)) return "quiet";
    if (correlation < 0.05) return "too-wide";
    if (correlation >= 0.82) return "narrow";
    return "ok";
  }

  function classifyKick(stats) {
    if (stats.lowDbfs < -50) return "no-sub";
    if (stats.dipDb >= 7 && stats.peakDb >= 5) return "fighting";
    if (stats.dipDb >= 7) return "kick-holes-sub";
    if (stats.peakDb >= 5 && stats.dipDb < 5) return "readable";
    if (stats.peakDb < 3.5 && stats.dipDb < 3.5 && stats.hfHits >= 4 && stats.lowDbfs > -24) {
      return "sub-on-kick";
    }
    if (stats.hfHits < 4 && stats.peakDb < 4) return "no-kick";
    if (stats.peakDb >= 4 && stats.dipDb < 7) return "readable";
    return "unclear";
  }

  function countHfHits(hfPeak) {
    if (hfPeak.length < 8) return 0;
    var sorted = hfPeak.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)] || 0;
    var thresh = Math.max(median * 4, 0.02);
    var hits = 0;
    var last = -100;
    for (var i = 1; i < hfPeak.length - 1; i++) {
      if (hfPeak[i] < thresh) continue;
      if (hfPeak[i] < hfPeak[i - 1] || hfPeak[i] < hfPeak[i + 1]) continue;
      if (i - last < 8) continue;
      hits++;
      last = i;
    }
    return hits;
  }

  function envelopeStats(env) {
    var start = Math.min(env.length, 15);
    var slice = env.slice(start);
    if (slice.length < 8) slice = env.slice();
    var sorted = slice.slice().sort(function (a, b) { return a - b; });
    var floor = 1e-8;
    var p10 = Math.max(percentileSorted(sorted, 0.1), floor);
    var p50 = Math.max(percentileSorted(sorted, 0.5), floor);
    var p90 = Math.max(percentileSorted(sorted, 0.9), floor);
    return {
      dipDb: 20 * Math.log10(p50 / p10),
      peakDb: 20 * Math.log10(p90 / p50),
    };
  }

  function yieldThread() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  function readFourCC(view, offset) {
    return String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
  }

  function parseFmt(view, start, size) {
    if (size < 16) throw coded("bad-wav", "That WAV is missing its format info. Export a standard 16- or 24-bit stereo WAV.");
    var format = view.getUint16(start, true);
    var channels = view.getUint16(start + 2, true);
    var sampleRate = view.getUint32(start + 4, true);
    var bits = view.getUint16(start + 14, true);
    if (format === 65534) {
      if (size < 40) throw coded("bad-wav", "That WAV uses an extended format this page can't read. Export 16- or 24-bit PCM.");
      var sub = "";
      for (var i = 0; i < 4; i++) sub += view.getUint8(start + 24 + i).toString(16).padStart(2, "0");
      if (sub === "01000000") format = 1;
      else if (sub === "03000000") format = 3;
      else throw coded("bad-wav", "That WAV isn't plain PCM or float. Export a 16- or 24-bit stereo WAV.");
    }
    if (format !== 1 && format !== 3) {
      throw coded("bad-wav", "That WAV isn't PCM. Export a 16- or 24-bit stereo WAV, or an MP3.");
    }
    if (bits !== 16 && bits !== 24 && bits !== 32) {
      throw coded("bad-wav", "That WAV is " + bits + "-bit. Export 16-bit, 24-bit, or 32-bit float.");
    }
    return { format: format, channels: channels, sampleRate: sampleRate, bits: bits };
  }

  function parseWav(arrayBuffer) {
    var view = new DataView(arrayBuffer);
    if (arrayBuffer.byteLength < 44 || readFourCC(view, 0) !== "RIFF" || readFourCC(view, 8) !== "WAVE") {
      throw coded("bad-wav", "That doesn't look like a WAV. Export a standard stereo WAV or an MP3.");
    }
    var offset = 12;
    var fmt = null;
    var dataOffset = -1;
    var dataSize = 0;
    while (offset + 8 <= view.byteLength) {
      var id = readFourCC(view, offset);
      var size = view.getUint32(offset + 4, true);
      var start = offset + 8;
      if (id === "fmt ") fmt = parseFmt(view, start, size);
      if (id === "data") {
        dataOffset = start;
        dataSize = size;
        break;
      }
      offset = start + size + (size & 1);
    }
    if (!fmt || dataOffset < 0) throw coded("bad-wav", "That WAV is missing its audio data. Try exporting it again.");
    if (!fmt.channels || !fmt.sampleRate) throw coded("bad-wav", "That WAV doesn't say how it's built. Export it again as stereo.");
    var bytesPerSample = fmt.bits / 8;
    var frameSize = bytesPerSample * fmt.channels;
    var frames = Math.floor(Math.min(dataSize, view.byteLength - dataOffset) / frameSize);
    if (!frames) throw coded("empty", "That file had no audio in it.");
    var left = new Float32Array(frames);
    var right = fmt.channels > 1 ? new Float32Array(frames) : null;
    var pos = dataOffset;
    for (var i = 0; i < frames; i++) {
      left[i] = readSample(view, pos, fmt);
      if (right) right[i] = readSample(view, pos + bytesPerSample, fmt);
      pos += frameSize;
    }
    return {
      left: left,
      right: right,
      sampleRate: fmt.sampleRate,
      channels: fmt.channels,
      source: "wav",
    };
  }

  function readSample(view, offset, fmt) {
    if (fmt.format === 3 && fmt.bits === 32) return view.getFloat32(offset, true);
    if (fmt.bits === 16) return view.getInt16(offset, true) / 32768;
    if (fmt.bits === 24) {
      var v = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
      if (v & 0x800000) v -= 0x1000000;
      return v / 8388608;
    }
    if (fmt.bits === 32) return view.getInt32(offset, true) / 2147483648;
    return 0;
  }

  async function analyze(audio, options) {
    options = options || {};
    var onProgress = options.onProgress || function () {};
    var left = audio.left;
    var right = audio.right || null;
    var fs = audio.sampleRate | 0;
    var n = left ? left.length : 0;
    if (!n || !fs) throw coded("empty", "That file had no audio in it.");
    if (n / fs > 12 * 60) {
      throw coded("too-long", "That bounce is over twelve minutes. Read the drop, or the section you actually care about.");
    }

    var stereo = !!right;
    var kwL = new KWeight(fs);
    var kwR = stereo ? new KWeight(fs) : null;
    var tpL = new TruePeak();
    var tpR = stereo ? new TruePeak() : null;
    var monoL = butterworth4("lp", fs, 120);
    var monoR = stereo ? butterworth4("lp", fs, 120) : null;
    var lowL = bandpass4(fs, 30, 150);
    var lowR = stereo ? bandpass4(fs, 30, 150) : null;
    var hfL = butterworth4("hp", fs, 2000);
    var hfR = stereo ? butterworth4("hp", fs, 2000) : null;
    var measureTop = stereo && fs > 12000;
    var topL = measureTop ? butterworth4("hp", fs, 4000) : null;
    var topR = measureTop ? butterworth4("hp", fs, 4000) : null;

    var bandL = [];
    var bandR = [];
    var bandIds = [];
    for (var b = 0; b < BANDS.length; b++) {
      var spec = BANDS[b];
      if (spec.hi >= fs * 0.48) continue;
      bandIds.push(spec.id);
      bandL.push(bandpass4(fs, spec.lo, Math.min(spec.hi, fs * 0.45)));
      if (stereo) bandR.push(bandpass4(fs, spec.lo, Math.min(spec.hi, fs * 0.45)));
    }

    var hop = Math.max(1, Math.round(fs * 0.1));
    var envHop = Math.max(1, Math.round(fs * 0.01));
    var hopSq = 0;
    var hopCount = 0;
    var hopSums = [];
    var envLowSq = 0;
    var envHf = 0;
    var envCount = 0;
    var lowEnv = [];
    var hfEnv = [];
    var lowSq = 0;
    var bandSq = {};
    for (b = 0; b < bandIds.length; b++) bandSq[bandIds[b]] = 0;
    var bandN = 0;
    var sumLL = 0;
    var sumRR = 0;
    var sumLR = 0;
    var sumMid = 0;
    var monoN = 0;
    var sumFullLL = 0;
    var sumFullRR = 0;
    var sumFullLR = 0;
    var fullN = 0;
    var sumTopLL = 0;
    var sumTopRR = 0;
    var sumTopLR = 0;
    var topN = 0;
    var samplePeak = 0;

    for (var i = 0; i < n; i++) {
      var xL = left[i];
      var xR = stereo ? right[i] : 0;
      var absL = xL < 0 ? -xL : xL;
      if (absL > samplePeak) samplePeak = absL;
      if (stereo) {
        var absR = xR < 0 ? -xR : xR;
        if (absR > samplePeak) samplePeak = absR;
      }

      var yL = kwL.process(xL);
      var yR = stereo ? kwR.process(xR) : 0;
      hopSq += stereo ? yL * yL + yR * yR : yL * yL;
      hopCount++;
      if (hopCount === hop) {
        hopSums.push(hopSq);
        hopSq = 0;
        hopCount = 0;
      }

      tpL.process(xL);
      if (stereo) tpR.process(xR);

      if (stereo) {
        var mL = monoL.process(xL);
        var mR = monoR.process(xR);
        sumLL += mL * mL;
        sumRR += mR * mR;
        sumLR += mL * mR;
        var mid = 0.5 * (mL + mR);
        sumMid += mid * mid;
        monoN++;
        sumFullLL += xL * xL;
        sumFullRR += xR * xR;
        sumFullLR += xL * xR;
        fullN++;
        if (measureTop) {
          var tL = topL.process(xL);
          var tR = topR.process(xR);
          sumTopLL += tL * tL;
          sumTopRR += tR * tR;
          sumTopLR += tL * tR;
          topN++;
        }
      }

      var low = lowL.process(xL);
      var high = hfL.process(xL);
      if (stereo) {
        var lowRight = lowR.process(xR);
        var highRight = hfR.process(xR);
        low = 0.5 * (low + lowRight);
        var hAbsL = high < 0 ? -high : high;
        var hAbsR = highRight < 0 ? -highRight : highRight;
        high = hAbsL > hAbsR ? hAbsL : hAbsR;
      } else {
        high = high < 0 ? -high : high;
      }
      lowSq += low * low;
      envLowSq += low * low;
      if (high > envHf) envHf = high;
      envCount++;
      if (envCount === envHop) {
        lowEnv.push(Math.sqrt(envLowSq / envCount));
        hfEnv.push(envHf);
        envLowSq = 0;
        envHf = 0;
        envCount = 0;
      }

      for (b = 0; b < bandL.length; b++) {
        var bl = bandL[b].process(xL);
        var power = bl * bl;
        if (stereo) {
          var br = bandR[b].process(xR);
          power = 0.5 * (power + br * br);
        }
        bandSq[bandIds[b]] += power;
      }
      bandN++;

      if ((i & 16383) === 0) {
        onProgress(i / n, "Reading the mix");
        await yieldThread();
      }
    }

    var loudness = integratedFromHops(hopSums, hop);
    var truePeakLin = tpL.max;
    if (stereo && tpR.max > truePeakLin) truePeakLin = tpR.max;
    if (samplePeak > truePeakLin) truePeakLin = samplePeak;
    var dbtp = truePeakLin > 0 ? 20 * Math.log10(truePeakLin) : -120;
    var sampleDbfs = samplePeak > 0 ? 20 * Math.log10(samplePeak) : -120;

    var mono;
    if (!stereo) {
      mono = { status: "na", correlation: null, cancellationDb: null };
    } else {
      var corrDen = Math.sqrt(sumLL * sumRR);
      var correlation = corrDen > 0 ? sumLR / corrDen : 0;
      var stereoPower = monoN ? 0.5 * (sumLL + sumRR) / monoN : 0;
      var monoPower = monoN ? sumMid / monoN : 0;
      var cancellationDb = stereoPower > 1e-20 ? 10 * Math.log10(Math.max(monoPower, 1e-20) / stereoPower) : -120;
      var powerDb = dbFromPower(stereoPower);
      mono = {
        status: classifyMono(correlation, cancellationDb, powerDb),
        correlation: correlation,
        cancellationDb: cancellationDb,
      };
    }

    var lowPower = bandN ? lowSq / bandN : 0;
    var envShape = envelopeStats(lowEnv.length ? lowEnv : [0]);
    var kickStats = {
      lowDbfs: dbFromPower(lowPower),
      dipDb: envShape.dipDb,
      peakDb: envShape.peakDb,
      hfHits: countHfHits(hfEnv),
    };
    var kick = { status: classifyKick(kickStats) };
    if (options.includeDebug) kick.debug = kickStats;

    var width;
    if (!stereo) {
      var naBand = { correlation: null, powerDb: null, status: "na" };
      width = { overall: naBand, low: naBand, top: naBand };
    } else {
      var fullStats = correlationStats(sumFullLL, sumFullRR, sumFullLR, fullN);
      var lowStats = correlationStats(sumLL, sumRR, sumLR, monoN);
      var topStats = measureTop ? correlationStats(sumTopLL, sumTopRR, sumTopLR, topN) : { correlation: null, powerDb: -120 };
      width = {
        overall: { correlation: fullStats.correlation, powerDb: fullStats.powerDb, status: classifyOverallWidth(fullStats.correlation, fullStats.powerDb) },
        low: { correlation: lowStats.correlation, powerDb: lowStats.powerDb, status: classifyLowWidth(lowStats.correlation, lowStats.powerDb) },
        top: { correlation: topStats.correlation, powerDb: topStats.powerDb, status: classifyTopWidth(topStats.correlation, topStats.powerDb) },
      };
    }

    var rel = {};
    var midDb = bandSq.mid != null && bandN ? dbFromPower(bandSq.mid / bandN) : null;
    for (b = 0; b < BANDS.length; b++) {
      var id = BANDS[b].id;
      if (bandSq[id] == null || midDb == null || midDb < -80) {
        rel[id] = null;
      } else {
        rel[id] = dbFromPower(bandSq[id] / bandN) - midDb;
      }
    }

    var warnings = [];
    if (n / fs < 5) warnings.push("short");
    if (audio.source === "mp3") warnings.push("mp3");
    if ((audio.channels || (stereo ? 2 : 1)) > 2) warnings.push("multichannel");

    onProgress(1, "Writing the read");

    return {
      durationSec: n / fs,
      sampleRate: fs,
      channels: stereo ? Math.max(2, audio.channels || 2) : 1,
      source: audio.source || "wav",
      warnings: warnings,
      loudness: loudness,
      truePeak: { dbtp: dbtp, sampleDbfs: sampleDbfs, status: peakStatus(dbtp) },
      mono: mono,
      kick: kick,
      width: width,
      bands: rel,
    };
  }

  /**
   * The width issue worth a session, if the rest of the mix is close.
   * A wide sub is the mono read, not a second problem.
   * referenceWidth, when present, means "they already sound like this" and
   * the same status on both files is not a flaw.
   */
  function widthStandout(width, monoStatus, referenceWidth) {
    if (!width || !width.overall || width.overall.status === "na") return null;
    var top = width.top.status;
    var overall = width.overall.status;
    var refTop = referenceWidth && referenceWidth.top ? referenceWidth.top.status : null;
    var refOverall = referenceWidth && referenceWidth.overall ? referenceWidth.overall.status : null;
    if (top === "too-wide" && refTop !== "too-wide") return "top-wide";
    if (top === "narrow" && refTop !== "narrow") return "top-narrow";
    if (overall === "phasey" && refOverall !== "phasey" && monoStatus !== "drops" && monoStatus !== "thins") return "phasey";
    if (overall === "narrow" && top === "narrow" && refTop !== "narrow") return "narrow";
    if (overall === "wide" && monoStatus === "holds" && (top === "ok" || top === "wide") && refOverall !== "wide") return "wide";
    return null;
  }

  /**
   * One primary session for a single file.
   * Strong problems: mono cancellation, kick/sub masking, true peak over 0,
   * loudness well outside both windows, two-plus bands more than 6 dB off,
   * or a stereo image that is the thing standing out (overly narrow or wide up top).
   * A wide sub is counted as the mono issue, not a second one.
   * referenceGap is set when a user reference is far away and the absolute
   * read would otherwise look finished: "width", "loudness", or "large".
   * Quick Fix is only when the issue is concrete and the rest is close.
   * A clean read, a level problem, or a balance pass goes to the 1-hour session.
   * Three strong problems, or a low-end failure plus a balance mess, is a Deep Dive.
   * Full Project is never chosen here. One file cannot hear an EP.
   */
  function chooseSession(m) {
    if (m.silent || m.loudness === "silent") return { session: null, reason: "silent" };

    var maskBad = m.kick === "sub-on-kick" || m.kick === "kick-holes-sub" || m.kick === "fighting";
    var monoBad = m.mono === "drops";
    var monoMild = m.mono === "thins";
    var peakBad = m.peak === "over";
    var peakMild = m.peak === "hot";
    var loudBad = m.loudness === "hot" || m.loudness === "quiet";
    var balanceMess = m.balanceStrong >= 2;
    var balanceNotable = m.balanceStrong >= 1 || m.balanceMild >= 2;
    var width = m.width || null;

    var strong = [];
    if (monoBad) strong.push("mono");
    if (maskBad) strong.push("masking");
    if (peakBad) strong.push("peak");
    if (loudBad) strong.push("loudness");
    if (balanceMess) strong.push("balance");
    if (width) strong.push("width");

    if (strong.length >= 3 || ((monoBad || maskBad) && balanceMess)) {
      return { session: "deep", reason: "stacked" };
    }

    var balanceClose = !balanceNotable;
    var quickIssues = [];
    if (monoBad || monoMild) quickIssues.push("mono");
    if (maskBad) quickIssues.push("masking");
    if (peakBad || peakMild) quickIssues.push("peak");
    if (width) quickIssues.push("width");

    if (balanceClose && !loudBad && quickIssues.length) {
      if (quickIssues.length === 1 && quickIssues[0] === "mono") return { session: "quick", reason: "mono" };
      if (quickIssues.length === 1 && quickIssues[0] === "masking") return { session: "quick", reason: "masking" };
      if (quickIssues.length === 1 && quickIssues[0] === "peak") return { session: "quick", reason: "peak" };
      if (quickIssues.length === 1 && quickIssues[0] === "width") return { session: "quick", reason: "width" };
      if (quickIssues.indexOf("peak") === -1 && quickIssues.indexOf("width") !== -1) return { session: "quick", reason: "image" };
      if (quickIssues.indexOf("peak") === -1) return { session: "quick", reason: "low-end" };
      return { session: "quick", reason: "technical" };
    }

    if (!strong.length && !balanceNotable && !monoMild && !peakMild) {
      if (m.referenceGap === "width") return { session: "quick", reason: "width" };
      if (m.referenceGap === "loudness" || m.referenceGap === "large") return { session: "standard", reason: "reference" };
      return { session: "standard", reason: "polish" };
    }
    if (strong.length === 1 && strong[0] === "loudness" && !balanceMess) {
      return { session: "standard", reason: "loudness" };
    }
    return { session: "standard", reason: "consult" };
  }

function filterBand(input, sampleRate, lo, hi) {
      var f = bandpass4(sampleRate, lo, hi);
      var out = new Float32Array(input.length);
      for (var i = 0; i < input.length; i++) out[i] = f.process(input[i]);
      return out;
    }

    return {
      BANDS: BANDS,
      LANES: LANES,
      LOUDNESS: LOUDNESS,
      analyze: analyze,
      chooseSession: chooseSession,
      parseWav: parseWav,
      kWeightCoefficients: kWeightCoefficients,
      classifyMono: classifyMono,
      classifyKick: classifyKick,
      classifyOverallWidth: classifyOverallWidth,
      classifyLowWidth: classifyLowWidth,
      classifyTopWidth: classifyTopWidth,
      widthStandout: widthStandout,
      filterBand: filterBand,
    };
});
