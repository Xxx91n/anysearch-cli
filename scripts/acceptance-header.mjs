// 版本由调用方给，而且必须是真正被测的那一份（装进去的包，不是检出）。

export function printAcceptanceHeader({ product, version, notes = [] }) {
  if (!product || !version) {
    throw new Error("printAcceptanceHeader: product 和 version 都必须给，且来自真正被测的那一份");
  }
  console.log("== 验收对象 ==");
  console.log("  产品版本: " + product + "@" + version);
  console.log("  系统: " + process.platform + " " + process.arch + " / Node " + process.version);
  console.log("  日期: " + new Date().toISOString());
  for (const note of notes) console.log("  " + note);
}
