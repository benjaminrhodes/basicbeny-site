// Plain-language report and the one booking it points at.
// Prices and URLs match the homepage mastering tiers on basicbeny.com:
// Quick Fix $40, 1 hour $75, Deep Dive $100.
// Full Project ($300, 3 hours) is homepage-only. One file never selects it.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MixCheckReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var analyzeApi = typeof MixCheck !== "undefined" ? MixCheck : require("./mixcheck-analyze.js");

  var SESSIONS = {
    quick: {
      id: "quick",
      name: "Quick Fix",
      length: "30 minutes",
      price: "$40",
      href: "https://cal.com/rhodes-resonance/30min",
      button: "Book a Quick Fix — 30 min, $40",
    },
    standard: {
      id: "standard",
      name: "1-hour session",
      length: "1 hour",
      price: "$75",
      href: "https://cal.com/rhodes-resonance/60min",
      button: "Book the 1-hour session — $75",
    },
    deep: {
      id: "deep",
      name: "Deep Dive",
      length: "1.5 hours",
      price: "$100",
      href: "https://cal.com/rhodes-resonance/90minute",
      button: "Book a Deep Dive — 1.5 hours, $100",
    },
  };

  var BAND_META = [
    { id: "sub", label: "Sub", hz: "20–60 Hz" },
    { id: "bass", label: "Bass", hz: "60–120 Hz" },
    { id: "lowmid", label: "Low-mids", hz: "120–400 Hz" },
    { id: "mid", label: "Mids", hz: "400 Hz–2 kHz" },
    { id: "presence", label: "Presence", hz: "2–8 kHz" },
    { id: "air", label: "Air", hz: "8–16 kHz" },
  ];

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function signedDb(n) {
    var v = round1(n);
    var body = Math.abs(v).toFixed(1);
    if (v < 0) return "−" + body;
    if (v > 0) return "+" + body;
    return "0.0";
  }

  function formatLufs(n) {
    return signedDb(n) + " LUFS";
  }

  function formatDbtp(n) {
    return signedDb(n) + " dBTP";
  }

  function formatDuration(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    var s = Math.round(sec);
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ":" + String(r).padStart(2, "0");
  }

  function listJoin(parts) {
    if (!parts.length) return "";
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] + " and " + parts[1];
    return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
  }

  function emptyWidth() {
    return {
      overall: { correlation: null, status: "na" },
      low: { correlation: null, status: "na" },
      top: { correlation: null, status: "na" },
    };
  }

  function interpret(raw, laneId, referenceRaw) {
    var lane = analyzeApi.LANES[laneId] || analyzeApi.LANES.dnb;
    var source = raw.source;
    var useRef = !!(referenceRaw && referenceRaw.bands && referenceRaw.bands.mid != null && isFinite(referenceRaw.bands.mid));
    var bands = [];
    var strong = 0;
    var mild = 0;
    for (var i = 0; i < BAND_META.length; i++) {
      var meta = BAND_META[i];
      var relative = raw.bands ? raw.bands[meta.id] : null;
      if (relative == null || !isFinite(relative)) {
        bands.push({
          id: meta.id,
          label: meta.label,
          hz: meta.hz,
          errorDb: null,
          tone: "unavailable",
        });
        continue;
      }
      var target = useRef && referenceRaw.bands[meta.id] != null && isFinite(referenceRaw.bands[meta.id])
        ? referenceRaw.bands[meta.id]
        : (lane.target[meta.id] || 0);
      var error = relative - target;
      var strongCut = 6;
      var mildCut = 3;
      // MP3 already rolls the air off. Don't send someone to a longer session for that.
      if (meta.id === "air" && source === "mp3") strongCut = 99;
      var abs = Math.abs(error);
      var tone = "close";
      if (abs > mildCut) tone = error > 0 ? "high" : "low";
      if (meta.id !== "mid") {
        if (abs > strongCut) strong++;
        else if (abs > mildCut) mild++;
      }
      bands.push({
        id: meta.id,
        label: meta.label,
        hz: meta.hz,
        errorDb: Math.max(-18, Math.min(18, error)),
        tone: tone,
        severe: abs > 12,
      });
    }

    var kickUnheard = raw.kick.status === "no-kick" || raw.kick.status === "no-sub" || raw.kick.status === "unclear";
    var width = raw.width || emptyWidth();
    var refWidth = referenceRaw && referenceRaw.width ? referenceRaw.width : null;
    var widthIssue = analyzeApi.widthStandout(width, raw.mono.status, refWidth);
    var loudDelta = null;
    if (referenceRaw && raw.loudness && referenceRaw.loudness && raw.loudness.integrated != null && referenceRaw.loudness.integrated != null) {
      loudDelta = raw.loudness.integrated - referenceRaw.loudness.integrated;
    }
    var peakDelta = null;
    if (referenceRaw && raw.truePeak && referenceRaw.truePeak && isFinite(raw.truePeak.dbtp) && isFinite(referenceRaw.truePeak.dbtp)) {
      peakDelta = raw.truePeak.dbtp - referenceRaw.truePeak.dbtp;
    }
    var referenceGap = null;
    if (referenceRaw) {
      var gapCount = 0;
      var loudGap = loudDelta != null && Math.abs(loudDelta) >= 3;
      var balanceGap = strong >= 1 || mild >= 2;
      var widthGap = !!widthIssue;
      if (!widthGap && refWidth && width.top.correlation != null && refWidth.top.correlation != null && width.top.status !== "quiet" && refWidth.top.status !== "quiet" && refWidth.top.status !== "na") {
        if (Math.abs(width.top.correlation - refWidth.top.correlation) >= 0.4) widthGap = true;
      }
      if (!widthGap && refWidth && width.low.correlation != null && refWidth.low.correlation != null && width.low.status !== "quiet" && width.low.status !== "narrow" && refWidth.low.status === "narrow") {
        if (refWidth.low.correlation - width.low.correlation >= 0.25) widthGap = true;
      }
      if (loudGap) gapCount++;
      if (balanceGap) gapCount++;
      if (widthGap) gapCount++;
      if (gapCount >= 2) referenceGap = "large";
      else if (loudGap) referenceGap = "loudness";
      else if (balanceGap) referenceGap = "balance";
      else if (widthGap) referenceGap = "width";
    }
    var choice = analyzeApi.chooseSession({
      silent: raw.loudness.band === "silent",
      loudness: raw.loudness.band,
      mono: raw.mono.status,
      kick: raw.kick.status,
      peak: raw.truePeak.status,
      balanceStrong: strong,
      balanceMild: mild,
      width: widthIssue,
      referenceGap: referenceGap,
    });

    return {
      raw: raw,
      laneId: lane === analyzeApi.LANES.neuro ? "neuro" : lane === analyzeApi.LANES.rollers ? "rollers" : "dnb",
      laneLabel: lane.label,
      bands: bands,
      balanceStrong: strong,
      balanceMild: mild,
      kickUnheard: kickUnheard,
      width: width,
      widthIssue: widthIssue,
      reference: referenceRaw ? { raw: referenceRaw, loudDelta: loudDelta, peakDelta: peakDelta, gap: referenceGap } : null,
      comparedTo: useRef ? "reference" : "profile",
      recommendation: choice,
      provisional: !!(raw.warnings && raw.warnings.indexOf("short") !== -1),
    };
  }

  function balanceNoun(view) {
    return view.comparedTo === "reference" ? "your reference" : "this lane's profile";
  }

  function balanceLine(band, noun) {
    var severe = band.severe;
    var lines = {
      sub: {
        high: severe ? "The sub is very heavy against " + noun + "." : "The sub is heavier than " + noun + ".",
        low: severe ? "The sub is very light against " + noun + "." : "The sub is light against " + noun + ".",
      },
      bass: {
        high: "The kick-and-bass band is louder than " + noun + ".",
        low: severe ? "The body of the bass, just above the sub, is very thin against " + noun + "." : "The body of the bass, just above the sub, is thin against " + noun + ".",
      },
      lowmid: {
        high: "Low-mids are piled up against " + noun + ". That is the crowded zone between the bass and the snare. Boxy, if your ears agree.",
        low: "Low-mids are scooped against " + noun + ". That can read as clean, or as hollow, once you listen.",
      },
      presence: {
        high: "Presence is hot against " + noun + ". Hats, snare crack, and bass bite may be wearing you out.",
        low: "Presence is shy against " + noun + ". The top of the snare and the bass grit are sitting back.",
      },
      air: {
        high: "The air band is bright against " + noun + ".",
        low: severe ? "The top end is very dark against " + noun + "." : "The top end is dark against " + noun + ".",
      },
    };
    var group = lines[band.id];
    if (!group || band.tone === "close" || band.tone === "unavailable") return null;
    var against = noun === "your reference" ? "vs your reference." : "vs the profile.";
    return group[band.tone] + " (" + signedDb(band.errorDb) + " dB " + against + ")";
  }

  function findingBits(view) {
    var raw = view.raw;
    var bits = [];
    if (raw.mono.status === "drops") bits.push("the sub drops out in mono");
    else if (raw.mono.status === "thins") bits.push("the sub thins out in mono");
    if (raw.kick.status === "sub-on-kick") bits.push("the sub is sitting on the kick");
    else if (raw.kick.status === "kick-holes-sub") bits.push("the kick is punching a hole in the sub");
    else if (raw.kick.status === "fighting") bits.push("the kick and the sub are fighting");
    if (raw.truePeak.status === "over") bits.push("true peak is past 0 dBTP");
    else if (raw.truePeak.status === "hot") bits.push("true peak is over −1 dBTP");
    if (raw.loudness.band === "hot") bits.push("the level is hotter than the bass-music window");
    else if (raw.loudness.band === "quiet") bits.push("the level is under the streaming targets");
    if (view.balanceStrong + view.balanceMild > 0) {
      bits.push(view.comparedTo === "reference" ? "the balance leans off your reference" : "the balance leans off the " + view.laneLabel + " profile");
    }
    if (view.widthIssue === "top-wide") bits.push("the top is overly wide");
    else if (view.widthIssue === "top-narrow") bits.push("the top is overly narrow");
    else if (view.widthIssue === "narrow") bits.push("the whole picture is very narrow");
    else if (view.widthIssue === "phasey") bits.push("the stereo image is pulling apart");
    else if (view.widthIssue === "wide") bits.push("the stereo image is very wide");
    return bits;
  }

