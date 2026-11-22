// 归属判定共享信号：JSONC 和 TOML 两个编辑器共用一份正则，
// 改「什么算本工具条目」的规则只动这里。
// 依据：command 里认得出我们的 bin（bin 名可含连字符，如 ans-hook-session-start），
// 或 CodeBuddy 文档形态 command 里的 @anysearch-cli/ 包路径。

/** command 字段的归属信号：本工具 bin 或本工具包路径。 */
export const ANS_COMMAND_RE = /(?:ans-hook-[a-z0-9-]+|ans-mcp|ans-plugin-server|@anysearch-cli\/)/;
