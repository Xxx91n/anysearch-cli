<!-- coderabbit-ai-generated:v1 -->

# 新建对话和续聊

`ans chat "问题"` 每次新建对话，并显示 `[session] ID`。

- `ans chat --continue "问题"`：续当前项目最近一段对话。
- `ans chat --session ID "问题"`：续指定对话，换目录也能用。
- `ans chat --list`：查看当前项目的会话。
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:5bd0c26bdcf2060f7c654a2315677c323bd91336a4bbb07f86555ef6a26b5f9d -->

- `ans chat --list --unassigned`：查看旧会话和没有可靠项目归属的记录。列表会标出没有完整对话记录的条目，这些条目不能当作完整对话续聊。

<!-- /coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:7e1e109bf0a268e21f02c80e208865ed943a76aab1af7b5e8d798e360ffc8f94 -->

明确续聊会恢复完整问答和既有记忆。`ANS_SESSION_ID` 只用于观测记录，不会自动续聊；要恢复原先使用的句柄，请传 `--session ID`。句柄以短横线开头时可用 `--session=ID`。

<!-- /coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:586498666897306c1e6deb346a3210c543dcefdd4dbd7060924d2557831780ef -->

项目按最近的 Git 根目录（含 worktree）或 `.anysearch/config.toml` 所在目录识别，并使用真实路径。找不到时不能自动续最近会话或查看当前项目列表；新对话和未归属列表仍可使用。这个解析结果用于本地 CLI，不代表服务器可以信任客户端随意传来的路径。

<!-- /coderabbit-ai-generated:v1 -->

旧会话不猜归属，跨目录续聊也不会改变原归属。<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:f0dd4455ee0dc10da78086ec2bed377a0b0b7c2cbfb64ef06029e00a900f7253 -->

新增的 `chat_projects` 表记录项目、最近使用时间和是否完成，不改写旧会话、账目或研究材料。

<!-- /coderabbit-ai-generated:v1 -->`~/.anysearch-cli/session` 继续用于观测记录，不再自动选择聊天历史。共享研究资料仍可召回，预算规则由 #300 承接，本票不改。

## 验收范围

对应 #297 S3/S4、T2/T4 的会话和资料部分。安装后验收脚本沿用现有两轮问题和假模型端点，检查默认新建、完整续聊、项目范围、跨目录恢复和旧记录未归属。原有跨会话资料召回车道保留。补充测试检查路径规范化、项目记录重开和明确句柄的选择。

检查、构建及测试交由远端 CI；没有远端结果时不能宣称验收通过。模拟旧库只能证明该固定样本的迁移，不能证明所有历史版本都兼容。
