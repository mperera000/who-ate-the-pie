// Generate one or more films from the terminal: npm run film -- 3
import { config } from "./config.js";
import { generateRun } from "./engine/story.js";
import { stats } from "./stats.js";

const count = Math.max(1, Number(process.argv[2] ?? 1));
console.log(`Generating ${count} film(s) in ${config.mock ? "OFFLINE" : `LIVE (${config.model}, effort ${config.effort})`} mode…`);
for (let n = 1; n <= count; n++) {
  const run = await generateRun();
  console.log(`${n}. Case #${run.caseNumber} ${run.id} → ${run.ending?.title}: ${run.ending?.summary}`);
}
const s = await stats();
console.log(`\nAcross ${s.runs} films: Goldilocks was right ${s.correct} times. Accused:`, s.accused, "Endings:", s.endings);