function alsoLine(view) {
  var bits = findingBits(view);
  if (bits.length < 2) return "";
  return " In the read: " + listJoin(bits) + ".";
}

  function nextStep(view) {
    var rec = view.recommendation;
    if (!rec || !rec.session) return null;
    var session = SESSIONS[rec.session];
    var heading = "";
    var body = "";
    var extra = alsoLine(view);

    if (rec.reason === "mono") {
      heading = "Walk through the mono sub.";
      body = "The sub drops out, or thins out, in mono. Headphones hide that. Thirty minutes is enough to open the low end, sum it, and leave with a phase move you can repeat. Quick Fix is that live walkthrough.";
    } else if (rec.reason === "masking") {
      heading = "Sit with the kick and the sub.";
      body = "The kick and the sub need a conversation: where the kick hits, where the sub sits, and how hard anything ducks. Thirty minutes on that part of the mix is enough to leave with a move you can repeat.";
    } else if (rec.reason === "low-end") {
      heading = "Walk through the low end.";
      body = "The low end is the whole story here. Mono, and the way the kick and the sub share space. One sitting, thirty minutes, on that part of the mix.";
    } else if (rec.reason === "peak") {
      heading = "Ease the ceiling off.";
      body = "True peak is over the line people aim for so a codec stays polite, and the rest of the picture is close. Thirty minutes to set the limiter and hear it back.";
    } else if (rec.reason === "width") {
      heading = "Walk through the stereo image.";
      body = widthBookingBody(view);
    } else if (rec.reason === "image") {
      heading = "Walk through the low end and the image.";
      body = "The low end and the stereo picture both need a look, and the rest is close. Thirty minutes can cover the mono sub and how wide the top sits.";
    } else if (rec.reason === "technical") {
      heading = "A couple of concrete things.";
      body = "The ceiling and the low end are the job, and the rest is close. Thirty minutes can cover both live: open the session, make the moves, hear them back.";
    } else if (rec.reason === "reference") {
      heading = "Sit it next to your reference.";
      body = referenceBookingBody(view);
    } else if (rec.reason === "polish") {
      heading = "This is close. Finish it properly.";
      body = view.comparedTo === "reference"
        ? "Loudness, true peak, the mono sub, the stereo image, and the balance against your reference are in a sensible place. What is left is taste, and a master that sits with that record. The one-hour session is a full track master, mix notes, and a revision."
        : "Loudness, true peak, the mono sub, the stereo image, and the lane balance are in a sensible place. What is left is taste, and a master that sits with the rest of the music. The one-hour session is a full track master, mix notes, and a revision.";
      if (view.kickUnheard) {
        body += " One limit: this bounce did not show a clear kick, so the all-clear covers the numbers that actually ran. When you want the drop heard properly, that same hour is the sitting.";
      }
    } else if (rec.reason === "loudness") {
      heading = "The level needs a real pass.";
      if (view.raw.loudness.band === "quiet") {
        body = "The shape is not the fire. The level is. This sits under the usual streaming targets, and under the generic bass-music window. An hour covers a master pass, after a listen, in case the bounce is simply quiet or the file is mostly breakdown. A revision is included.";
      } else {
        body = "The shape is not the fire. The level is. This is hotter than the generic bass-music window, so the limiter is probably leaning on the mix, and streaming will turn it down anyway. An hour covers a master pass and a revision.";
      }
    } else if (rec.reason === "stacked") {
      heading = "This one wants a breakdown.";
      body = "Several things are stacked, and thirty minutes would turn into a rush. The Deep Dive is the mix breakdown: detailed mastering, and more than one format. 1.5 hours, $100.";
    } else {
      heading = "Sit with the whole mix.";
      body = view.comparedTo === "reference"
        ? "There is more than one thing between this mix and your reference. An hour is the mix consultation: listen to both, adjust, and leave with a master and a revision included."
        : "There is more than one thing to touch. An hour is the mix consultation: listen, adjust, and leave with a master and a revision included.";
    }

    if (view.provisional) {
      body += " This clip is only a few seconds long, so treat the numbers as a sketch of what you dropped in.";
    }

    return {
      kicker: "// Next step",
      heading: heading,
      body: body + extra,
      button: session.button,
      href: session.href,
      session: session.id,
      reason: rec.reason,
      note: "Opens the same calendar as the homepage, in a new tab, so this read stays put. Google Meet with Beny.",
    };
  }

  function loudnessCard(view) {
    var loud = view.raw.loudness;
    var lane = view.laneLabel;
    if (loud.band === "silent" || loud.integrated == null) {
      return {
        id: "loudness",
        title: "Loudness",
        tag: "Note",
        tone: "neutral",
        figure: "Too quiet to read",
        body: "Integrated loudness did not clear the silence gate. If the fader is down, or this is a blank bounce, there is nothing to compare with a streaming target.",
        notes: [],
      };
    }
    var figure = formatLufs(loud.integrated);
    var body;
    if (loud.band === "bass-window") {
      body = "Integrated loudness is " + figure + ". That sits in the generic bass-music window this page uses, about −10 to −7 LUFS. The window is a labeled range for this kind of master. It is not a measurement of any released record. Spotify and YouTube still tend to turn playback toward about −14 LUFS, and Apple Music toward about −16. Getting turned down is normal in " + lane + ". Loud is a number. Heavy is a feeling.";
    } else if (loud.band === "streaming") {
      body = "Integrated loudness is " + figure + ". That is nearer the streaming targets — about −14 LUFS on Spotify and YouTube, about −16 on Apple Music — than the hotter generic bass-music window of −10 to −7. A fair place to sit if you want the service to leave the level alone. If the drop feels small next to other " + lane + " tracks, this is the first number to listen against.";
    } else if (loud.band === "hot") {
      body = "Integrated loudness is " + figure + ". Hotter than the generic bass-music window of −10 to −7 LUFS. Streaming will turn it down, and the limiter is probably leaning on the mix. Loud is a number. Heavy is a feeling.";
    } else {
      body = "Integrated loudness is " + figure + ". That is under the usual streaming targets, and well under the generic bass-music window of −10 to −7 LUFS. It may be a quiet bounce, a long breakdown in the file, or a mix that is still on the way. Listen before you chase a limiter.";
    }
    var notes = ["The number averages the whole file, quiet intro included. To judge the drop on its own, bounce the drop and read that."];
    if (loud.range != null && isFinite(loud.range)) {
      var lra = round1(loud.range);
      if (lra < 2) {
        notes.push("The level barely moves across the file (about " + lra.toFixed(1) + " LU from quiet to loud). Expected on a loop. On a full track, it means the breakdown is as loud as the drop, or this bounce is only the loud section.");
      } else if (lra > 8) {
        notes.push("Quiet to loud spans about " + lra.toFixed(1) + " LU. On a full arrangement that is often the breakdown against the drop.");
      } else {
        notes.push("Quiet to loud spans about " + lra.toFixed(1) + " LU.");
      }
    }
    if (view.reference && view.reference.loudDelta != null && view.reference.raw.loudness.integrated != null) {
      var delta = view.reference.loudDelta;
      var refFigure = formatLufs(view.reference.raw.loudness.integrated);
      if (Math.abs(delta) < 0.5) notes.push("Your reference is at " + refFigure + ". This mix is within half a LU of it.");
      else notes.push("Your reference is at " + refFigure + ". This mix is " + Math.abs(delta).toFixed(1) + " LU " + (delta > 0 ? "louder" : "quieter") + ".");
    }
    var tone = loud.band === "hot" || loud.band === "quiet" ? "watch" : loud.band === "bass-window" ? "ok" : "neutral";
    var tag = tone === "watch" ? "Look here" : tone === "ok" ? "In range" : "Note";
    return { id: "loudness", title: "Loudness", tag: tag, tone: tone, figure: figure, body: body, notes: notes };
  }

  function peakCard(view) {
    var peak = view.raw.truePeak;
    var figure = formatDbtp(peak.dbtp);
    var body;
    if (peak.status === "safe") {
      body = "Estimated true peak is " + figure + ". That is at or under −1 dBTP, which leaves a little room so an MP3 or AAC is less likely to invent an over.";
    } else if (peak.status === "hot") {
      body = "Estimated true peak is " + figure + ". That is above −1 dBTP. The WAV can look fine while a codec still clips. Worth easing the limiter.";
    } else {
      body = "Estimated true peak is " + figure + ". The oversampled read is already past 0. That is a ceiling problem.";
    }
    var notes = ["Estimated in the browser with 4× oversampling. Enough to decide. A dedicated true-peak meter is the last word when you print the master."];
    if (isFinite(peak.sampleDbfs) && peak.dbtp - peak.sampleDbfs > 0.4) {
      notes.push("Sample peak is " + signedDb(peak.sampleDbfs) + " dBFS, so the extra level is between the samples.");
    }
    if (view.raw.warnings && view.raw.warnings.indexOf("mp3") !== -1) {
      notes.push("This file was an MP3, decoded by the browser before the read, so the peak is one step removed from a WAV bounce.");
    }
    if (view.reference && view.reference.peakDelta != null && isFinite(view.reference.raw.truePeak.dbtp)) {
      var peakDelta = view.reference.peakDelta;
      var refPeak = formatDbtp(view.reference.raw.truePeak.dbtp);
      if (Math.abs(peakDelta) < 0.3) notes.push("Your reference true peak is " + refPeak + ". This mix is within 0.3 dB of that.");
      else notes.push("Your reference true peak is " + refPeak + ". This mix is " + Math.abs(peakDelta).toFixed(1) + " dB " + (peakDelta > 0 ? "hotter" : "lower") + " at the ceiling.");
    }
    var tone = peak.status === "safe" ? "ok" : "watch";
    return {
      id: "peak",
      title: "True peak",
      tag: tone === "ok" ? "In range" : "Look here",
      tone: tone,
      figure: figure,
      body: body,
      notes: notes,
    };
  }

  function monoCard(view) {
    var mono = view.raw.mono;
    if (mono.status === "na") {
      return {
        id: "mono",
        title: "Low end in mono",
        tag: "Note",
        tone: "neutral",
        figure: "Already mono",
        body: "This bounce is already mono, so there is no left/right pair to cancel. The sub in the file is the sub a summed system will get.",
        notes: [],
      };
    }
    if (mono.status === "quiet") {
      return {
        id: "mono",
        title: "Low end in mono",
        tag: "Note",
        tone: "neutral",
        figure: "Not enough sub",
        body: "There is not enough energy under 120 Hz to judge mono compatibility. If the bass is meant to be in this bounce, it is missing. If this is a breakdown, that fits.",
        notes: [],
      };
    }
    var figure = mono.status === "holds" ? "Holds" : mono.status === "thins" ? "Thins out" : "Drops out";
    var body;
    if (mono.status === "holds") {
      body = "The low end holds up in mono. Under about 120 Hz, the left and the right mostly agree, so a phone, a club rig, or a summed speaker should still have the sub.";
    } else if (mono.status === "thins") {
      body = "The low end thins out in mono. It does not fully cancel, but some of the sub is living in the side. Headphones will sound bigger than a system that sums to one channel.";
    } else {
      body = "The sub is disappearing in mono. A real slice of the low end cancels when left and right are added. Headphones hide this. A club, a phone, a car: that weight will not show up the way it does in the studio.";
    }
    var notes = [];
    if (mono.correlation != null && isFinite(mono.correlation)) {
      notes.push("Left/right agreement under 120 Hz: " + mono.correlation.toFixed(2) + ". Near 1, both sides match. Near 0, they are unrelated. Negative means they are cancelling.");
    }
    if (view.reference && view.reference.raw.mono) {
      var refMono = view.reference.raw.mono.status;
      var monoWord = { holds: "holds in mono", thins: "thins out in mono", drops: "drops out in mono", quiet: "does not have enough sub to judge", na: "is already mono" };
      if (refMono === "na") notes.push("The reference file is mono, so it has no left/right low end to compare.");
      else if (refMono === mono.status) notes.push("Your reference " + (monoWord[refMono] || "reads the same") + ", and so does this mix.");
      else notes.push("Your reference " + (monoWord[refMono] || "reads differently") + ". This mix " + (monoWord[mono.status] || "reads differently") + ".");
    }
    var tone = mono.status === "holds" ? "ok" : "watch";
    return {
      id: "mono",
      title: "Low end in mono",
      tag: tone === "ok" ? "In range" : "Look here",
      tone: tone,
      figure: figure,
      body: body,
      notes: notes,
    };
  }

  function kickCard(view) {
    var status = view.raw.kick.status;
    var map = {
      readable: {
        figure: "Readable",
        tone: "ok",
        tag: "In range",
        body: "Kick and sub are giving each other some room. The low end has punch, not only a constant rumble, and the sub is not vanishing on every hit.",
      },
      "sub-on-kick": {
        figure: "Sub on the kick",
        tone: "watch",
        tag: "Look here",
        body: "The sub is sitting on the kick. Energy down low is high, and not much punch pokes through it. The kick may be in the mix. It is not getting a moment of its own.",
      },
      "kick-holes-sub": {
        figure: "Hole in the sub",
        tone: "watch",
        tag: "Look here",
        body: "The kick is punching a hole in the sub. When the hit lands, the low end ducks hard enough that the roll can feel like it drops out.",
      },
      fighting: {
        figure: "Fighting",
        tone: "watch",
        tag: "Look here",
        body: "Kick and sub are in each other's way. The low end piles up and then gives way, and neither one is easy to follow.",
      },
      "no-kick": {
        figure: "No kick found",
        tone: "neutral",
        tag: "Note",
        body: "No clear kick transient showed up in this bounce. It may be a breakdown, a bass loop, or a kick with no attack. Masking is not something this read can call from that.",
      },
      "no-sub": {
        figure: "No sub to weigh",
        tone: "neutral",
        tag: "Note",
        body: "There is not a steady low end to compare with a kick. The balance section is where a missing sub shows up.",
      },
      unclear: {
        figure: "Hard to separate",
        tone: "neutral",
        tag: "Note",
        body: "The low end does not separate cleanly into a kick and a sub from the bounce alone. Listen on a system you trust before you move a fader.",
      },
    };
    var picked = map[status] || map.unclear;
    var kickNotes = ["This is punch and energy only. It cannot hear whether the kick sample is the right one, or whether the groove shuffles."];
    if (view.reference && view.reference.raw.kick) {
      var refKick = view.reference.raw.kick.status;
      var refPicked = map[refKick] || map.unclear;
      var shaky = { "no-kick": 1, "no-sub": 1, unclear: 1, na: 1 };
      if (shaky[status] || shaky[refKick]) {
        kickNotes.push("Kick and sub is a shaky comparison against the reference. One of the files did not show a kick and a sub the meter could separate, so that part stays with your ears.");
      } else if (refKick === status) {
        kickNotes.push("Your reference reads the same way on kick and sub.");
      } else {
        kickNotes.push("Your reference reads as " + refPicked.figure.toLowerCase() + ". This mix reads as " + picked.figure.toLowerCase() + ".");
      }
    }
    return {
      id: "kick",
      title: "Kick and sub",
      tag: picked.tag,
      tone: picked.tone,
      figure: picked.figure,
      body: picked.body,
      notes: kickNotes,
    };
  }

  function corrText(n) {
    if (n == null || !isFinite(n)) return "unavailable";
    var v = Math.round(n * 100) / 100;
    return (v < 0 ? "−" : "") + Math.abs(v).toFixed(2);
  }

  function widthCard(view) {
    var w = view.width || emptyWidth();
    if (w.overall.status === "na") {
      return {
        id: "width",
        title: "Stereo width",
        tag: "Note",
        tone: "neutral",
        figure: "Already mono",
        body: "This bounce is mono, so there is no width to measure. Left and right are the same signal. A meter cannot hear a stereo picture that is not there.",
        notes: [],
      };
    }
    var overallLine = "Overall correlation is " + corrText(w.overall.correlation) + ". ";
    if (w.overall.status === "ok") overallLine += "That is a normal stereo picture for a full mix. The number gets pulled toward whatever is loudest, usually the low end.";
    else if (w.overall.status === "narrow") overallLine += "Almost the whole mix is center. Fine if that is the idea. It will not sound wide on headphones.";
    else if (w.overall.status === "wide") overallLine += "The whole file is very wide, or the sides are barely agreeing.";
    else if (w.overall.status === "phasey") overallLine += "Parts of the mix are pulling against each other, not just sitting wide.";
    else overallLine += "There is not enough level to judge the overall width.";

    var lowLine;
    if (w.low.status === "narrow") lowLine = "Under 120 Hz the correlation is " + corrText(w.low.correlation) + ". The sub is narrow enough to hold up in mono.";
    else if (w.low.status === "wide") lowLine = "Under 120 Hz the correlation is " + corrText(w.low.correlation) + ". The sub has some width. It may thin out a little when a club or a phone sums it. That is not a full cancellation.";
    else if (w.low.status === "too-wide") lowLine = "Under 120 Hz the correlation is " + corrText(w.low.correlation) + ". The sub is too wide. Headphones hide that. A summed system will not keep the weight. The mono read is the same fact, from the other direction.";
    else lowLine = "There is not enough under 120 Hz to judge how narrow the sub is.";

    var topLine;
    if (w.top.status === "ok") topLine = "Above about 4 kHz the correlation is " + corrText(w.top.correlation) + ". The top has width, and the sides still agree enough that it should hold together on a speaker.";
    else if (w.top.status === "narrow") topLine = "Above about 4 kHz the correlation is " + corrText(w.top.correlation) + ". The hats and the air are stacked in the center. The mix can sound small even when the sub is fine.";
    else if (w.top.status === "too-wide") topLine = "Above about 4 kHz the correlation is " + corrText(w.top.correlation) + ". The top is wider than it is stable. Wideners and short delays do this. On a speaker it can turn washy.";
    else topLine = "There is not enough above 4 kHz to judge the width up top. If the air was filtered on purpose, that fits. The meter will not invent a verdict.";

    var tone = "ok";
    var tag = "In range";
    var figure = "Sub narrow, top open";
    if (w.low.status === "too-wide") {
      tone = "watch"; tag = "Look here"; figure = "Sub is wide";
    } else if (w.low.status === "wide") {
      tone = "neutral"; tag = "Note"; figure = "Sub is a bit wide";
    } else if (w.top.status === "too-wide") {
      tone = "watch"; tag = "Look here"; figure = "Wide up top";
    } else if (w.top.status === "narrow") {
      tone = "watch"; tag = "Look here"; figure = "Narrow up top";
    } else if (w.overall.status === "phasey") {
      tone = "watch"; tag = "Look here"; figure = "Pulling apart";
    } else if (w.low.status === "quiet" || w.top.status === "quiet") {
      tone = "neutral"; tag = "Note"; figure = w.low.status === "narrow" ? "Sub narrow" : "Hard to judge";
    }

    var notes = ["Correlation near 1 is narrow. Near 0 is wide. Negative means the sides are cancelling. This does not hear whether the width feels good. It hears whether the sides agree."];
    if (w.overall.status === "narrow" && w.top.status === "ok") {
      notes.push("The overall number can look narrow while the top still has width. The low end is usually the loudest part of the file, and it pulls that one number up.");
    }
    if (view.reference && view.reference.raw.width && view.reference.raw.width.overall.status !== "na") {
      var rw = view.reference.raw.width;
      if (rw.top.status === "quiet" && w.top.status === "quiet") {
        notes.push("Neither file has enough above 4 kHz to compare the width up top.");
      } else if (rw.top.correlation != null && w.top.correlation != null && rw.top.status !== "quiet" && w.top.status !== "quiet") {
        var topDelta = w.top.correlation - rw.top.correlation;
        var topWay = Math.abs(topDelta) < 0.08 ? "about the same width up top as your reference" : (topDelta < 0 ? "wider up top than your reference" : "narrower up top than your reference");
        notes.push("Above 4 kHz, your reference is " + corrText(rw.top.correlation) + " and this mix is " + corrText(w.top.correlation) + ". This mix is " + topWay + ".");
      }
      if (rw.low.correlation != null && w.low.correlation != null && rw.low.status !== "quiet" && w.low.status !== "quiet") {
        notes.push("Sub correlation is " + corrText(w.low.correlation) + " here and " + corrText(rw.low.correlation) + " on the reference.");
      }
    } else if (view.reference && view.reference.raw.width && view.reference.raw.width.overall.status === "na") {
      notes.push("The reference file is mono, so it has no stereo image to match. The width above is about your mix alone.");
    }
    return {
      id: "width",
      title: "Stereo width",
      tag: tag,
      tone: tone,
      figure: figure,
      body: overallLine + " " + lowLine + " " + topLine,
      notes: notes,
    };
  }

  function widthBookingBody(view) {
    if (view.reference && view.reference.gap === "width" && !view.widthIssue) {
      return "The level and the balance are close. The stereo picture is the gap against your reference. Thirty minutes is enough to open the image, keep the sub narrow, and hear it against that file.";
    }
    if (view.widthIssue === "top-wide") return "The top is the thing standing out: wider than it is stable, and the rest of the picture is close. Thirty minutes to pull the hats and the air back in until they survive a speaker, not only headphones.";
    if (view.widthIssue === "top-narrow") return "The top is stacked in the center, and the rest is close. Thirty minutes on how wide the hats and the air should sit, without smearing the sub.";
    if (view.widthIssue === "narrow") return "Almost the whole mix is center, including the top. Thirty minutes if you want width that still keeps the sub mono.";
    if (view.widthIssue === "phasey") return "The sides are pulling apart, and it is not only the sub. Thirty minutes to find what is widening the mix and put the picture back together.";
    return "The stereo image is the clear difference, and the rest is close. Thirty minutes to walk through it live.";
  }

  function referenceBookingBody(view) {
    var ref = view.reference;
    var bits = [];
    if (ref && ref.loudDelta != null && Math.abs(ref.loudDelta) >= 3) {
      bits.push("this mix is " + Math.abs(ref.loudDelta).toFixed(1) + " LU " + (ref.loudDelta > 0 ? "louder" : "quieter"));
    }
    if (view.balanceStrong + view.balanceMild > 0) bits.push("the balance does not sit with it");
    if (view.widthIssue || (ref && ref.gap === "width")) bits.push("the stereo image does not match");
    var detail = bits.length ? "In the gap: " + listJoin(bits) + ". " : "";
    return "Your reference and this mix are not sitting together. " + detail + "An hour is the sitting: both files up, a mix pass, and a revision.";
  }

  function balanceCard(view) {
    var leans = [];
    var unavailable = 0;
    for (var i = 0; i < view.bands.length; i++) {
      if (view.bands[i].tone === "unavailable") {
        unavailable++;
        continue;
      }
      var line = balanceLine(view.bands[i], balanceNoun(view));
      if (line) leans.push(line);
    }
    var lane = view.laneLabel;
    var notes = leans.slice();
    var body;
    var tone;
    var figure;
    var tag;
    var againstRef = view.comparedTo === "reference";
    if (unavailable === view.bands.length) {
      body = againstRef
        ? "There is not enough of a full-spectrum mix here to compare with your reference."
        : "There is not enough of a full-spectrum mix here to compare with the " + lane + " profile.";
      tone = "neutral";
      figure = "No comparison";
      tag = "Note";
    } else if (!leans.length) {
      body = againstRef
        ? "Nothing in the balance is shouting. The shape is close to your reference. That file is the comparison. Nothing commercial is built into this page."
        : "Nothing in the balance is shouting. The shape is close to the generic " + lane + " profile: a labeled shape for this page, not a commercial record, and not a measurement of someone else's master.";
      tone = "ok";
      figure = againstRef ? "Close to your reference" : "Close to the profile";
      tag = "In range";
    } else {
      body = againstRef
        ? "Set next to your reference bounce. A few dB is a lean. Your ears still decide. The generic lane profile is not in this comparison."
        : "Set next to a generic " + lane + " profile. That profile is a labeled shape for this page. It is not a commercial record, and it is not a measurement of someone else's master. A few dB is a lean. Your ears still decide.";
      tone = view.balanceStrong > 0 ? "watch" : "neutral";
      figure = leans.length === 1 ? "1 band off" : leans.length + " bands off";
      tag = tone === "watch" ? "Look here" : "Note";
      if (view.balanceStrong >= 4) {
        notes.push(againstRef
          ? "A lot of the spectrum is away from your reference. That can be a different section of the tune, or a mix that is still raw. It is not a grade."
          : "A lot of the spectrum is away from the profile. That happens with a raw loop, a breakdown, or a lane that does not match the music. It is not a grade.");
      }
    }
    if (view.raw.source === "mp3") {
      notes.push("MP3s already shave the top. A dark air band on an MP3 is a weak reason to change the mix.");
    }
    return {
      id: "balance",
      title: view.comparedTo === "reference" ? "Balance against your reference" : "Balance for this lane",
      tag: tag,
      tone: tone,
      figure: figure,
      body: body,
      notes: notes,
    };
  }

  function limitsCard() {
    return {
      id: "limits",
      title: "What this didn't hear",
      tag: "Always",
      tone: "neutral",
      figure: "Groove, arrangement, sound choice",
      body: "MixCheck did not listen to the groove, the arrangement, or the sound choice. It cannot tell you if the drop earns the build, if the bass preset is the one, or if the tune should exist. Those are the reasons to sit with another producer. The numbers above are only the numbers.",
      notes: [],
    };
  }

  function warningLines(raw) {
    var lines = [];
    if (!raw.warnings) return lines;
    if (raw.warnings.indexOf("short") !== -1) {
      lines.push("That clip is under five seconds. Loudness on a snippet is a sketch of the snippet, not of the arrangement.");
    }
    if (raw.warnings.indexOf("multichannel") !== -1) {
      lines.push("This file has more than two channels. The read used the first two.");
    }
    return lines;
  }

  function buildView(raw, laneId, reference) {
    var referenceRaw = reference && reference.raw ? reference.raw : null;
    var view = interpret(raw, laneId, referenceRaw);
    var rateLabel = raw.sampleRate === 44100 ? "44.1 kHz" : raw.sampleRate === 48000 ? "48 kHz" : raw.sampleRate === 88200 ? "88.2 kHz" : raw.sampleRate === 96000 ? "96 kHz" : (raw.sampleRate / 1000).toFixed(1) + " kHz";
    var warnings = warningLines(raw);
    if (referenceRaw && view.comparedTo !== "reference") {
      warnings.push("The reference did not have enough of a full mix to compare against, so the lane profile was used.");
    }
    var compareLabel = view.comparedTo === "reference"
      ? "next to " + ((reference && reference.name) || "your reference")
      : "generic " + view.laneLabel + " profile";
    return {
      laneId: view.laneId,
      laneLabel: view.laneLabel,
      compareLabel: compareLabel,
      summary: formatDuration(raw.durationSec) + " · " + rateLabel + " · " + (raw.channels > 1 ? "stereo" : "mono") + " · " + (raw.source === "mp3" ? "MP3" : "WAV"),
      warnings: warnings,
      cards: [loudnessCard(view), peakCard(view), monoCard(view), widthCard(view), kickCard(view), balanceCard(view), limitsCard()],
      next: nextStep(view),
      recommendation: view.recommendation,
    };
  }

  return {
    SESSIONS: SESSIONS,
    buildView: buildView,
    interpret: interpret,
  };
});
