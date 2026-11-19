(() => {
  // The translations travel with the deck: one slot per piece of text, and
  // every language holds the same slots. Switching a language rewrites the
  // text of the slots already in the page — the layout never moves.
  const bundle = JSON.parse(document.getElementById("deck-i18n").textContent);
  const languages = bundle.languages;
  const direction = Object.fromEntries(languages.map((locale) => [locale.code, locale.dir]));
  let language = languages[0].code;

  // A Latin word inside a right-to-left sentence is a bidi island: the
  // browser would otherwise place the neutral characters around it on the
  // wrong side. The run is marked as left-to-right and isolated, so
  // "GENIE.AI · ITU" stays readable inside an Arabic line.
  const LATIN = /[A-Za-z0-9]/;
  // A separator belongs to the run it follows, but a trailing one
  // belongs to the sentence: the full stop of an Arabic sentence must
  // not be swallowed by the Latin name before it.
  const INNER_NEUTRAL = /[.,:;!?()[\]{}<>/\\@#$%&*+=_|'"`~^·–—]/;
  const TRAILING_NEUTRAL = /[.,:;!?·–—]/;

  function writeText(node, value, rtl) {
    if (!rtl) {
      node.textContent = value;
      return;
    }
    node.replaceChildren();
    let index = 0;
    while (index < value.length) {
      const character = value[index];
      if (!LATIN.test(character) && !INNER_NEUTRAL.test(character)) {
        let end = index;
        while (end < value.length && !LATIN.test(value[end]) && !INNER_NEUTRAL.test(value[end])) end += 1;
        node.append(value.slice(index, end));
        index = end;
        continue;
      }
      let end = index;
      while (end < value.length && (LATIN.test(value[end]) || INNER_NEUTRAL.test(value[end]))) end += 1;
      let run = value.slice(index, end);
      // The sentence keeps its own full stop: it is not part of the
      // name that precedes it.
      let trailing = "";
      while (run.length > 1 && TRAILING_NEUTRAL.test(run[run.length - 1])) {
        trailing = run[run.length - 1] + trailing;
        run = run.slice(0, -1);
      }
      // A run made only of separators belongs to the surrounding script.
      if (!LATIN.test(run)) {
        node.append(run + trailing);
      } else {
        const island = document.createElement("span");
        island.setAttribute("dir", "ltr");
        island.textContent = run;
        node.append(island);
        if (trailing) node.append(trailing);
      }
      index = end;
    }
  }

  function sizeTitle(node) {
    // The title takes the largest size at which it still fits on the
    // lines the slide was drawn for. A translation is measured, not
    // counted: a Cyrillic or Arabic title is wider than a Latin one of
    // the same length, so the character count would lie.
    const steps = ["", "compact", "tight", "squeeze", "minimum"];
    for (const step of steps) {
      node.classList.remove("compact", "tight", "squeeze", "minimum");
      if (step) node.classList.add(step);
      const style = getComputedStyle(node);
      const height = node.getBoundingClientRect().height;
      const lines = Math.round(height / parseFloat(style.lineHeight));
      if (lines <= 1) return;
    }
  }

  function fitContent(section) {
    // The content of a slide was drawn to fit the space the English
    // text left. A translation that runs longer needs the room back:
    // the blocks shrink a step at a time until they fit.
    if (!section) return;
    const content = section.querySelector(".slide-content");
    const footer = section.querySelector(".slide-footer");
    if (!content || !footer) return;
    // A slide that is not on screen has no height to measure, so it is
    // measured in place: the reader reaches it later and the fit is
    // already right.
    const hidden = !section.classList.contains("present");
    const wasHidden = section.style.visibility;
    if (hidden) {
      section.style.visibility = "hidden";
      section.style.display = "block";
    }
    section.classList.remove("tight", "squeeze");
    for (const step of ["", "tight", "squeeze"]) {
      section.classList.remove("tight", "squeeze");
      if (step) section.classList.add(step);
      const last = content.lastElementChild;
      if (!last) break;
      const footerBox = footer.getBoundingClientRect();
      const overflow = last.getBoundingClientRect().bottom - footerBox.top;
      // The content must clear the footer, with a little air above it.
      if (overflow <= -7) break;
    }
    if (hidden) {
      section.style.visibility = wasHidden;
      section.style.display = "";
    }
  }

  function applyLanguage(code) {
    const slots = bundle.slots[code];
    if (!slots) return;
    const rtl = (direction[code] || "ltr") === "rtl";
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const value = slots[node.dataset.i18n];
      if (value !== undefined) writeText(node, value, rtl);
    });
    document.querySelectorAll("[data-i18n-alt]").forEach((node) => {
      const value = slots[node.dataset.i18nAlt];
      if (value !== undefined) node.alt = value;
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
      const value = slots[node.dataset.i18nAria];
      if (value !== undefined) node.setAttribute("aria-label", value);
    });
    document.querySelectorAll("[data-i18n-content]").forEach((node) => {
      const value = slots[node.dataset.i18nContent];
      if (value !== undefined) node.setAttribute("content", value);
    });
    document.documentElement.lang = code;
    document.documentElement.dir = direction[code] || "ltr";
    const title = slots["chrome.deck.title"];
    if (title) document.title = title;
    // A translated title can be longer than the English one, and a
    // Cyrillic or Arabic title is wider than a Latin one of the same
    // length. The size is therefore decided on the measured height of
    // the rendered title, not on its character count. A slide that is
    // not on screen has no height to measure, so it is measured in
    // place: the reader reaches it later and the size is already right.
    document.querySelectorAll(".slide-title").forEach((node) => {
      const value = slots[node.dataset.i18n];
      if (value === undefined) return;
      node.classList.remove("compact", "tight", "squeeze", "minimum");
      const section = node.closest("section");
      const hidden = section && !section.classList.contains("present");
      if (hidden) {
        const wasHidden = section.style.visibility;
        section.style.visibility = "hidden";
        section.style.display = "block";
        sizeTitle(node);
        section.style.visibility = wasHidden;
        section.style.display = "";
        return;
      }
      sizeTitle(node);
    });
    // A translation can need more room than the English text left. The
    // blocks of every slide shrink a step at a time until they fit.
    document.querySelectorAll(".slides > section.deck-slide").forEach(fitContent);
    // The takeaway sits above the footer: a translation that runs to a
    // second line would push it over the edge of the slide.
    document.querySelectorAll(".slide-takeaway").forEach((node) => {
      const value = slots[node.dataset.i18n];
      node.classList.toggle("compact", Boolean(value) && value.length >= bundle.compactTakeaway);
    });
    language = code;
    syncNotes();
    window.localStorage.setItem("genie-deck-language", code);
  }

  let motionReduced = matchMedia("(prefers-reduced-motion: reduce)").matches ||
    new URLSearchParams(location.search).has("reduced");
  const motionButton = document.querySelector("#deck-motion");
  function updateMotionControl() {
    document.documentElement.classList.toggle("reduced-motion", motionReduced);
    const slots = bundle.slots[language];
    motionButton.textContent = motionReduced ? slots["chrome.ui.resume"] : slots["chrome.ui.pause"];
  }
  const deck = new Reveal(document.querySelector(".reveal"), {
    width: 1280,
    height: 720,
    margin: 0,
    minScale: 0.15,
    maxScale: 2.5,
    controls: false,
    hash: true,
    progress: true,
    transition: motionReduced ? "none" : "fade",
    viewDistance: 2,
    transitionSpeed: "fast",
    autoAnimate: !motionReduced,
    autoAnimateDuration: 0.55,
    autoAnimateEasing: "ease-in-out",
    center: false,
    history: false
  });

  let notesWindow;
  let timerStart;
  let clock;
  function syncFocus() {
    const slide = deck.getCurrentSlide();
    if (!slide) return;
    const scene = slide.querySelector("[data-scene]");
    const current = scene?.querySelector(".stage-fragment.current-fragment");
    const index = current?.dataset.fragmentIndex;
    if (scene) {
      scene.classList.toggle("is-guided", Boolean(current));
      scene.style.setProperty("--current", index ?? "0");
      scene.dataset.active = index ?? "";
      scene.querySelectorAll("[data-light]").forEach((node) => {
        node.classList.toggle("is-target", Boolean(current) && node.dataset.light.split(" ").includes(index));
      });
    }
  }
  function enterSlide({previousSlide}) {
    const slide = deck.getCurrentSlide();
    previousSlide?.classList.remove("is-entering");
    const forward = !previousSlide || Number(slide.dataset.position) > Number(previousSlide.dataset.position);
    slide.classList.toggle("is-entering", !motionReduced && forward);
    fitContent(slide);
    syncFocus();
    syncNotes();
  }
  function changeStep() {
    deck.getCurrentSlide().classList.remove("is-entering");
    syncFocus();
  }
  function toggleMotion() {
    motionReduced = !motionReduced;
    deck.getCurrentSlide()?.classList.remove("is-entering");
    updateMotionControl();
    deck.configure({transition: motionReduced ? "none" : "fade", autoAnimate: !motionReduced});
  }
  function syncNotes() {
    if (!notesWindow || notesWindow.closed) return;
    const slide = deck.getCurrentSlide();
    if (!slide) return;
    const doc = notesWindow.document;
    const slots = bundle.slots[language];
    const rtl = (direction[language] || "ltr") === "rtl";
    doc.documentElement.lang = language;
    doc.documentElement.dir = direction[language] || "ltr";
    writeText(doc.querySelector("h1"), slide.querySelector("h1").textContent, rtl);
    doc.querySelector(".section-info").textContent =
      `${slide.dataset.position} / ${slide.dataset.total} · ${slide.dataset.chapter} · ${slide.dataset.timing}`;
    writeText(doc.querySelector(".speaker"), slide.querySelector(".notes").textContent, rtl);
    doc.querySelector("#back").textContent = slots["chrome.ui.previous"];
    doc.querySelector("#forward").textContent = slots["chrome.ui.next"];
    doc.querySelector("#reset").textContent = slots["chrome.ui.resetTimer"];
    doc.title = slots["chrome.ui.notesTitle"];
  }
  function updateClock() {
    if (!notesWindow || notesWindow.closed) {
      clearInterval(clock);
      return;
    }
    const seconds = Math.floor((Date.now() - timerStart) / 1000);
    const minutes = Math.floor(seconds / 60);
    notesWindow.document.querySelector(".clock").textContent =
      `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function openNotes() {
    if (notesWindow && !notesWindow.closed) {
      notesWindow.focus();
      return;
    }
    const slots = bundle.slots[language];
    notesWindow = window.open("", "GenieAiSpeakerNotes", "popup,width=690,height=475");
    if (!notesWindow) return;
    const doc = notesWindow.document;
    doc.open();
    doc.write(`<!doctype html><html lang="${language}" dir="${direction[language] || "ltr"}"><meta charset="utf-8"><title>${slots["chrome.ui.notesTitle"]}</title><style>body{margin:28px;font:20px/1.4 system-ui;color:#13224b;background:#f7f8fd}h1{font-size:29px;line-height:1.1}.clock{font:700 32px monospace}.section-info{font-size:15px;color:#5a6884}button{font:600 15px system-ui;margin:0 8px 0 0;padding:6px 10px}</style><div class="clock"></div><p class="section-info"></p><h1></h1><p class="speaker"></p><button id="back"></button><button id="forward"></button><button id="reset"></button></html>`);
    doc.close();
    timerStart ??= Date.now();
    doc.querySelector("#back").onclick = () => deck.prev();
    doc.querySelector("#forward").onclick = () => deck.next();
    doc.querySelector("#reset").onclick = () => { timerStart = Date.now(); updateClock(); };
    notesWindow.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") deck.next();
      if (e.key === "ArrowLeft") deck.prev();
    });
    syncNotes();
    updateClock();
    clearInterval(clock);
    clock = setInterval(updateClock, 250);
  }
  document.querySelector("#go-back").addEventListener("click", () => deck.prev());
  document.querySelector("#go-forward").addEventListener("click", () => deck.next());
  document.querySelector("#deck-notes").addEventListener("click", openNotes);
  motionButton.addEventListener("click", toggleMotion);
  const languageSelect = document.querySelector("#deck-language");
  languageSelect.addEventListener("change", () => applyLanguage(languageSelect.value));
  deck.addKeyBinding({keyCode: 77, key: "M", description: "Pause or resume motion"}, toggleMotion);
  document.querySelector("#go-full").addEventListener("click", (event) => {
    event.currentTarget.blur();
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });
  ["ready", "slidechanged"].forEach((event) => deck.on(event, enterSlide));
  ["fragmentshown", "fragmenthidden"].forEach((event) => deck.on(event, changeStep));

  // The reader's own choice wins; otherwise the browser's language is used
  // when the deck carries it.
  const stored = window.localStorage.getItem("genie-deck-language");
  const preferred = stored || navigator.language.split("-")[0];
  const initial = bundle.slots[preferred] ? preferred : languages[0].code;
  languageSelect.value = initial;
  applyLanguage(initial);
  updateMotionControl();
  deck.initialize().then(() => {
    // The slides only have their height once the deck is laid out, so
    // the fit of every slide is measured after that, not before.
    document.querySelectorAll(".slides > section.deck-slide").forEach(fitContent);
  });

})();
