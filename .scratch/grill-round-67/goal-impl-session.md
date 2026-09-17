# R67 impl-session goal（防丢失）

身份：修复/开发子 Agent。任务书：D:\Aworker\anysearch-cli\.scratch\grill-round-67\handoffs\next-round.md

目标：串行执行 T1-T7。先 B（Codex CLI 0.142.5 真宿主验证：Track A published 0.0.4 契约形态 smoke 裁决 + Track B tarball P1-P9）后 A（0.0.5 OIDC TP 发布，session-start 修复随车）。

验收（用户原文）：编译通过、打包通过、启动并测活软件进程；每个平台都要有 test 闭环，避免只引入却没做到。

硬门：B 段不绿不开 T6；publish/tag/push 当场授权；改文件前备份；VC 写一律 but；密钥不落盘。

现场：e2e=D:\Aworker\e2e-r67-codex（仓外）；证据=.scratch\grill-round-67\evidence\；脚本=.scratch\grill-round-67\scripts\；备份=.scratch\grill-round-67\backups\
