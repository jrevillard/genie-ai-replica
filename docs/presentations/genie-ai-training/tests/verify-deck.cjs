const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createServer } = require("node:http");
const { once } = require("node:events");

const html = readFileSync(process.argv[2] || resolve(__dirname, "../../../../site/static/presentations/genie-ai/index.html"));

async function check() {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  });
  const browser = await chromium.launch({executablePath:process.env.GENIE_TRAINING_CHROMIUM || undefined});
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/training`;
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
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector(".reveal.ready") && document.fonts.status === "loaded");
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.locator(".slides > section.deck-slide").count(), 43);
    assert.match(await page.title(), /Public-sector briefing/);
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
    await notes.locator(".speaker").waitFor({state:"visible"});
    assert.match(await notes.locator(".speaker").textContent(), /fictional/);
    assert.match(await notes.locator(".section-info").textContent(), /02 \/ 43/);
    await notes.locator("#forward").click();
    assert.match(await notes.locator(".section-info").textContent(), /03 \/ 43/);
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
    assert.equal(await page.locator("figure.diagram-paper svg").count(), 12);
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
    await page.keyboard.press("m");
    assert.equal(await ingestion.locator(".diagram-trace.is-target").first().evaluate(edge => getComputedStyle(edge).animationName), "none");
    await page.keyboard.press("m");
    await page.keyboard.press("ArrowRight");
    await ingestion.locator(".ingestion-settings.is-target").waitFor();
    assert.equal(await ingestion.locator("g.node.is-target").count(), 0);
    current = await slide(10);
    assert.equal(await current.getAttribute("data-position"), "12");
    await page.keyboard.press("ArrowRight");
    await current.locator(".diagram-notes .is-target").filter({hasText:"Ask"}).waitFor();
    await current.locator("g.node.is-target").filter({hasText:"ChatQnA"}).waitFor();
    await page.keyboard.press("ArrowRight");
    await current.locator(".diagram-notes .is-target").filter({hasText:"Find"}).waitFor();
    await current.locator("g.node.is-target").filter({hasText:"ArangoDB"}).waitFor();
    assert.ok(await current.locator("path.diagram-trace.is-target").count());

    current = await slide(11);
    assert.equal(await current.getAttribute("data-position"), "13");
    await current.getByRole("heading",{name:"What runs inside GENIE.AI?",exact:true}).waitFor();
    await page.keyboard.press("ArrowLeft");
    const previous = page.locator("#slide-10.present");
    await previous.waitFor();
    assert.equal(await previous.evaluate(section => section.classList.contains("is-entering")), false);

    current = await slide(12);
    const retrievalNodes = await current.locator("svg g.node").evaluateAll(nodes =>
      Object.fromEntries(nodes.map(node => [node.textContent, node.getBoundingClientRect().top])));
    assert.ok(retrievalNodes.BM25 < retrievalNodes["Vector search"]);
    assert.ok(retrievalNodes["Rank fusion"] < retrievalNodes["Graph expansion"]);
    assert.deepEqual(await current.locator(".diagram-notes h2").allTextContents(),
      ["BM25 search", "Vector search", "Graph expansion"]);

    current = await slide(13);
    const best = current.locator('.rank-row[data-light="0"]');
    assert.equal(await best.evaluate((element) => getComputedStyle(element).top), "170px");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".present .rank-row.is-target")).top === "0px");
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".present .rank-row")).top === "170px");

    current = await slide(15);
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

    current = await slide(20);
    assert.equal(await current.locator(".profile:visible").count(), 2);
    await page.keyboard.press("ArrowRight");
    await current.locator(".profile.is-target h2").filter({hasText:"Frontline officer"}).waitFor();
    await page.keyboard.press("ArrowRight");
    await current.locator(".profile.is-target h2").filter({hasText:"Authorised caseworker"}).waitFor();

    current = await slide(24);
    const institutionLines = await current.locator('svg g.node[id^="flowchart-L-"] text > tspan').allTextContents();
    assert.deepEqual(institutionLines.map(line => line.replaceAll("\u200b", "")), ["Institution-managed", "model endpoint"]);

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
    current = await slide(37);
    assert.equal(await current.locator(".eyebrow").textContent(), "QUESTIONS");
    assert.ok(await page.locator(".brand-strip img").count() > 20);
    assert.deepEqual(await page.locator(".brand-strip img").evaluateAll(imgs =>
      imgs.filter(img => !img.complete || img.naturalWidth < 1).map(img => img.alt)), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);

    await page.goto(url + "?check=entry");
    const ids = await page.locator(".slides > section.deck-slide").evaluateAll(slides => slides.map(node => node.id));
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
    console.log("Checked all 43 slides, entry and idle motion, pause, notes, offline assets and reduced-motion navigation");
  } finally {
    await browser.close();
    server.close();
  }
}
check().catch((error) => { console.error(error); process.exitCode = 1; });
