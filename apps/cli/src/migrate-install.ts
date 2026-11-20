// 旧安装迁移的独立入口（#311）。
//
// 什么时候用它：旧的三包布局还占着 `ans` 这个名字，新包装上去以后命令不一定
// 指向新包；或者装到一半、`ans` 根本跑不起来。这时候不能指望 `ans upgrade
// install` 能用——那正是要走这条路的原因。照文件路径直接跑：
//
//   node "$(npm root -g)/@anysearch-cli/cli/dist/migrate-install.js"
//
// Windows（PowerShell）：
//
//   node "$(npm root -g)\@anysearch-cli\cli\dist\migrate-install.js"
//
// 参数和 `ans upgrade install` 完全一样（同一段代码），所以看到什么、加不加
// --apply，两边行为一致。这里不加载主程序，只碰 node 内置模块和这一个迁移
// 模块，起得来就不依赖任何全局命令是否已经链好。

import { runUpgradeInstall } from "./commands/upgrade-install";

runUpgradeInstall(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    process.stderr.write("migrate-install: " + (error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  },
);
