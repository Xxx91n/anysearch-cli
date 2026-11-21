// 版本由调用方给，而且必须是真正被测的那一份（装进去的包，不是检出）。

export function printAcceptanceHeader({ product, version, notes = [] }) {
  // 缺参数不抛：抛了会把整条车道在门口打死，记 FAIL 是调用方的事，这里照实写。
  console.log("== 验收对象 ==");
  console.log("  产品版本: " + (product || "未知产品") + "@" + (version || "读不出来"));
  console.log("  系统: " + process.platform + " " + process.arch + " / Node " + process.version);
  console.log("  日期: " + new Date().toISOString());
  for (const note of notes) console.log("  " + note);
}
