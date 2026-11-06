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

  function interpret(raw, laneId) {
    var lane = analyzeApi.LANES[laneId] || analyzeApi.LANES.dnb;
    var source = raw.source;
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
      var error = relative - (lane.target[meta.id] || 0);
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
    var choice = analyzeApi.chooseSession({
      silent: raw.loudness.band === "silent",
      loudness: raw.loudness.band,
      mono: raw.mono.status,
      kick: raw.kick.status,
      peak: raw.truePeak.status,
      balanceStrong: strong,
      balanceMild: mild,
    });

    return {
      raw: raw,
      laneId: lane === analyzeApi.LANES.neuro ? "neuro" : lane === analyzeApi.LANES.rollers ? "rollers" : "dnb",
      laneLabel: lane.label,
      bands: bands,
      balanceStrong: strong,
      balanceMild: mild,
      kickUnheard: kickUnheard,
      recommendation: choice,
      provisional: !!(raw.warnings && raw.warnings.indexOf("short") !== -1),
    };
  }

  function balanceLine(band) {
    var severe = band.severe;
    var lines = {
      sub: {
        high: severe ? "The sub is very heavy against this lane's profile." : "The sub is heavier than this lane's profile.",
        low: severe ? "The sub is very light for this lane." : "The sub is light for this lane.",
      },
      bass: {
        high: "The kick-and-bass band is louder than the profile.",
        low: severe ? "The body of the bass, just above the sub, is very thin." : "The body of the bass, just above the sub, is thin.",
      },
      lowmid: {
        high: "Low-mids are piled up. That is the crowded zone between the bass and the snare. Boxy, if your ears agree.",
        low: "Low-mids are scooped against the profile. That can read as clean, or as hollow, once you listen.",
      },
      presence: {
        high: "Presence is hot. Hats, snare crack, and bass bite may be wearing you out.",
        low: "Presence is shy. The top of the snare and the bass grit are sitting back.",
      },
      air: {
        high: "The air band is bright for this lane.",
        low: severe ? "The top end is very dark for this lane." : "The top end is dark for this lane.",
      },
    };
    var group = lines[band.id];
    if (!group || band.tone === "close" || band.tone === "unavailable") return null;
    return group[band.tone] + " (" + signedDb(band.errorDb) + " dB vs the profile.)";
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
    if (view.balanceStrong + view.balanceMild > 0) bits.push("the balance leans off the " + view.laneLabel + " profile");
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
    } else if (rec.reason === "technical") {
      heading = "A couple of concrete things.";
      body = "The ceiling and the low end are the job, and the rest is close. Thirty minutes can cover both live: open the session, make the moves, hear them back.";
    } else if (rec.reason === "polish") {
      heading = "This is close. Finish it properly.";
      body = "Loudness, true peak, the mono sub, and the lane balance are in a sensible place. What is left is taste, and a master that sits with the rest of the music. The one-hour session is a full track master, mix notes, and a revision.";
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
      body = "There is more than one thing to touch. An hour is the mix consultation: listen, adjust, and leave with a master and a revision included.";
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
    return {
      id: "kick",
      title: "Kick and sub",
      tag: picked.tag,
      tone: picked.tone,
      figure: picked.figure,
      body: picked.body,
      notes: ["This is punch and energy only. It cannot hear whether the kick sample is the right one, or whether the groove shuffles."],
    };
  }

  function balanceCard(view) {
    var leans = [];
    var unavailable = 0;
    for (var i = 0; i < view.bands.length; i++) {
      if (view.bands[i].tone === "unavailable") {
        unavailable++;
        continue;
      }
      var line = balanceLine(view.bands[i]);
      if (line) leans.push(line);
    }
    var lane = view.laneLabel;
    var notes = leans.slice();
    var body;
    var tone;
    var figure;
    var tag;
    if (unavailable === view.bands.length) {
      body = "There is not enough of a full-spectrum mix here to compare with the " + lane + " profile.";
      tone = "neutral";
      figure = "No comparison";
      tag = "Note";
    } else if (!leans.length) {
      body = "Nothing in the balance is shouting. The shape is close to the generic " + lane + " profile: a labeled shape for this page, not a commercial record, and not a measurement of someone else's master.";
      tone = "ok";
      figure = "Close to the profile";
      tag = "In range";
    } else {
      body = "Set next to a generic " + lane + " profile. That profile is a labeled shape for this page. It is not a commercial record, and it is not a measurement of someone else's master. A few dB is a lean. Your ears still decide.";
      tone = view.balanceStrong > 0 ? "watch" : "neutral";
      figure = leans.length === 1 ? "1 band off" : leans.length + " bands off";
      tag = tone === "watch" ? "Look here" : "Note";
      if (view.balanceStrong >= 4) {
        notes.push("A lot of the spectrum is away from the profile. That happens with a raw loop, a breakdown, or a lane that does not match the music. It is not a grade.");
      }
    }
    if (view.raw.source === "mp3") {
      notes.push("MP3s already shave the top. A dark air band on an MP3 is a weak reason to change the mix.");
    }
    return {
      id: "balance",
      title: "Balance for this lane",
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

  function buildView(raw, laneId) {
    var view = interpret(raw, laneId);
    var rateLabel = raw.sampleRate === 44100 ? "44.1 kHz" : raw.sampleRate === 48000 ? "48 kHz" : raw.sampleRate === 88200 ? "88.2 kHz" : raw.sampleRate === 96000 ? "96 kHz" : (raw.sampleRate / 1000).toFixed(1) + " kHz";
    return {
      laneId: view.laneId,
      laneLabel: view.laneLabel,
      summary: formatDuration(raw.durationSec) + " · " + rateLabel + " · " + (raw.channels > 1 ? "stereo" : "mono") + " · " + (raw.source === "mp3" ? "MP3" : "WAV"),
      warnings: warningLines(raw),
      cards: [loudnessCard(view), peakCard(view), monoCard(view), kickCard(view), balanceCard(view), limitsCard()],
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
