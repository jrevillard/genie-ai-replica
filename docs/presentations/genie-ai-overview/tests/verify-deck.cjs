const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createServer } = require("node:http");
const { once } = require("node:events");

// The deck has two variants: the full briefing and the 30 minute one.
// They share the sources, so the checks that only make sense for the
// slides one of them leaves out run against the full deck alone.
const VARIANTS = {
  full: {
    path: "../../../../site/static/presentations/genie-ai/index.html",
    slides: 43,
    diagrams: 12,
    brands: 33,
    positions: {10: 12, 15: 17},
  },
  light: {
    path: "../../../../site/static/presentations/genie-ai-30/index.html",
    slides: 27,
    diagrams: 5,
    brands: 20,
    positions: {10: 11, 15: 13},
  },
};
const args = process.argv.slice(2);
const variant = (args.find(arg => arg.startsWith("--variant=")) || "--variant=full").split("=")[1];
const spec = VARIANTS[variant];
if (!spec) throw new Error("Unknown variant: " + variant);
const html = readFileSync(args.find(arg => !arg.startsWith("--")) || resolve(__dirname, spec.path), "utf8");

const bundle = JSON.parse(html.match(/<script id="deck-i18n" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const staticTitle = (html.match(/<title data-i18n="chrome\.deck\.title">([^<]*)<\/title>/) || [])[1] || "";
const unescapeHtml = (text) => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">")
  .replaceAll("&quot;", "\"").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

async function check() {
  // The page chrome is written in the first language. The runtime rewrites
  // the title when it runs, so the served file itself has to carry it: a
  // reader whose script does not run, and every crawler, must still meet
  // the deck's own title rather than the last language the build ended on.
  assert.equal(unescapeHtml(staticTitle), bundle.slots.en["chrome.deck.title"],
    "the served " + variant + " deck carries its title in its own language");
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  });
  const browser = await chromium.launch({executablePath:process.env.GENIE_OVERVIEW_CHROMIUM || undefined});
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/overview`;
    const context = await browser.newContext({viewport:{width:1280,height:720}});
    const externalRequests = [];
    await context.route("**/*", (route) => {
      if (route.request().url().startsWith(url)) return route.continue();
      externalRequests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // The deck follows the browser's language when the reader has no
    // choice recorded. The English pass starts from English.
    await context.addInitScript(() => window.localStorage.setItem("genie-deck-language", "en"));
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector(".reveal.ready") && document.fonts.status === "loaded");
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.locator(".slides > section.deck-slide").count(), spec.slides);
    // The short deck names the format once, as the second way knowledge
    // enters the assistant, and never presents the tooling. The check
    // reads the whole slide - body, notes and source links - and every
    // language says the same.
    async function assertFormatMentions(code) {
      const sections = await page.locator(".slides > section.deck-slide").evaluateAll(slides =>
        slides.map(node => [node.id, node.textContent]));
      const mentions = sections.filter(([, text]) => text.includes("OKF")).map(([id]) => id).sort();
      assert.deepEqual(mentions, ["slide-06"],
        "the short deck names the format outside the ingestion slide in " + code);
      for (const [id, text] of sections) {
        assert.ok(!text.includes("OKF Studio"), "the short deck presents the tooling on " + id + " in " + code);
      }
    }
    if (variant === "light") {
      assert.equal(await page.locator("#slide-16").count(), 0);
      assert.equal(await page.locator("#slide-21").count(), 1);
      await assertFormatMentions("en");
    }
    assert.equal(await page.title(), "GENIE.AI walkthrough");
    assert.equal(await page.locator(".slides > section.present").getAttribute("id"), "slide-01");

    async function slide(n) {
      const id = "slide-" + String(n).padStart(2, "0");
      await page.goto(url + "#/" + id);
      const visibleSlide = page.locator("section#" + id + ".present");
      await visibleSlide.waitFor({state:"visible"});
      return visibleSlide;
    }
    let current = await slide(2);
    assert.equal(await current.locator(".source-pane:visible").count(), 1);
    await page.keyboard.press("ArrowRight");
    await current.locator(".source-pane.is-target").waitFor({state:"visible"});
    const [notes] = await Promise.all([page.waitForEvent("popup"), page.locator("#deck-notes").click()]);
    // The speaker view is Reveal's own: the current slide, the next one,
    // the notes and the clock.
    await notes.locator("#upcoming-slide").waitFor({state:"visible"});
    assert.match(await notes.locator(".clock-value").textContent(), /\d/);
    await notes.locator(".speaker-controls-notes .value").waitFor({state:"visible"});
    assert.match(await notes.locator(".speaker-controls-notes .value").textContent(), /fictional/);
    await notes.close();

    current = await slide(8);
    await page.keyboard.press("ArrowRight");
    const opener = page.locator("section#chapter-03.present");
    await opener.getByRole("heading",{name:"From documents to an answer."}).waitFor();
    assert.ok(await opener.locator(".chapter-intro").evaluate(el => getComputedStyle(el).animationName === "chapter-title-in"));
    assert.ok(await opener.locator(".chapter-track").evaluate(el => getComputedStyle(el, "::after").animationName === "chapter-line-in"));
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator(".slides > section.present").getAttribute("id"), "slide-09");
    await page.getByRole("heading",{name:"A source document has to become searchable."}).waitFor();
    assert.equal(await page.locator("figure.diagram-paper svg").count(), spec.diagrams);
    const ingestion = page.locator("#slide-09.present");
    const settings = ingestion.locator(".ingestion-settings");
    assert.deepEqual(await ingestion.locator(".format-list li").allTextContents(),
      ["PDF", "DOCX", "XLSX", "CSV", "MD", "HTML", "TXT"]);
    assert.equal(await settings.isVisible(), true);
    const enteringRoutes = await ingestion.locator(".diagram-trace").evaluateAll(edges => edges.map(edge => {
      const style = getComputedStyle(edge);
      return [style.animationName, parseFloat(style.animationDelay)];
    }));
    assert.equal(enteringRoutes.length, 5);
    assert.ok(enteringRoutes.every(([name]) => name === "route-sweep"));
    assert.ok(enteringRoutes.every(([, delay], i) => i === 0 || delay > enteringRoutes[i - 1][1]));
    const [settingsStart, pipelineEnd] = await ingestion.evaluate(section => {
      const preceding = section.querySelectorAll(".diagram-trace, .diagram-paper g.node, .ingestion-example mark");
      const precedingTimes = Array.from(preceding).flatMap(element =>
        element.getAnimations().map(animation => animation.effect.getComputedTiming().endTime));
      const [settingsEntry] = section.querySelector(".ingestion-settings").getAnimations();
      return [settingsEntry.effect.getTiming().delay, Math.max(...precedingTimes)];
    });
    assert.ok(settingsStart >= pipelineEnd, `Settings start at ${settingsStart} ms, pipeline ends at ${pipelineEnd} ms`);
    await page.waitForFunction(() => {
      const edge = document.querySelector("#slide-09.present .diagram-idle");
      const motion = edge?.getAnimations()[0];
      return motion?.effect.getComputedTiming().currentIteration >= 1 && Number(getComputedStyle(edge).opacity) > .2;
    }, undefined, {timeout: 14000});
    assert.equal(await ingestion.locator(".stage-fragment.current-fragment").count(), 0);
    await page.getByRole("button", {name:"Pause motion", exact:true}).click();
    assert.equal(await ingestion.locator(".diagram-idle").first().evaluate(edge => getComputedStyle(edge).animationName), "none");
    await page.getByRole("button", {name:"Resume motion", exact:true}).waitFor();
    await page.keyboard.press("m");
    await page.getByRole("button", {name:"Pause motion", exact:true}).waitFor();
    assert.equal(await ingestion.locator(".diagram-idle").first().evaluate(edge => getComputedStyle(edge).animationName), "route-idle");
    await page.keyboard.press("ArrowRight");
    await ingestion.locator("g.node.is-target").filter({hasText:"Administrator"}).waitFor();
    assert.equal(await settings.evaluate(el => el.classList.contains("is-target")), false);
    await page.keyboard.press("ArrowRight");
    const chunks = ingestion.locator(".ingestion-example.is-target");
    await chunks.waitFor();
    assert.deepEqual(await chunks.locator("mark").allTextContents(),
      ["a recent proof of address", "a recent proof of address"]);
    await page.keyboard.press("ArrowRight");
    await ingestion.locator("g.node.is-target").filter({hasText:"ArangoDB"}).waitFor();
    assert.equal(await ingestion.locator(".diagram-trace.is-target").first().evaluate(edge => getComputedStyle(edge).animationName), "trace-flow");
    assert.equal(await ingestion.locator(".diagram-idle").first().evaluate(edge => getComputedStyle(edge).animationName), "none");
    // The third step is the one that reaches the stored index, so the
    // settings it needs are on screen with it.
    await ingestion.locator(".ingestion-settings.is-target").waitFor();
    await page.keyboard.press("m");
    assert.equal(await ingestion.locator(".diagram-trace.is-target").first().evaluate(edge => getComputedStyle(edge).animationName), "none");
    await page.keyboard.press("m");
    current = await slide(10);
    assert.equal(await current.getAttribute("data-position"), String(spec.positions[10]));
    await page.keyboard.press("ArrowRight");
    await current.locator(".diagram-notes .is-target").filter({hasText:"Ask"}).waitFor();
    await current.locator("g.node.is-target").filter({hasText:"ChatQnA"}).waitFor();
    await page.keyboard.press("ArrowRight");
    await current.locator(".diagram-notes .is-target").filter({hasText:"Find"}).waitFor();
    await current.locator("g.node.is-target").filter({hasText:"ArangoDB"}).waitFor();
    assert.ok(await current.locator("path.diagram-trace.is-target").count());

    // The retrieval, reranking, profile and deployment slides only the
    // full deck shows.
    if (variant === "full") {
      current = await slide(11);
      const retrievalNodes = await current.locator("svg g.node").evaluateAll(nodes =>
        Object.fromEntries(nodes.map(node => [node.textContent, node.getBoundingClientRect().top])));
      assert.ok(retrievalNodes.BM25 < retrievalNodes["Vector search"]);
      assert.ok(retrievalNodes["Rank fusion"] < retrievalNodes["Graph expansion"]);
      assert.deepEqual(await current.locator(".diagram-notes h2").allTextContents(),
        ["BM25 search", "Vector search", "Graph expansion"]);

      current = await slide(12);
      const best = current.locator('.rank-row[data-light="0"]');
      assert.equal(await best.evaluate((element) => getComputedStyle(element).top), "170px");
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => getComputedStyle(document.querySelector(".present .rank-row.is-target")).top === "0px");
      await page.keyboard.press("ArrowLeft");
      await page.waitForFunction(() => getComputedStyle(document.querySelector(".present .rank-row")).top === "170px");
    }

    current = await slide(14);
    assert.equal(await current.locator(".language-flag").count(), 3);
    assert.equal(await current.locator("article p[lang=sw]").count(), 2);
    assert.equal(await current.locator("article p[lang=en]").count(), 1);
    assert.deepEqual(await current.locator(".language-flag").evaluateAll(imgs =>
      imgs.filter(img => !img.complete || img.naturalWidth < 1).map(img => img.alt)), []);
    for (const label of ["Question · Kiswahili", "English RAG core", "Answer · Kiswahili"]) {
      await page.keyboard.press("ArrowRight");
      await current.locator(".language-turn.is-target h2").filter({hasText:label}).waitFor();
      assert.ok(await current.locator("path.diagram-trace.is-target").count());
    }

    // Returning from the next slide brings back the settled view.
    current = await slide(15);
    assert.equal(await current.getAttribute("data-position"), String(spec.positions[15]));
    await current.getByRole("heading",{name:"What runs inside GENIE.AI?",exact:true}).waitFor();
    await page.keyboard.press("ArrowLeft");
    const previous = page.locator("#slide-14.present");
    await previous.waitFor();
    assert.equal(await previous.evaluate(section => section.classList.contains("is-entering")), false);

    if (variant === "full") {
      current = await slide(20);
      assert.equal(await current.locator(".profile:visible").count(), 2);
      await page.keyboard.press("ArrowRight");
      await current.locator(".profile.is-target h2").filter({hasText:"Frontline officer"}).waitFor();
      await page.keyboard.press("ArrowRight");
      await current.locator(".profile.is-target h2").filter({hasText:"Authorised caseworker"}).waitFor();
    }

    current = await slide(24);
    const institutionLines = await current.locator('svg g.node[id^="flowchart-L-"] text > tspan').allTextContents();
    assert.deepEqual(institutionLines.map(line => line.replaceAll("\u200b", "")), ["Institution-managed", "model endpoint"]);

    if (variant === "full") {
      current = await slide(29);
      const matrix = current.locator(".deployment-matrix");
      assert.equal(await matrix.locator("tbody tr").count(), 3);
      for (const title of ["Docker Compose","Docker Swarm","Kubernetes & Helm"]) {
        assert.equal(await matrix.locator("tbody th").filter({hasText:title}).count(),1);
      }
      current = await slide(30);
      await page.keyboard.press("ArrowRight");
      assert.equal(await current.locator("g.node.is-target").count(), 3);
      await current.locator("g.node.is-target").filter({hasText:"Docker Swarm"}).waitFor();
      await page.keyboard.press("ArrowRight");
      await current.locator("g.node.is-target").filter({hasText:/Dedicated.*GPU API/}).waitFor();
      assert.equal(await current.locator("path.diagram-trace.is-target").count(), 3);
      await page.keyboard.press("ArrowRight");
      await current.locator("g.node.is-target").filter({hasText:"vLLM"}).waitFor();
      await page.keyboard.press("ArrowLeft");
      await current.locator("g.node.is-target").filter({hasText:/Dedicated.*GPU API/}).waitFor();
      current = await slide(31);
      assert.match(await current.locator(".slide-content").textContent(), /NVIDIA GPUs with CUDA and AMD GPUs with ROCm/);
      assert.doesNotMatch(await current.textContent(), /exercised|still in review|open merge request/i);
      current = await slide(32);
      await current.getByRole("heading",{name:"What can you configure in GENIE.AI?",exact:true}).waitFor();
      assert.match(await current.locator(".slide-takeaway").textContent(), /re-ingest/);
    }
    // The integration slide names its four integration points, one per card.
    assert.deepEqual(await page.locator("#slide-07 .diagram-notes h2").allTextContents(),
      ["Your applications", "Your sign-in", "Your documents", "Your models"]);
    current = await slide(37);
    assert.equal(await current.locator(".eyebrow").textContent(), "QUESTIONS");
    assert.equal(await page.locator(".brand-strip img").count(), spec.brands);
    assert.deepEqual(await page.locator(".brand-strip img").evaluateAll(imgs =>
      imgs.filter(img => !img.complete || img.naturalWidth < 1).map(img => img.alt)), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);

    await page.goto(url + "?check=entry");
    const ids = await page.locator(".slides > section.deck-slide").evaluateAll(slides => slides.map(node => node.id));
    // Each length carries its own chapter timings. The last slide belongs to
    // the last chapter, so its timing tells which timings the build applied.
    const published = JSON.parse(readFileSync(resolve(__dirname, "../src/variants.json"), "utf8"));
    const reference = readFileSync(resolve(__dirname, "../src/slides/en.txt"), "utf8").split("\n")
      .filter((line) => line.startsWith("# ")).pop().split("|")[1];
    assert.equal(await page.locator(".slides > section.deck-slide").last().getAttribute("data-timing"),
      ((published[variant] || {}).timings || {})["7"] || reference,
      "the chapter timings are those of the " + variant + " deck");
    assert.equal(ids.filter(id => id.startsWith("chapter-")).length, 6);
    for (const id of ids) {
      await page.evaluate((hash) => { location.hash = hash; }, "/" + id);
      const s = page.locator("section#" + id + ".present.is-entering");
      await s.waitFor({state:"visible"});
      const title = s.locator(".chapter-intro, .heading, .cover-content h1").first();
      assert.notEqual(await title.evaluate(node => getComputedStyle(node).animationName), "none", id);
    }
    await page.goto(url + "?reduced=1");
    await page.getByRole("button", {name:"Resume motion",exact:true}).waitFor();
    for (const id of ids) {
      await page.evaluate((hash) => { location.hash = hash; }, "/" + id);
      const s = page.locator("section#" + id + ".present");
      await s.waitFor({state:"visible"});
      assert.equal(await s.evaluate(section => section.getAnimations({subtree:true}).length), 0, id);
      const issues = await s.evaluate((el) => {
        const border = el.getBoundingClientRect();
        const footer = el.querySelector(".slide-footer").getBoundingClientRect();
        const selector = "h1, h2, .slide-content p, .cover-intro, .resources a, .diagram-paper, .field-photo, .deployment-matrix, .stack-grid, .chapter, .chapter-intro p, .chapter-track li";
        return Array.from(el.querySelectorAll(selector)).flatMap((node) => {
          const b = node.getBoundingClientRect();
          return b.bottom > footer.top - 7 || b.right > border.right - 22 || b.left < border.left + 22
            ? [node.textContent.slice(0,55) + " · " + Math.round(b.bottom - border.top)]
            : [];
        });
      });
      assert.deepEqual(issues, [], "Content out of bounds on slide " + id);
      const diagramIssues = await s.locator("figure svg g.node").evaluateAll((nodes) => nodes.flatMap((node) => {
        const body = node.querySelector(":scope > :is(rect,polygon,circle,ellipse,path)");
        const label = node.querySelector("text");
        if (!body || !label) return [];
        const shape = body.getBoundingClientRect();
        const text = label.getBoundingClientRect();
        return text.right > shape.right + 1 || text.left < shape.left - 1 ? [label.textContent] : [];
      }));
      assert.deepEqual(diagramIssues, [], "Mermaid labels exceed shape on slide " + id);
      const clusterIssues = await s.locator("figure svg .cluster-label").evaluateAll((labels) => labels.flatMap((label) => {
        const bounds = label.getBoundingClientRect();
        const nodes = label.closest("svg").querySelectorAll("g.node > :is(rect,polygon,circle,ellipse,path)");
        return Array.from(nodes).flatMap((node) => {
          const box = node.getBoundingClientRect();
          return box.left < bounds.right - 1 && box.right > bounds.left + 1 &&
            box.top < bounds.bottom - 1 && box.bottom > bounds.top + 1 ? [label.textContent] : [];
        });
      }));
      assert.deepEqual(clusterIssues, [], "Mermaid group labels overlap nodes on slide " + id);
      if (id.startsWith("chapter-")) {
        assert.equal(await s.locator(".chapter-intro").evaluate(el => getComputedStyle(el).animationName),"none");
      }
    }
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.goto(url + "#/slide-09");
    await page.getByRole("button", {name:"Resume motion",exact:true}).waitFor();
    assert.equal(await ingestion.locator(".diagram-idle").first().evaluate(edge => getComputedStyle(edge).animationName), "none");

    // Every language the deck carries must switch, set its own direction,
    // keep its content inside the slide and actually say something in its
    // own words. A deck that carries English prose under a translated
    // interface passes every other check, so the text itself is compared.
    const languages = await page.locator("#deck-language option").evaluateAll(options =>
      options.map(option => option.value));
    assert.ok(languages.length > 1, "the deck offers more than one language");
    const englishProse = await page.locator("#slide-06 .slide-content").textContent();
    assert.ok(englishProse.length > 40, "the English prose is there to compare against");
    for (const code of languages) {
      const languageUrl = url + "?lang=" + code + "#/slide-01";
      await page.goto(languageUrl);
      if (await page.locator("html").getAttribute("lang") !== code) {
        await page.selectOption("#deck-language", code);
        // Choosing a language reloads the deck with the language in the
        // URL, so the reader's link carries it and the speaker view -
        // which loads the deck again in a frame - reads the same one.
        await page.waitForFunction(
          (wanted) => document.documentElement.lang === wanted, code);
      }
      const expectedDirection = code === "ar" ? "rtl" : "ltr";
      assert.equal(await page.locator("html").getAttribute("dir"), expectedDirection, code);
      // The reader's choice survives a reload.
      await page.goto(languageUrl);
      assert.equal(await page.locator("html").getAttribute("lang"), code, code);
      for (const id of ids) {
        await page.evaluate((hash) => { location.hash = hash; }, "/" + id);
        const s = page.locator("section#" + id + ".present");
        await s.waitFor({state:"visible"});
        const issues = await s.evaluate((el) => {
          const border = el.getBoundingClientRect();
          const footer = el.querySelector(".slide-footer").getBoundingClientRect();
          const selector = "h1, h2, .slide-content p, .cover-intro, .resources a, .diagram-paper, .field-photo, .deployment-matrix, .stack-grid, .chapter, .chapter-intro p, .chapter-track li";
          return Array.from(el.querySelectorAll(selector)).flatMap((node) => {
            const b = node.getBoundingClientRect();
            return b.bottom > footer.top - 7 || b.right > border.right - 22 || b.left < border.left + 22
              ? [node.textContent.slice(0,55) + " · " + Math.round(b.bottom - border.top)]
              : [];
          });
        });
        assert.deepEqual(issues, [], "Content out of bounds on slide " + id + " in " + code);
      }
      // The Arabic and Chinese faces travel inside the deck, so those two
      // languages look the same on every machine. A face is used only when
      // the stack names it, and a face nothing draws stays unloaded.
      const embedded = code === "ar" ? "Noto Sans Arabic" : code === "zh" ? "Noto Sans SC" : null;
      if (embedded) {
        const faces = await page.evaluate((family) =>
          [...document.fonts].filter((face) => face.family === family).map((face) => face.status), embedded);
        assert.ok(faces.length === 2 && faces.every((status) => status === "loaded"),
          `${code}: the embedded face ${embedded} is not used (${faces.join(", ")})`);
      }
      // The prose must be the language's own. The runtime swaps every slot
      // in the page, so a slide that kept its English text would pass
      // every check above.
      if (code !== "en") {
        const prose = await page.locator("#slide-06 .slide-content").textContent();
        assert.notEqual(prose, englishProse, "slide 6 still reads English in " + code);
      }
      if (variant === "light") await assertFormatMentions(code);
      if (code === "ar") {
        // A Latin name of several words is one island on the right-to-left
        // line. Split at the space and the line would read the second word
        // first: "OKF Studio" would read "Studio OKF". An Arabic word
        // between two Latin ones keeps them apart.
        const islands = (selector) => page.locator(selector + " [dir=ltr]").allTextContents();
        assert.deepEqual(await islands("#slide-10 .eyebrow"), ["RETRIEVAL-AUGMENTED GENERATION (RAG)"]);
        assert.deepEqual(await islands('#slide-04 [data-i18n="src.itu"]'), ["GENIE.AI · ITU"]);
        assert.deepEqual(await islands('#slide-10 [data-i18n="s10.items.0.f1"]'), ["Node.js", "OPEA ChatQnA"]);
        assert.deepEqual(await islands('#slide-37 [data-i18n="src.k8s"]'), ["Kubernetes", "Helm"]);
        // The diagrams stay English on the right-to-left page. A label that
        // starts with a slash would read from the end if the page direction
        // reached it, so the first character is checked to be the leftmost.
        // A hidden slide has no boxes to measure, so the slide is shown first.
        await page.evaluate((hash) => { location.hash = hash; }, "/slide-07");
        await page.locator("section#slide-07.present").waitFor({state: "visible"});
        // A label is cut into one text run per line; the runs that start
        // with a slash are the ones the page direction would reorder.
        const labels = await page.locator('#slide-07 figure svg text').evaluateAll(texts => texts.flatMap((text) => {
          const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
          const found = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.startsWith("/api/")) continue;
            const range = document.createRange();
            const last = node.textContent.length - 1;
            range.setStart(node, 0); range.setEnd(node, 1);
            const first = range.getBoundingClientRect().left;
            range.setStart(node, last); range.setEnd(node, last + 1);
            found.push([node.textContent, first < range.getBoundingClientRect().left]);
          }
          return found;
        }));
        assert.deepEqual(labels, [["/api/*", true], ["/api/queries", true], ["/api/files", true]]);
      }
    }
    assert.deepEqual(errors, []);
    console.log("Checked all " + spec.slides + " slides of the " + variant + " deck, entry and idle motion, pause, notes, offline assets, reduced-motion navigation and "
      + languages.length + " languages");
  } finally {
    await browser.close();
    server.close();
  }
}
check().catch((error) => { console.error(error); process.exitCode = 1; });
