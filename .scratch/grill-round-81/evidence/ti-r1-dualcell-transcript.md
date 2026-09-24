# TI R1 幂等跳过——双格实测 transcript（落档自 ctx 索引）

Date: 2026-09-24. 取证戳 = **2026-09-24T08:44:11.961Z**。审计 F-3 随修：本 transcript 原始执行于 ctx_batch_execute（label r1-dualcell / cellb-unpub），本文件为落仓归档。验收纪律：禁 `npm publish --dry-run` 替身、禁模拟 registry——全部真 npmjs 查询。

## 被测体

release.yml publish 腿抽出的同码函数（`publish_one` 中 `npm publish` 行以 `echo WOULD-PUBLISH` 占位——验收对象是 check/skip 判定分支与 publish 分支进入条件，非 publish 网络动作本身）：

```bash
spec_of() {
  tar -xzf "$1" -O package/package.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.name+'@'+j.version)})"
}
publish_one() {
  local tgz="$1" spec out
  spec="$(spec_of "$tgz")"
  if npm view "$spec" version >/dev/null 2>&1; then
    echo "::notice::skip $spec — already published"
    return 0
  fi
  echo "==> npm publish $tgz ($spec)"
  if ! out="$(npm publish "$tgz" --provenance --access public 2>&1)"; then
    if printf '%s' "$out" | grep -qiE 'cannot publish over|EPUBLISHCONFLICT|already published'; then
      echo "::notice::skip $spec — registry reports already published"
      return 0
    fi
    printf '%s\n' "$out" >&2
    return 1
  fi
  printf '%s\n' "$out"
}
```

## CELL-A — 已发包 → skip（registry 真 tarball）

```
$ npm pack @anysearch-cli/embedding@0.0.7 --silent   # 真 registry tarball
anysearch-cli-embedding-0.0.7.tgz
$ publish_one anysearch-cli-embedding-0.0.7.tgz
::notice::skip @anysearch-cli/embedding@0.0.7 — already published
CELL-A-EXIT=0
```

## CELL-B — 已发包（本仓 pnpm pack 的 0.0.8，当时已落 registry）→ skip

```
$ pnpm pack --pack-destination $D        # packages/embedding 本仓 0.0.8
$ publish_one anysearch-cli-embedding-0.0.8.tgz
::notice::skip @anysearch-cli/embedding@0.0.8 — already published
CELL-B-EXIT=0
```

（0.0.8 已发为插曲事件 1 实态——本格意外成为更强的正例：真已发版 tarball 走 check→skip。）

## CELL-B2 — 未发包（改造 tarball version=99.99.99）→ publish 分支不误伤

```
$ mkdir x && tar xzf anysearch-cli-embedding-0.0.7.tgz -C x
$ node -e "...j.version='99.99.99';fs.writeFileSync(p,JSON.stringify(j))"
$ tar czf fake-unpub.tgz -C x package
$ publish_one fake-unpub.tgz
==> npm publish fake-unpub.tgz (@anysearch-cli/embedding@99.99.99)
WOULD-PUBLISH
CELL-B2-EXIT=0
```

## CELL-C — npm view 不存在版本 → E404 非零（check 不误判存在的负面对照）

```
$ npm view @anysearch-cli/embedding@99.99.99 version
npm error code E404
npm error 404 No match found for version 99.99.99
npmview-missing-exit=1
```

## 语法腿

<!-- machine-local: 抽取的 run 块临时文件落在主机 /tmp（Git Bash 临时目录） @ 2026-09-24 -->
```
$ # 抽 release.yml publish step run 块
$ bash -n /tmp/pubstep.sh → PUBSTEP-SYNTAX-OK
```

## 判定

| 格 | 语义 | 结果 |
|---|---|---|
| CELL-A | 已发包 → check 命中 → skip 记录不失败 | PASS |
| CELL-B | 已发包（本仓包，0.0.8 已发态）→ skip | PASS |
| CELL-B2 | 未发包 → 不误判 skip，进入 publish 分支 | PASS |
| CELL-C | npm view 不存在版本 → E404 非零 | PASS |
| 语法 | bash -n run 块 | PASS |

TOCTOU 兜底（E403/EPUBLISHCONFLICT/already-published→skip）为代码路径断言（grep -qiE 命中集），CI 真复跑时生效。
