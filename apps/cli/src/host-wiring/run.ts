// 编排：读现状 → 算差异 → 预览/备份 → 应用本工具条目 → 写后验证
// → 记录操作结果。一条龙跑完，中途任何一步失败都如实报告，不输出「总成功」。
// 铁律：
//   - 遇到冲突或解析不安全的文件：整体退出，一个字节不写（先报告再动手）。
//   - 每个文件写前备份原文；journal 先落 planned 再写，写一个记一个——中断
//     之后 status 能查到、repair 能续上。
//   - 密钥全程不看：接线不依赖任何 API key 配置。
//   - 写完重读验证：条目在不在、内容对不对，验证结果进 journal。

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveConfigHome, resolveLlmConfig } from "@anysearch-cli/store";
import { getHost, binOnPath, INSTALL_BINS, type HostDef, type UnitDef } from "./hosts.js";
import { writeJsoncPath, appendJsoncItem, removeJsoncPath, removeJsoncItem, findOurItems, readJsoncPath } from "./jsonc-edit.js";
import {
  setTomlNamedTable, appendTomlArrayTable, removeTomlNamedTable, removeTomlArrayTable,
  findOurArrayTables, codexHookSegmentIsOurs, canonicalJson, readTomlNamedTable,
} from "./toml-edit.js";
import {
  computePlan, planHasConflicts, planHasWrites, type HostPlan, type PlanMode, type UnitPlan,
} from "./plan.js";
import {
  appendEntry, backupFile, findInterrupted, shortHash, wiringRoot,
  type JournalEntry, type HostOp, type JournalFileRecord,
} from "./journal.js";
import { atomicRename } from "../fs-atomic.js";

export interface HostRunOptions {
  stdout?: (text: string) => void;
  projectRoot?: string;
  home?: string;
  /** 能力层探测用的环境（测试注入；不传用真实 env）。 */
  env?: NodeJS.ProcessEnv;
}

export interface HostRunResult {
  code: number;
  plan?: HostPlan;
}

function newEntryId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 计划 → 预览文本（+ 新增 / ~ 更新 / - 移除 / = 不动 / · 无事 / ! 冲突）。 */
export function renderPlan(plan: HostPlan): string[] {
  const lines: string[] = [];
  for (const file of plan.files) {
    lines.push(`文件 ${file.absPath}${file.exists ? "" : "（不存在，将新建）"}`);
    for (const unit of file.units) {
      const mark = unit.action === "add" ? "+"
        : unit.action === "replace" ? "~"
        : unit.action === "remove" ? "-"
        : unit.action === "unchanged" ? "="
        : unit.action === "n/a" ? "·"
        : "!";
      lines.push(`  ${mark} ${unit.unit.id}：${unit.note}`);
    }
  }
  return lines;
}

