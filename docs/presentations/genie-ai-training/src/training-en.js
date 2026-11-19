(() => {
  let motionReduced = matchMedia("(prefers-reduced-motion: reduce)").matches ||
    new URLSearchParams(location.search).has("reduced");
  const motionButton = document.querySelector("#deck-motion");
  function updateMotionControl() {
    document.documentElement.classList.toggle("reduced-motion", motionReduced);
    motionButton.textContent = motionReduced ? "Resume motion" : "Pause motion";
  }
  updateMotionControl();
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
    doc.querySelector("h1").textContent = slide.querySelector("h1").textContent;
    doc.querySelector(".section-info").textContent =
      `${slide.dataset.position} / ${slide.dataset.total} · ${slide.dataset.chapter} · ${slide.dataset.timing}`;
    doc.querySelector(".speaker").textContent = slide.querySelector(".notes").textContent;
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
    notesWindow = window.open("", "GenieAiSpeakerNotes", "popup,width=690,height=475");
    if (!notesWindow) return;
    const doc = notesWindow.document;
    doc.open();
    doc.write(`<!doctype html><html lang="en"><meta charset="utf-8"><title>GENIE.AI · Speaker notes</title><style>body{margin:28px;font:20px/1.4 system-ui;color:#13224b;background:#f7f8fd}h1{font-size:29px;line-height:1.1}.clock{font:700 32px monospace}.section-info{font-size:15px;color:#5a6884}button{font:600 15px system-ui;margin:0 8px 0 0;padding:6px 10px}</style><div class="clock"></div><p class="section-info"></p><h1></h1><p class="speaker"></p><button id="back">Previous</button><button id="forward">Next</button><button id="reset">Reset timer</button></html>`);
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
  deck.addKeyBinding({keyCode: 77, key: "M", description: "Pause or resume motion"}, toggleMotion);
  document.querySelector("#go-full").addEventListener("click", (event) => {
    event.currentTarget.blur();
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });
  ["ready", "slidechanged"].forEach((event) => deck.on(event, enterSlide));
  ["fragmentshown", "fragmenthidden"].forEach((event) => deck.on(event, changeStep));
  deck.initialize();

})();
