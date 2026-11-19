const { chromium } = require("playwright");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { createServer } = require("node:http");
const { once } = require("node:events");

const specs = JSON.parse(readFileSync(join(__dirname, "training-mermaid.json"), "utf8"));
const bundle = readFileSync(join(__dirname, "..", "node_modules", "mermaid", "dist", "mermaid.min.js"));
const diagramOutput = join(__dirname, "mermaid-svg");
mkdirSync(diagramOutput, {recursive:true});
const style = `
classDef channel fill:#ffffff,stroke:#849ccc,stroke-width:1.6px,color:#101e3b;
classDef core fill:#eaf2ff,stroke:#406bd1,stroke-width:1.8px,color:#102348;
classDef data fill:#e3f6f8,stroke:#2a8398,stroke-width:1.8px,color:#102e3b;
classDef model fill:#f1ebff,stroke:#7557b4,stroke-width:1.8px,color:#211641;
classDef option fill:#fff1fb,stroke:#a757a0,stroke-width:1.8px,stroke-dasharray:5 3,color:#3e2040;
linkStyle default stroke:#4a628b,stroke-width:1.85px;
`;

async function main() {
  const server = createServer((req,res) => {
    if (req.url === "/mermaid.js") {
      res.setHeader("Content-Type","application/javascript");
      return res.end(bundle);
    }
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><script src="/mermaid.js"></script><div id="mermaid-out"></div></html>');
  });
  const browser = await chromium.launch({executablePath:process.env.GENIE_TRAINING_CHROMIUM || undefined});
  try {
    server.listen(0,"127.0.0.1");
    await once(server,"listening");
    const page = await browser.newPage();
    page.on("pageerror",error => console.warn(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => mermaid.initialize({
      startOnLoad: false, theme: "base", securityLevel: "strict", htmlLabels: false,
      fontFamily: "Arial, sans-serif",
      themeVariables: {
        fontSize: "24px", textColor: "#101e3b", lineColor: "#4a628b", mainBkg: "#eef3ff",
        clusterBkg: "#eff5ff", clusterBorder: "#88a0c8", titleColor: "#263a61",
        edgeLabelBackground: "#f8fbff"
      },
      flowchart: { htmlLabels:false, nodeSpacing:35, rankSpacing:45, curve:"basis", padding:13, subGraphTitleMargin:{top:6,bottom:18} }
    }));
    for (const [id,{description, idleEdges = []}] of Object.entries(specs)) {
      const source = readFileSync(join(__dirname, "diagrams", id + ".mmd"), "utf8");
      const result = await page.evaluate(async ({id,source,description,idleEdges}) => {
        const {svg} = await mermaid.render("genie-diagram-" + id, source);
        const template = document.createElement("template");
        template.innerHTML = svg;
        const root = template.content.querySelector("svg");
        if (!root) throw new Error("Mermaid did not produce an SVG for " + id);
        if (root.querySelector("foreignObject")) throw new Error("Mermaid did not produce native SVG text for " + id);
        root.removeAttribute("style");
        root.removeAttribute("width");
        root.removeAttribute("height");
        root.setAttribute("role","img");
        root.setAttribute("aria-label",description);
        const namespace = "http://www.w3.org/2000/svg";
        const desc = document.createElementNS(namespace,"desc");
        desc.textContent = description;
        root.prepend(desc);
        const nodeTiming = new Map();
        root.querySelectorAll("g.node").forEach((node) => {
          const stages = [...node.classList].filter(c => /^step\d+$/.test(c)).map(c=>c.slice(4));
          const entryBeat = [...node.classList].find(c => /^beat\d+$/.test(c));
          const beat = entryBeat?.slice(4) ?? stages[0] ?? "0";
          node.style.setProperty("--flow-beat", beat);
          if (stages.length) node.setAttribute("data-light", stages.join(" "));
          const match = node.id.match(/^flowchart-(.+)-\d+$/);
          if (match) nodeTiming.set(match[1], {stages, beat});
        });
        root.querySelectorAll("path.flowchart-link").forEach((line) => {
          const match = line.getAttribute("data-id")?.match(/^L_(\w+)_(\w+)_\d+$/);
          if (!match) return;
          const from = nodeTiming.get(match[1]);
          const to = nodeTiming.get(match[2]);
          const stages = to?.stages.length ? to.stages : from?.stages;
          const trace = document.createElementNS(namespace,"path");
          trace.setAttribute("class","diagram-trace");
          trace.setAttribute("d",line.getAttribute("d"));
          trace.setAttribute("pathLength","1");
          trace.style.setProperty("--flow-beat", to?.beat ?? from?.beat ?? "0");
          if (stages?.length) trace.setAttribute("data-light",stages.join(" "));
          trace.setAttribute("aria-hidden","true");
          line.after(trace);
          const idleBeat = idleEdges.findIndex(([start, end]) => start === match[1] && end === match[2]);
          if (idleBeat >= 0) {
            const idle = trace.cloneNode(false);
            idle.setAttribute("class","diagram-idle");
            idle.removeAttribute("data-light");
            idle.style.cssText = "--idle-beat:" + idleBeat;
            trace.after(idle);
          }
        });
        if (root.querySelectorAll(".diagram-idle").length !== idleEdges.length) {
          throw new Error("Invalid idle animation routes in diagram " + id);
        }
        return {
          svg: new XMLSerializer().serializeToString(root),
          dimensions: root.getAttribute("viewBox"),
          nodes: root.querySelectorAll("g.node[data-light]").length,
          traces: root.querySelectorAll(".diagram-trace").length,
        };
      }, {id,source:source + "\n" + style,description,idleEdges});
      writeFileSync(join(diagramOutput, id + ".svg"), result.svg);
      console.log(id,result.dimensions,result.nodes,result.traces);
    }
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