/** 单元应用（返回新文本或失败信息）。action 只有三种写动作。 */
function applyUnit(
  text: string,
  unit: UnitPlan,
  action: "add" | "replace" | "remove",
  format: "jsonc" | "toml",
): { ok: true; text: string } | { ok: false; message: string } {
  const u = unit.unit;
  try {
    if (format === "jsonc") {
      if (u.type === "json-key") {
        if (action === "remove") {
          const r = removeJsoncPath(text, u.path);
          return r.ok ? { ok: true, text: r.text } : { ok: false, message: r.error.message };
        }
        const r = writeJsoncPath(text, u.path, u.candidate);
        return r.ok ? { ok: true, text: r.text } : { ok: false, message: r.error.message };
      }
      if (u.type === "json-hook-array") {
        if (action === "remove") {
          // 删光我们的条目（从后往前，下标不漂移）。
          let current = text;
          for (;;) {
            const ours = findOurItems(current, u.path);
            if (ours === null || !Array.isArray(ours) || ours.length === 0) break;
            const r = removeJsoncItem(current, u.path, ours[ours.length - 1]);
            if (!r.ok) return { ok: false, message: r.error.message };
            current = r.text;
          }
          // 删完剩空数组壳 → 连键一起收走（空 hooks 数组没有意义；里面还有
          // 别人的条目就原样保留，不碰）。
          const probe = readJsoncPath(current, u.path);
          if (probe.ok && Array.isArray(probe.value) && probe.value.length === 0) {
            const r = removeJsoncPath(current, u.path);
            if (!r.ok) return { ok: false, message: r.error.message };
            current = r.text;
          }
          return { ok: true, text: current };
        }
        if (action === "replace") {
          const ours = findOurItems(text, u.path);
          if (ours === null || !Array.isArray(ours) || ours.length !== 1) {
            return { ok: false, message: "替换时没找到唯一一条我们的条目" };
          }
          const removed = removeJsoncItem(text, u.path, ours[0]);
          if (!removed.ok) return { ok: false, message: removed.error.message };
          const r = appendJsoncItem(removed.text, u.path, u.candidate);
          return r.ok ? { ok: true, text: r.text } : { ok: false, message: r.error.message };
        }
        const r = appendJsoncItem(text, u.path, u.candidate);
        return r.ok ? { ok: true, text: r.text } : { ok: false, message: r.error.message };
      }
      return { ok: false, message: "unknown jsonc unit type" };
    }
    // TOML。
    if (u.type === "toml-named-table") {
      const r = action === "remove"
        ? removeTomlNamedTable(text, u.name)
        : setTomlNamedTable(text, u.name, u.candidate);
      return r.ok ? { ok: true, text: r.text } : { ok: false, message: r.error.message };
    }
    if (u.type === "toml-array-table") {
      if (action === "remove" || action === "replace") {
        // 删当前我们的段（canonical 匹配；replace 时可能有零段或一段）。
        const ours = findOurArrayTables(text, u.name, codexHookSegmentIsOurs);
        if (ours !== null && !Array.isArray(ours)) {
          return { ok: false, message: ours.message };
        }
        let current = text;
        if (Array.isArray(ours)) {
          for (const seg of ours) {
            const r = removeTomlArrayTable(current, u.name, seg.values);
            if (!r.ok) return { ok: false, message: r.error.message };
            current = r.text;
          }
        }
        if (action === "remove") return { ok: true, text: current };
        const added = appendTomlArrayTable(current, u.name, u.candidate);
        return added.ok ? { ok: true, text: added.text } : { ok: false, message: added.error.message };
      }
      const r = appendTomlArrayTable(text, u.name, u.candidate);
      return r.ok ? { ok: true, text: r.text } : { ok: false, message: r.error.message };
    }
    return { ok: false, message: "unknown toml unit type" };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/**
 * 原子写盘：同目录 tmp + rename（Windows 争用走有界重试）。
 * 权限三条：tmp 先给 0o600（仅当前用户）；已有目标文件的 mode 原样继承
 * （POSIX 上 rename 不继承权限，明改）；备份写入时同样给 0o600。这样别的
 * MCP 条目里可能带的密钥不会被一次接入放宽成全世界可读。
 */
function writeAtomic(absPath: string, content: string, entryId: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const base = absPath.split(/[\\/]/).pop() ?? "file";
  const tmp = join(dirname(absPath), `.${base}.tmp-anshost-${entryId}`);
  writeFileSync(tmp, content, "utf8");
  try {
    chmodSync(tmp, 0o600);
    // 已有目标文件的权限原样继承；新文件就用 0o600。
    try {
      const mode = statSync(absPath).mode & 0o777;
      chmodSync(tmp, mode);
    } catch {
      // 目标不存在（新建）→ 保持 0o600。
    }
  } catch {
    // chmod 不可用（个别平台）→ 不阻断写入，权限尽量收紧。
  }
  atomicRename(tmp, absPath);
}

/**
 * 写后验证：重读文件，逐单元核对。期望 canonical === expected（remove 时期望
 * undefined = 我们的条目不在了）。
 */
function verifyFile(
  file: HostPlan["files"][number],
  expectedById: Map<string, string | undefined>,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  let text: string;
  try {
    text = readFileSync(file.absPath, "utf8");
  } catch (e) {
    return { ok: false, problems: [`读不回来：${(e as Error).message}`] };
  }
  for (const unit of file.file.units) {
    if (!expectedById.has(unit.id)) continue; // 该单元没参与本次写入，不查
    const expected = expectedById.get(unit.id);
    const probe = presenceCanonical(text, unit);
    if (probe.message) { problems.push(`${unit.id}：${probe.message}`); continue; }
    if (probe.canonical !== expected) {
      problems.push(`${unit.id}：写后内容跟预期对不上`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** 一个单元当前「我们的条目」canonical（验证用；没有 → undefined）。 */
function presenceCanonical(text: string, unit: UnitDef): { canonical?: string; message?: string } {
  try {
    if (unit.type === "json-key") {
      const probe = readJsoncPath(text, unit.path);
      if (!probe.ok) return { message: probe.error.message };
      return { canonical: probe.value === undefined ? undefined : canonicalJson(probe.value) };
    }
    if (unit.type === "json-hook-array") {
      const ours = findOurItems(text, unit.path);
      if (ours === null) return { canonical: undefined };
      if (!Array.isArray(ours)) return { message: ours.message };
      if (ours.length === 0) return { canonical: undefined };
      const arr = readJsoncPath(text, unit.path);
      if (!arr.ok || !Array.isArray(arr.value)) return { message: "hooks 数组读不回来了" };
      const arrValue = arr.value as unknown[];
      return { canonical: ours.length === 1 ? canonicalJson(arrValue[ours[0]]) : canonicalJson(ours.map((i) => arrValue[i])) };
    }
    if (unit.type === "toml-named-table") {
      const seg = readTomlNamedTable(text, unit.name);
      if (seg === undefined) return { canonical: undefined };
      if ("reason" in seg) return { message: String(seg.message) };
      return { canonical: canonicalJson(seg) };
    }
    if (unit.type === "toml-array-table") {
      const ours = findOurArrayTables(text, unit.name, codexHookSegmentIsOurs);
      if (ours === null) return { canonical: undefined };
      if (!Array.isArray(ours)) return { message: ours.message };
      if (ours.length === 0) return { canonical: undefined };
      return { canonical: ours.length === 1 ? canonicalJson(ours[0].values) : canonicalJson(ours.map((o) => o.values)) };
    }
    return { message: "unknown unit type" };
  } catch (e) {
    return { message: (e as Error).message };
  }
}

function candidateCanonicalOf(unit: UnitDef): string {
  return canonicalJson(unit.candidate);
}

/** 读文件；读不出来返回 null（区别于「不存在」——写前比对和收尾都靠它）。 */
function readFileSyncSafe(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 收尾一条已中断的记录（文件其实都写完了、幂等路径用）：当前计划是按中断
 * 记录的原始方向刚重读磁盘算出来的——每个单元都达到 unchanged/n/a（即该在
 * 都在、该删的都没了）才会走到这里。收尾前实际重跑一遍写后验证（按中断方向
 * 的期望逐单元比对磁盘现状），全过才补一条 done 行——不是把「没验证过」的
 * 记录直接标成已验证。返回 true = 收尾成功。
 */
async function closeInterruptedRecord(
  plan: HostPlan,
  interrupted: JournalEntry,
  projectRoot: string,
  home: string,
  out: (text: string) => void,
): Promise<boolean> {
  const mode = interrupted.op;
  let verified = true;
  for (const file of plan.files) {
    if (readFileSyncSafe(file.absPath) === null && file.file.scope === "project") return false;
    if (file.units.some((u) => u.action === "conflict" || u.action === "blocked")) {
      out(`  ! ${file.absPath}：中断的 ${mode} 无法安全收尾（现状跟预期不一致），需要人工看\n`);
      return false;
    }
    // 实际重验：期望 = 该单元达到中断方向的目标状态（connect 方向就是候选
    // 内容；remove 方向就是我们的条目不在）。verifyFile 重读磁盘比对。
    const expectedById = new Map<string, string | undefined>();
    for (const unit of file.units) {
      expectedById.set(unit.unit.id, mode === "remove" ? undefined : candidateCanonicalOf(unit.unit));
    }
    const check = verifyFile(file, expectedById);
    if (!check.ok) {
      verified = false;
      for (const problem of check.problems) out(`  ! ${file.absPath}：${problem}\n`);
    }
  }
  // 补 done 行（沿用中断记录的 id；verified 按实际重验结果写）。
  const roots = new Set(plan.files.map((f) => wiringRoot(f.file.scope, projectRoot, home)));
  for (const root of roots) {
    appendEntry(root, {
      ...interrupted,
      status: verified ? "done" : "partial",
      ts: new Date().toISOString(),
      files: interrupted.files.map((f) => ({ ...f, written: true, verified })),
    });
  }
  return verified;
}

/** 计划涉及的所有 scope 里，该宿主最近一次没做完的操作（中断诊断用）。 */
function probeInterrupted(plan: HostPlan, projectRoot: string, home: string): JournalEntry | null {
  const roots = new Set(plan.files.map((f) => wiringRoot(f.file.scope, projectRoot, home)));
  return [...roots].map((r) => findInterrupted(r, plan.host.id)).find((e) => e !== null) ?? null;
}

// ---------------------------------------------------------------------------
// 主入口：connect / repair / remove / preview
// ---------------------------------------------------------------------------

export async function runHostOperation(
  op: HostOp | "preview",
  hostId: string,
  opts: HostRunOptions = {},
): Promise<HostRunResult> {
  const out = opts.stdout ?? ((text: string) => process.stdout.write(text));
  const projectRoot = opts.projectRoot ?? process.cwd();
  const home = opts.home ?? resolveConfigHome();
  const host = getHost(hostId);
  if (!host) {
    out(`没有这个宿主：${hostId}（可用：claude、codebuddy、codex、antigravity）\n`);
    return { code: 2 };
  }
  if (!existsSync(projectRoot)) {
    out(`项目目录不存在：${projectRoot}\n`);
    return { code: 2 };
  }
  const mode: PlanMode = op === "preview" ? "connect" : op;
  // repair 续收：按中断记录的原始操作方向算计划（不能把中断的移除又接回去）；
  // 没有中断记录时才按 connect 方向修「缺/老」。
  const interruptedBefore = op === "repair"
    ? probeInterrupted(computePlan(host, "connect", { projectRoot, home }), projectRoot, home)
    : null;
  const effectiveMode: PlanMode = op === "repair" && interruptedBefore ? interruptedBefore.op : mode;
  const plan = computePlan(host, effectiveMode, { projectRoot, home });

  // ---- 预览：只算不动 ----
  if (op === "preview") {
    out(`预览——宿主 ${host.id}（${host.title}），项目 ${projectRoot}，本次不会写任何文件：\n`);
    for (const line of renderPlan(plan)) out(line + "\n");
    if (!planHasWrites(plan, "connect")) out("结论：已经是想要的形态，接入无需改动（幂等）。\n");
    return { code: 0, plan };
  }

  // ---- 冲突/不安全：先报告，整体退出，一个字节不写 ----
  if (planHasConflicts(plan)) {
    out(`发现问题，${op} 没有动任何文件（先处理下面这些再来）：\n`);
    for (const file of plan.files) {
      for (const unit of file.units) {
        if (unit.action === "conflict" || unit.action === "blocked") {
          out(`  ! ${file.absPath} → ${unit.unit.id}：${unit.note}\n`);
        }
      }
    }
    return { code: 1, plan };
  }

  // ---- 幂等：没有要写的东西 ----
  if (!planHasWrites(plan, effectiveMode)) {
    // 文件已全部到位时也要收尾可能存在的中断记录（验证现状 + 补 done 行），
    // 否则 status 会永远催修复。没有中断就是纯幂等。
    if (interruptedBefore) {
      const closed = await closeInterruptedRecord(plan, interruptedBefore, projectRoot, home, out);
      if (closed) {
        out(`修复 ${host.id}：上次没做完的操作已验证到位，日志收尾完成（没有需要改动的条目，文件一个没动）。\n`);
        return { code: 0, plan };
      }
    }
    out(`${op === "remove" ? "移除" : "接入"} ${host.id}：没有需要改动的条目（幂等），文件一个都没动。\n`);
    return { code: 0, plan };
  }

  // ---- 写阶段 ----
  const entryId = newEntryId();
  const ts = new Date().toISOString();
  // 文件记录基于计划完整列表（不是只含已写文件）：中断时 status 才能准确报
  // 「哪个文件没写」，已完成项的备份路径也保留。
  const fileRecords: JournalFileRecord[] = plan.files.map((f) => ({
    path: f.absPath, scope: f.file.scope,
    backup: undefined, beforeHash: undefined, afterHash: undefined,
    written: false, verified: false,
  }));
  const unitsAfter: Record<string, string> = {};
  const opLabel = op === "connect" ? "接入" : op === "repair" ? "修复" : "移除";
  const interrupted = probeInterrupted(plan, projectRoot, home);
  const roots = new Set(plan.files.map((f) => wiringRoot(f.file.scope, projectRoot, home)));

  // journal 先落 planned（中断可诊断的第一步）。
  const plannedEntry: JournalEntry = {
    id: entryId, ts, op, host: host.id, status: "planned",
    files: plan.files.map((f) => ({
      path: f.absPath, scope: f.file.scope,
      backup: undefined, beforeHash: undefined, afterHash: undefined,
      written: false, verified: false,
    })),
    units: {},
  };
  for (const root of roots) appendEntry(root, plannedEntry);

  if (interrupted) {
    out(`发现上次 ${interrupted.op} 没做完（${interrupted.ts} 开始的那次）；本次按当前文件现状续收。\n`);
  }

  out(`${opLabel} ${host.id}——改动如下（写前已备份原文）：\n`);
  let failed = false;
  for (const file of plan.files) {
    const actingUnits = file.units.filter((u) =>
      effectiveMode === "remove" ? u.action === "remove" : u.action === "add" || u.action === "replace",
    );
    if (actingUnits.length === 0) continue;
    let currentText = file.currentText ?? (file.file.format === "jsonc" ? "{}" : "");
    // 写前重读比对：计划读取后文件被宿主/编辑器保存过，继续写会拿旧副本盖
    // 掉新内容。比对不一致 → 保留现场报冲突，绝不覆盖。
    if (file.exists) {
      const now = readFileSyncSafe(file.absPath);
      if (now === null) {
        out(`  ! ${file.absPath}：写前重读失败——文件可能被锁/权限变了，这个文件不动\n`);
        failed = true;
        break;
      }
      if (file.currentText !== null && now !== file.currentText) {
        out(`  ! ${file.absPath}：写前发现内容变了（计划读取后有人保存过）——保留现场不覆盖，重新跑一次本命令再试\n`);
        failed = true;
        break;
      }
    }
    // 备份（原文件存在时）。
    let backupPath: string | undefined;
    if (file.exists && file.currentText !== null) {
      const root = wiringRoot(file.file.scope, projectRoot, home);
      backupPath = backupFile(root, entryId, file.absPath, file.currentText);
      const record = fileRecords.find((r) => r.path === file.absPath);
      if (record) record.backup = backupPath;
    }
    // 逐单元应用。
    for (const unit of actingUnits) {
      const action = unit.action === "add" || unit.action === "replace" ? unit.action : "remove";
      const applied = applyUnit(currentText, unit, action as "add" | "replace" | "remove", file.file.format);
      if (!applied.ok) {
        out(`  ! ${file.absPath} → ${unit.unit.id}：编辑失败，这一步停了——${applied.message}\n`);
        failed = true;
        break;
      }
      currentText = applied.text;
      const mark = action === "add" ? "+" : action === "replace" ? "~" : "-";
      out(`  ${mark} ${unit.unit.id}：${unit.note}\n`);
      // 已写单元的基线即时入账：中断后 partial 行里也有这部分记录，续修时
      // 归因（你改过 vs 没有我们写过的记录）才准。
      if (effectiveMode !== "remove") unitsAfter[unit.unit.id] = candidateCanonicalOf(unit.unit);
    }
    if (failed) break;
    // 原子写盘。
    try {
      writeAtomic(file.absPath, currentText, entryId);
    } catch (e) {
      out(`  ! ${file.absPath}：写盘失败——${(e as Error).message}\n`);
      failed = true;
      break;
    }
    // journal：该文件写完（partial 行）——按路径更新既有记录，未写文件仍在列表里。
    const record = fileRecords.find((r) => r.path === file.absPath);
    if (record) {
      record.backup = backupPath;
      record.beforeHash = file.currentText === null ? undefined : shortHash(file.currentText);
      record.afterHash = shortHash(currentText);
      record.written = true;
      record.verified = false;
    }
    for (const root of roots) {
      appendEntry(root, { ...plannedEntry, status: "partial", files: [...fileRecords], units: { ...unitsAfter } });
    }
  }

  if (failed) {
    out(`${opLabel} 中途失败：有文件没写完。运行 ans host status ${host.id} 查看中断位置；备份和已写文件都有记录，修复可以继续。\n`);
    return { code: 1, plan };
  }

  // ---- 写后验证 ----
  let verified = true;
  for (const file of plan.files) {
    const actingUnits = file.units.filter((u) =>
      effectiveMode === "remove" ? u.action === "remove" : u.action === "add" || u.action === "replace",
    );
    if (actingUnits.length === 0) continue;
    const expectedById = new Map<string, string | undefined>();
    for (const u of actingUnits) {
      expectedById.set(u.unit.id, effectiveMode === "remove" ? undefined : candidateCanonicalOf(u.unit));
    }
    const check = verifyFile(file, expectedById);
    const record = fileRecords.find((r) => r.path === file.absPath);
    if (check.ok) {
      if (record) record.verified = true;
      out(`  ✓ ${file.absPath}：写后验证通过\n`);
    } else {
      verified = false;
      for (const problem of check.problems) out(`  ! ${file.absPath}：${problem}\n`);
    }
  }

  // journal 收尾：done 行。基线记全单元（不只本次动过的）：unchanged 的单元也
  // 记下来，下次用户改动时归因才准（是「你改过」而不是「没有我们写过的记录」）。
  if (effectiveMode !== "remove") {
    for (const file of plan.files) {
      for (const unit of file.units) {
        unitsAfter[unit.unit.id] = candidateCanonicalOf(unit.unit);
      }
    }
  }
  for (const root of roots) {
    appendEntry(root, {
      ...plannedEntry, status: verified ? "done" : "partial",
      files: [...fileRecords], units: effectiveMode === "remove" ? {} : { ...unitsAfter },
    });
  }

  // ---- 收尾 ----
  if (verified) {
    out(`${opLabel}完成。备份在 host-wiring\\backups\\${entryId}\\ 下。\n`);
    if (op !== "remove") {
      out("待办（配置写入不代表宿主已生效）：\n");
      for (const todo of host.todoAfterConnect) out(`  - ${todo}\n`);
    } else {
      out("移除只摘了本工具在宿主配置里的条目；资料、对话、账目和凭据都没动。\n");
    }
  } else {
    out(`${opLabel}写完但验证没全过：条目内容跟预期对不上，看上面 ! 的行；备份在，可修复。\n`);
  }
  return { code: verified ? 0 : 1, plan };
}

// ---------------------------------------------------------------------------
// status：分层报告（安装 / 接线 / 宿主验证 / 能力）
// ---------------------------------------------------------------------------

export function runHostStatus(
  hostIds: string[],
  opts: HostRunOptions = {},
): HostRunResult {
  const out = opts.stdout ?? ((text: string) => process.stdout.write(text));
  const projectRoot = opts.projectRoot ?? process.cwd();
  const home = opts.home ?? resolveConfigHome();
  const lines: string[] = [];

  // 安装层：接线命令是不是当前完整安装提供的（只找文件，不执行进程）。
  lines.push("[安装] 完整安装的接线命令（PATH 探测，只找文件不执行）：");
  const missing = INSTALL_BINS.filter((b) => !binOnPath(b));
  if (missing.length === 0) {
    lines.push(`  ✓ 全部就位（${INSTALL_BINS.length} 个 bin 都能找到）`);
  } else {
    lines.push(`  ! 未找到：${missing.join("、")}（安装层不完整——不影响下面各层，如实分开说）`);
  }

  // 接线层 + 宿主验证层。
  for (const hostId of hostIds) {
    const host = getHost(hostId);
    if (!host) { lines.push(`宿主 ${hostId}：没有这个宿主`); continue; }
    const plan = computePlan(host, "connect", { projectRoot, home });
    lines.push(`[接线] ${host.id}（${host.title}）：`);
    const interrupted = probeInterrupted(plan, projectRoot, home);
    if (interrupted) {
      const unwritten = interrupted.files.filter((f) => !f.written).map((f) => f.path);
      lines.push(`  ! 上次 ${interrupted.op} 中断（${interrupted.ts}）：${
        unwritten.length > 0 ? unwritten.join("、") + " 没写" : "有文件写了但没验证"
      }——先跑 ans host repair ${host.id} 续上`);
    }
    for (const file of plan.files) {
      for (const unit of file.units) {
        const mark = unit.action === "unchanged" ? "✓" : unit.action === "add" ? "·" : "!";
        lines.push(`  ${mark} ${file.absPath} → ${unit.unit.id}：${
          unit.action === "unchanged" ? "在位（内容就是想要的）" : unit.note}`);
      }
    }
    lines.push("  [宿主验证] 未验证——本工具只证明配置写入；宿主真实执行见各专文记录，不冒充跑过");
  }

  // 能力层：模型能力独立标未配置——只看「设了没」，不读值本身；
  // 缺配置不阻断接入，两层各说各的。
  const env = opts.env ?? process.env;
  lines.push("[能力] 模型能力（独立于接线，缺配置不阻断接入；只看设没设，不显示值）：");
  const envKeys = ["ANS_LLM_API_KEY", "ANYSEARCH_API_KEY", "EXA_API_KEY", "TAVILY_API_KEY"];
  for (const key of envKeys) {
    lines.push(`  · ${key}：${env[key] && String(env[key]).length > 0 ? "已设置" : "未设置"}`);
  }
  const llm = resolveLlmConfig({ cwd: projectRoot, home, env, warn: () => {} });
  lines.push(`  · 模型 provider：${llm.provider ? `已配置（${llm.sources.provider ?? "?"} 层）` : "未配置"}`);
  lines.push(`  · 模型 model：${llm.model ? `已配置（${llm.sources.model ?? "?"} 层）` : "未配置"}`);
  lines.push("  · 密钥本身一个都不看：接线命令全程不读密钥值；这里只报设没设");

  out(lines.join("\n") + "\n");
  return { code: 0 };
}
