// 验收车道的公共抬头：这一轮验的是哪个包、哪一版、什么系统、什么时候。
//
// 版本由调用方给，而且必须是真正被测的那一份：从检出里读 package.json 在
// 「装的是别处打好的包」时就会记错对象，那种报告说不清是给谁出的。

export function printAcceptanceHeader({ product, version, notes = [] }) {
  console.log("== 验收对象 ==");
  console.log("  产品版本: " + product + "@" + version);
  console.log("  系统: " + process.platform + " " + process.arch + " / Node " + process.version);
  console.log("  日期: " + new Date().toISOString());
  for (const note of notes) console.log("  " + note);
}
