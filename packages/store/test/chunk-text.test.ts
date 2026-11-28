// The pure side of page-body chunks: Markdown structure and the bigram
// tokenizer that both the index and the query go through.
//
// Style: assert-based self-check (no framework), matching the store suite.

import {
  BLOCK_HARD_CAP_CHARS,
  BLOCK_MAX_CHARS,
  BLOCK_MIN_CHARS,
  SECTION_MAX_CHARS,
  WHOLE_UNIT_SPLIT_CHARS,
  chunkIndexText,
  chunkMarkdown,
  chunkQueryTerms,
  markdownSections,
} from "../src/chunk-text";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

function main() {
  // ---- tokenizer: Han -> overlapping bigrams, Latin -> whole word ----------
  assert(chunkIndexText("中文分词") === "中文 文分 分词", "four Han chars become three overlapping bigrams");
  assert(chunkIndexText("中文检索") === "中文 文检 检索", "a Han run of four splits the same way");
  assert(chunkIndexText("SQLite中文检索") === "sqlite 中文 文检 检索", "script boundary becomes a separator");
  assert(chunkIndexText("2026年5月") === "2026 年 5 月", "a one-character Han run keeps its own token");
  assert(chunkIndexText("FTS 5 中文检索") === "fts 5 中文 文检 检索", "punctuation and spaces separate runs");
  assert(chunkIndexText("a.b,c") === "a b c", "punctuation splits Latin words");
  // Every script, not just ASCII, keeps a searchable word.
  assert(chunkIndexText("привет мир") === "привет мир", "Cyrillic runs stay whole words");
  assert(chunkIndexText("αθήνα Ελλάδα") === "αθήνα ελλάδα", "Greek runs stay whole words");
  assert(chunkIndexText("안녕하세요 세계") === "안녕하세요 세계", "Hangul runs stay whole words");
  assert(chunkIndexText("ひらがな カタカナ") === "ひらがな カタカナ", "Kana runs stay whole words");
  assert(chunkQueryTerms("привет").fts === "привет*", "a non-Latin word is queried as a prefix");
  assert(chunkQueryTerms("안녕").fts === "안녕*", "a Hangul query is a prefix");

  // ---- query: bigram phrases for Han, prefixes for Latin -------------------
  const q1 = chunkQueryTerms("中文分词");
  assert(q1.fts === '"中文 文分 分词"' && q1.singleHan.length === 0, "Han query becomes one bigram phrase");
  const q2 = chunkQueryTerms("vector");
  assert(q2.fts === "vector*" && q2.singleHan.length === 0, "Latin query is a prefix");
  const q3 = chunkQueryTerms("年");
  assert(q3.fts === null && q3.singleHan.join(",") === "年", "a lone Han character cannot be an FTS query");
  const q4 = chunkQueryTerms("中文 vector");
  assert(q4.fts === '"中文" AND vector*', "two scripts become two AND-ed groups");
  const q5 = chunkQueryTerms("2026年5月");
  assert(q5.fts === '"2026 年 5 月"', "digits and lone Han chars share one phrase");

  // ---- sections: heading path rooted at the page title --------------------
  const md = [
    "开头一段，没有标题。",
    "",
    "## 部署",
    "",
    "部署说明。",
    "",
    "### Windows",
    "",
    "Windows 下的步骤。",
    "",
    "## 检索",
    "",
    "检索说明。",
  ].join("\n");
  const sections = markdownSections([...md], "指南");
  assert(sections.length === 4, `four sections: intro + 部署 + Windows + 检索 (got ${sections.length})`);
  assert(sections[0]!.headingPath === "指南", "content before the first heading uses the page title");
  assert(sections[1]!.headingPath === "指南 > 部署", "first-level heading appends to the root");
  assert(sections[2]!.headingPath === "指南 > 部署 > Windows", "nested heading keeps the stack");
  assert(sections[3]!.headingPath === "指南 > 检索", "same-level heading replaces the stack");
  // Heading lines are not part of the body; the intro ends at the first heading line.
  assert(md.slice(sections[0]!.start, sections[0]!.end) === "开头一段，没有标题。", "intro body excludes the heading");
  assert(md.slice(sections[1]!.start, sections[1]!.end) === "部署说明。", "heading line excluded from the body");
  assert(sections[0]!.end < md.indexOf("## 部署"), "sections do not overlap the heading line");

  // ---- CRLF bodies still expose their headings --------------------------
  // A page fetched as CRLF keeps "\r" at every line end. If the parser sees it,
  // the ATX heading cannot match and the whole page collapses into one section.
  const crlf = "开头\r\n\r\n## 节一\r\n\r\n正文一。\r\n\r\n### 子节\r\n\r\n正文二。\r\n";
  const crlfSections = markdownSections([...crlf], "标题");
  assert(crlfSections.length === 3, `CRLF body keeps its headings (got ${crlfSections.length} sections)`);
  assert(crlfSections[1]!.headingPath === "标题 > 节一", "CRLF heading becomes a path segment");
  assert(crlfSections[2]!.headingPath === "标题 > 节一 > 子节", "CRLF nested heading keeps the stack");

  // ---- offsets count code points, not UTF-16 units ------------------------
  const emoji = "😀 开头\n\n## 节\n\n正文";
  const emojiSections = markdownSections([...emoji], "标题");
  // JS string index of "正文" is 10 because 😀 takes two UTF-16 units; the code
  // point offset is 9. The section must carry 9, or a SQL substr would read one
  // character too far.
  assert(emojiSections[1]!.start === [...emoji].indexOf("正"), `emoji section start is a code-point offset (got ${emojiSections[1]!.start})`);
  assert(emojiSections[0]!.start === 0 && emojiSections[0]!.end === [..."😀 开头"].length, "emoji intro offsets stay in code points");

  // ---- long sections split at paragraph boundaries -----------------------
  const para = "这是一个段落，用来把一节撑长。";
  const longBody = Array.from({ length: 90 }, () => para).join("\n\n");
  const longDoc = "## 长节\n\n" + longBody;
  const longChars = [...longDoc];
  assert(longChars.length > SECTION_MAX_CHARS, "fixture really exceeds the section cap");
  const longSection = chunkMarkdown(longDoc, "长文");
  assert(longSection.length > 1, `long section splits at paragraphs (got ${longSection.length})`);
  for (const s of longSection) {
    const len = s.end - s.start;
    assert(len <= SECTION_MAX_CHARS || !longChars.slice(s.start, s.end).join("").includes("\n\n"),
      `each split piece stays <= ${SECTION_MAX_CHARS} unless it is one unsplittable paragraph (got ${len})`);
    assert(s.headingPath === "长文 > 长节", "split pieces keep the same heading path");
  }
  for (let i = 1; i < longSection.length; i++) {
    assert(longSection[i]!.start >= longSection[i - 1]!.end, "section pieces do not overlap");
  }

  // ---- blocks: 200–800 target, 1200 hard cap, zero overlap ---------------
  const chunks = chunkMarkdown(md, "指南");
  assert(chunks.length === 4, "one section entry per body section");
  for (const section of chunks) {
    assert(section.blocks.length >= 1, "every non-empty section owns at least one block");
    for (let i = 0; i < section.blocks.length; i++) {
      const block = section.blocks[i]!;
      const len = block.end - block.start;
      assert(len <= BLOCK_HARD_CAP_CHARS, `block <= hard cap (got ${len})`);
      if (i > 0) assert(block.start >= section.blocks[i - 1]!.end, "blocks never overlap");
      assert(block.start >= section.start && block.end <= section.end, "block stays inside its section");
    }
  }

  // A single paragraph longer than the max but shorter than the cap stays one
  // block; the cap is the ceiling, not a target to hit.
  const oneParagraph = "字".repeat(700);
  const one = chunkMarkdown(oneParagraph, "单段");
  assert(one.length === 1 && one[0]!.blocks.length === 1, "a 700-character paragraph is one block");
  const overMax = "字".repeat(1500);
  const over = chunkMarkdown(overMax, "长段");
  const overBlocks = over[0]!.blocks;
  assert(overBlocks.length >= 2, "a 1500-character paragraph splits");
  for (const block of overBlocks) assert(block.end - block.start <= BLOCK_MAX_CHARS, "split pieces stay under the block max");

  // Balancing, not front-loading: a paragraph just over the max becomes even
  // pieces around the target, so no short tail block is left behind.
  const balanced = chunkMarkdown("字".repeat(900), "均衡");
  const balancedBlocks = balanced[0]!.blocks;
  assert(balancedBlocks.length >= 2, `a 900-character paragraph splits (got ${balancedBlocks.length})`);
  for (const block of balancedBlocks) {
    const len = block.end - block.start;
    assert(len >= BLOCK_MIN_CHARS && len <= BLOCK_MAX_CHARS, `balanced piece stays inside 200-800 (got ${len})`);
  }
  // The old front-loading split left an 800 + 100 pair; the tail is now a real block.
  assert(balancedBlocks.every((block) => block.end - block.start >= BLOCK_MIN_CHARS), "no short tail block is left behind");

  // A runt tail joins its predecessor even when that pushes the block past the
  // 800 target — a 150-character answer is worse than an 850-character one.
  const tailJoin = "字".repeat(700) + "\n\n" + "字".repeat(150);
  const joined = chunkMarkdown(tailJoin, "尾块");
  assert(joined[0]!.blocks.length === 1, "a runt tail folds into the previous block");
  assert(joined[0]!.blocks[0]!.end - joined[0]!.blocks[0]!.start === 852, "the joined block keeps the whole section");

  // A combining mark stays in the same run, so an accented word is one token.
  const marked = chunkIndexText("مُحَمَّد");
  assert(marked.split(" ").length === 1, "combining marks do not split a word into fragments");

  // A query made only of lone Han characters still reaches the page-level lane.
  const twoLone = chunkQueryTerms("年 月");
  assert(twoLone.fts === null && twoLone.singleHan.join(",") === "年,月",
    "two spaced lone Han characters are both returned for the page-level lane");

  // A zero term cap must not build an empty phrase (FTS5 rejects "").
  const zeroTerms = chunkQueryTerms("中文", 0);
  assert((zeroTerms.fts ?? "").startsWith('"') && (zeroTerms.fts ?? "").length > 2,
    "maxTerms is clamped to at least one token");

  // ---- code fences and tables stay whole inside the block size ----------
  const fenceBody = "```sql\nSELECT * FROM retrieval_chunks;\n```";
  const fenced = chunkMarkdown(fenceBody, "代码");
  assert(fenced[0]!.blocks.length === 1, "a short code fence is one block");
  const fenceBlock = fenced[0]!.blocks[0]!;
  assert(fenceBody.slice(fenceBlock.start, fenceBlock.end) === fenceBody, "the fence is not cut");

  // Up to three leading spaces still form a heading; four are a code block.
  const indentedHeading = markdownSections([..."   ## 缩进标题\n\n正文"], "页");
  assert(indentedHeading.some((s) => s.headingPath === "页 > 缩进标题"),
    "a heading indented by three spaces is recognized");
  const indentedCode = markdownSections([..."    ## 仍是正文\n\n正文"], "页");
  assert(indentedCode.length === 1 && indentedCode[0]!.headingPath === "页",
    "four spaces is an indented code block, not a heading");

  // An ATX heading made only of closing hashes is an empty title.
  const emptyHash = markdownSections([..."## ###\n\n正文"], "页");
  assert(emptyHash[0]!.headingPath === "页", "a heading of only hashes contributes no path segment");

  // A lone Han character inside a longer query is dropped (precision).
  const mixedSingleHan = chunkQueryTerms("中文 年");
  assert(mixedSingleHan.singleHan.length === 0, "a lone Han in a mixed query is not an OR branch");
  assert((mixedSingleHan.fts ?? "").includes("中文"), "the bigram phrase still drives the query");

  // A four-backtick fence may contain a three-backtick example; only a fence
  // of the same character and at least the same length closes it.
  const nestedFence = "````md\n```js\n## 不是标题\n```\n````\n\n## 真标题\n\n正文";
  const nestedSections = markdownSections([...nestedFence], "页");
  assert(nestedSections.every((s) => !s.headingPath.includes("不是标题")),
    "a shorter fence inside a longer fence does not close it");
  assert(nestedSections.some((s) => s.headingPath.endsWith("真标题")),
    "the heading after the fence is still found");

  // A closing hash sequence is Markdown syntax, not part of the title.
  const closedHeading = markdownSections([..."## 部署 ##\n\n正文"], "指南");
  assert(closedHeading[0]!.headingPath === "指南 > 部署", "a closing hash sequence is stripped from the heading");

  // A fence with one overlong line has no line boundary to cut at: the code
  // point slice keeps each block at or under the whole-unit ceiling.
  const minified = "```js\n" + "var a=1;".repeat(1000) + "\n```";
  const minifiedChunks = chunkMarkdown(minified, "压缩");
  const tooLong = minifiedChunks.flatMap((c) => c.blocks).filter((b) => b.end - b.start > WHOLE_UNIT_SPLIT_CHARS);
  assert(tooLong.length === 0, "an overlong single line is split at the code-point ceiling");
  assert(minifiedChunks.flatMap((c) => c.blocks).length > 1, "the overlong fence yields several blocks");

  const tableLines = ["| a | b |", "| --- | --- |", "| 1 | 2 |"];
  const tableBody = tableLines.join("\n");
  const tabled = chunkMarkdown("## 表\n\n" + tableBody, "表页");
  const tableBlock = tabled[0]!.blocks[0]!;
  const tableText = ("## 表\n\n" + tableBody).slice(tableBlock.start, tableBlock.end);
  assert(tableText === tableBody, `a table stays in one block (got ${JSON.stringify(tableText)})`);

  // A fence over 2000 characters is split by lines, and every piece still
  // starts and ends on a line boundary.
  const fenceLines = Array.from({ length: 120 }, (_, i) => "row " + i + " " + "x".repeat(20));
  const bigFence = "```\n" + fenceLines.join("\n") + "\n```";
  const big = chunkMarkdown(bigFence, "大代码");
  assert(big[0]!.blocks.length >= 2, "a fence over 2000 characters splits");
  for (const block of big[0]!.blocks) {
    const text = bigFence.slice(block.start, block.end);
    assert(!text.startsWith(" ") && !text.endsWith(" "), "fence pieces are trimmed at line ends");
    assert(text.split("\n").every((line) => line === "```" || line === "" || /^row \d+ x+$/.test(line)), "fence pieces split at line boundaries");
  }

  // A fence between the block max and the split threshold stays whole: the
  // 1200 hard cap is a rule for prose, not for code.
  const midFenceLines = Array.from({ length: 60 }, (_, i) => "x".repeat(20));
  // Blank lines inside the fence: a paragraph splitter that ignores fences
  // would cut straight through it.
  const midFence = "```\n" + midFenceLines.join("\n\n") + "\n```";
  assert([...midFence].length > BLOCK_MAX_CHARS && [...midFence].length < WHOLE_UNIT_SPLIT_CHARS,
    `fixture sits between block max and split threshold (got ${[...midFence].length})`);
  const mid = chunkMarkdown(midFence, "中代码");
  assert(mid[0]!.blocks.length === 1, "a fence under 2000 characters is one block");
  assert(mid[0]!.blocks[0]!.end - mid[0]!.blocks[0]!.start === [...midFence].length, "that block is the whole fence");

  // A section split must never cut through a fence: the blank line inside it is
  // not a paragraph boundary, and the whole listing stays in one section.
  const fencedDoc = "## 代码\n\n" + midFence + "\n\n尾注说明。";
  const fencedParts = chunkMarkdown(fencedDoc, "长代码");
  assert(fencedParts.length >= 1, "the fenced document has sections");
  const fenceStart = fencedDoc.indexOf("```");
  const fenceEnd = fencedDoc.lastIndexOf("```") + 3;
  const fenceHolding = fencedParts.find((p) => p.start <= fenceStart && p.end >= fenceEnd);
  assert(Boolean(fenceHolding), "the whole fence lives inside one section");

  // ---- a runty last block folds into its neighbour ----------------------
  const tail = "字".repeat(BLOCK_MIN_CHARS - 40) + "\n\n" + "字".repeat(60);
  const tailed = chunkMarkdown(tail, "尾块");
  assert(tailed[0]!.blocks.length === 1, "a small trailing paragraph joins the previous block (got " + tailed[0]!.blocks.length + ")");

  console.log(`chunk-text tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
