(function () {
  var fileInput = document.getElementById("file");
  var dropzone = document.getElementById("dropzone");
  var dropTitle = document.getElementById("drop-title");
  var readButton = document.getElementById("read");
  var resetButton = document.getElementById("reset");
  var fileNote = document.getElementById("file-note");
  var progress = document.getElementById("progress");
  var progressBar = document.getElementById("progress-bar");
  var progressLabel = document.getElementById("progress-label");
  var errorBox = document.getElementById("error");
  var report = document.getElementById("report");
  var lanes = Array.prototype.slice.call(document.querySelectorAll(".lane"));

  var chosenFile = null;
  var lastRaw = null;
  var lane = "dnb";

  function selectedLane() {
    return lane;
  }

  function setLane(next) {
    lane = next;
    lanes.forEach(function (button) {
      var on = button.getAttribute("data-lane") === next;
      button.setAttribute("aria-checked", on ? "true" : "false");
    });
    if (lastRaw) render(MixCheckReport.buildView(lastRaw, lane));
  }

  lanes.forEach(function (button, index) {
    button.addEventListener("click", function () {
      setLane(button.getAttribute("data-lane"));
    });
    button.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      var dir = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      var next = lanes[(index + dir + lanes.length) % lanes.length];
      next.focus();
      setLane(next.getAttribute("data-lane"));
    });
  });

  function showError(message) {
    errorBox.hidden = !message;
    errorBox.textContent = message || "";
  }

  function setBusy(busy, label, fraction) {
    readButton.disabled = busy || !chosenFile;
    progress.hidden = !busy;
    if (typeof fraction === "number") progressBar.style.width = Math.round(fraction * 100) + "%";
    if (label) progressLabel.textContent = label;
    readButton.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function describeFile(file) {
    var mb = file.size / (1024 * 1024);
    dropTitle.textContent = file.name;
    fileNote.textContent = (mb >= 0.1 ? mb.toFixed(1) + " MB · " : "") + "Stays in this tab. Close the page and the file is gone.";
  }

  function takeFile(file) {
    if (!file) return;
    var name = (file.name || "").toLowerCase();
    var type = file.type || "";
    var ok = name.endsWith(".wav") || name.endsWith(".mp3") || name.endsWith(".wave") || type === "audio/mpeg" || type === "audio/wav" || type === "audio/wave" || type === "audio/x-wav";
    if (!ok) {
      showError("That file needs to be a WAV or an MP3.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      showError("That file is too big to read comfortably in the browser. Export a stereo WAV at 44.1 or 48 kHz, or a shorter bounce.");
      return;
    }
    chosenFile = file;
    describeFile(file);
    showError("");
    readButton.disabled = false;
  }

  fileInput.addEventListener("change", function () {
    takeFile(fileInput.files && fileInput.files[0]);
  });

  ["dragenter", "dragover"].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.add("is-dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (name) {
    dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      dropzone.classList.remove("is-dragover");
    });
  });
  dropzone.addEventListener("drop", function (event) {
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    takeFile(file);
  });
  document.addEventListener("dragover", function (event) { event.preventDefault(); });
  document.addEventListener("drop", function (event) { event.preventDefault(); });

  function errorMessage(err) {
    if (!err) return "Couldn't read that file. Export a standard stereo WAV or an MP3 and try again.";
    if (err.code === "too-big" || err.code === "too-long" || err.code === "bad-wav" || err.code === "empty") return err.message;
    return err.message || "Couldn't read that file. Export a standard stereo WAV or an MP3 and try again.";
  }

  async function decodeBrowser(arrayBuffer, source) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("This browser can't decode that file. Try a WAV, or a current version of Chrome, Firefox, or Safari.");
    var ctx = new Ctx();
    try {
      var audio = await ctx.decodeAudioData(arrayBuffer.slice(0));
      return {
        left: new Float32Array(audio.getChannelData(0)),
        right: audio.numberOfChannels > 1 ? new Float32Array(audio.getChannelData(1)) : null,
        sampleRate: audio.sampleRate,
        channels: audio.numberOfChannels,
        source: source,
      };
    } finally {
      if (ctx.close) await ctx.close();
    }
  }

  async function loadAudio(file) {
    var buffer = await file.arrayBuffer();
    var name = (file.name || "").toLowerCase();
    var isMp3 = name.endsWith(".mp3") || file.type === "audio/mpeg";
    if (!isMp3) {
      try {
        return MixCheck.parseWav(buffer);
      } catch (err) {
        if (name.endsWith(".wav") || name.endsWith(".wave")) throw err;
      }
    }
    return decodeBrowser(buffer, "mp3");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function render(view) {
    report.hidden = false;
    report.replaceChildren();

    var head = el("div", "report-head");
    head.appendChild(el("p", "kicker", "// The read"));
    var title = el("h2", null, chosenFile ? chosenFile.name : "Mix");
    head.appendChild(title);
    head.appendChild(el("p", "report-meta", "Lane: " + view.laneLabel + " · generic profile · " + view.summary));
    if (view.warnings && view.warnings.length) {
      var list = el("ul", "report-warnings");
      view.warnings.forEach(function (line) {
        list.appendChild(el("li", null, line));
      });
      head.appendChild(list);
    }
    report.appendChild(head);

    view.cards.forEach(function (card) {
      var article = el("article", "finding");
      article.dataset.tone = card.tone;
      var header = el("header");
      header.appendChild(el("h3", null, card.title));
      header.appendChild(el("p", "finding-tag", card.tag));
      article.appendChild(header);
      article.appendChild(el("p", "finding-figure", card.figure));
      article.appendChild(el("p", "finding-body", card.body));
      if (card.notes && card.notes.length) {
        var notes = el("ul", "finding-notes");
        card.notes.forEach(function (note) {
          notes.appendChild(el("li", null, note));
        });
        article.appendChild(notes);
      }
      report.appendChild(article);
    });

    if (view.next) {
      var aside = el("aside", "next-step");
      aside.appendChild(el("p", "kicker", view.next.kicker));
      aside.appendChild(el("h3", null, view.next.heading));
      aside.appendChild(el("p", null, view.next.body));
      var link = el("a", "btn btn-primary", view.next.button);
      link.href = view.next.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.dataset.session = view.next.session;
      link.dataset.reason = view.next.reason;
      aside.appendChild(link);
      aside.appendChild(el("p", "next-step-note", view.next.note));
      report.appendChild(aside);
    } else {
      var empty = el("aside", "next-step");
      empty.appendChild(el("p", "kicker", "// Next step"));
      empty.appendChild(el("h3", null, "Nothing here to book against."));
      empty.appendChild(el("p", null, "The file is effectively silent. Bounce the mix and read it again."));
      report.appendChild(empty);
    }

    resetButton.hidden = false;
    title.setAttribute("tabindex", "-1");
    title.focus();
  }

  readButton.addEventListener("click", async function () {
    if (!chosenFile) return;
    showError("");
    report.hidden = true;
    setBusy(true, "Reading the file", 0.02);
    try {
      var audio = await loadAudio(chosenFile);
      setBusy(true, "Reading the mix", 0.08);
      lastRaw = await MixCheck.analyze(audio, {
        onProgress: function (fraction) {
          var label = fraction < 0.45 ? "Checking loudness" : fraction < 0.8 ? "Checking the low end" : "Writing the read";
          setBusy(true, label, 0.08 + fraction * 0.9);
        },
      });
      render(MixCheckReport.buildView(lastRaw, selectedLane()));
      setBusy(false);
    } catch (err) {
      lastRaw = null;
      setBusy(false);
      showError(errorMessage(err));
    }
  });

  resetButton.addEventListener("click", function () {
    chosenFile = null;
    lastRaw = null;
    fileInput.value = "";
    dropTitle.textContent = "Drop a stereo WAV or MP3";
    fileNote.textContent = "Stays in this tab. Close the page and the file is gone.";
    report.hidden = true;
    report.replaceChildren();
    resetButton.hidden = true;
    showError("");
    readButton.disabled = true;
    dropzone.focus();
  });
})();
