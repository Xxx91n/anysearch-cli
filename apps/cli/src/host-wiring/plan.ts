// 差异计算：读现状 → 对照候选 → 每单元给出动作。
// 动作语义（大白话）：
//   add       还没有我们的条目，准备加
//   replace   有我们的老条目，准备换成新候选（仅当条目仍是基线内容）
//   unchanged 已经是想要的形态，什么都不动（幂等）
//   conflict  有东西但没法证明是我们写的（或用户后来改过）→ 保留现场，不写
//   n/a       移除时没有我们的条目（幂等空操作）
// 文件解析不安全（语法错）→ 该文件整体 blocked，一个字节不写。
// 冲突基线来自 journal 里上次我们写入的规范化内容（见 journal.ts）。

import { existsSync, readFileSync } from "node:fs";
import { resolveConfigHome } from "@anysearch-cli/store";
import { join } from "node:path";
import type { HostDef, HostFileDef, UnitDef } from "./hosts.js";
import type { JsoncPath } from "./jsonc-edit.js";
import { readJsoncPath, findOurItems, parseJsonc, hookEntryIsMixed } from "./jsonc-edit.js";
import { readTomlNamedTable, findOurArrayTables, codexHookSegmentIsOurs, codexHookSegmentIsMixed, canonicalJson, parseTomlSafe } from "./toml-edit.js";
import { baselineEntryFor, wiringRoot } from "./journal.js";

export type UnitActionKind = "add" | "replace" | "remove" | "unchanged" | "n/a" | "conflict" | "blocked";

export interface UnitPlan {
  unit: UnitDef;
  action: UnitActionKind;
  /** 当前条目的规范化内容（我们的条目或归属键），没有 → undefined。 */
  currentCanonical?: string;
  /** journal 基线（上次我们写入的规范化内容），没有记录 → undefined。 */
  baselineCanonical?: string;
  /** 人话说明（预览/报告直接用）。 */
  note: string;
}

export interface FilePlan {
  file: HostFileDef;
  absPath: string;
  exists: boolean;
  /** 文件当前原文；不存在或读失败 → null。读失败 ≠ 不存在，见 readFailed。 */
  currentText: string | null;
  /** 文件在但读不出来（权限/被锁）——按不安全处理，绝不当成新建。 */
  readFailed?: string;
  /** 解析不安全（语法错）→ 该文件所有单元 blocked。 */
  unsafe?: string;
  units: UnitPlan[];
}

export interface HostPlan {
  host: HostDef;
  projectRoot: string;
  home: string;
  files: FilePlan[];
}

/** 冲突归类：有东西，但跟候选/基线对不上时的具体原因。 */
type ForeignState = "foreign" | "modified";

/** 把「当前内容 vs 候选 vs 基线」归类。 */
function classify(
  currentCanonical: string | undefined,
  candidateCanonical: string,
  baselineCanonical: string | undefined,
): "missing" | "unchanged" | "stale-ours" | ForeignState {
  if (currentCanonical === undefined) return "missing";
  if (currentCanonical === candidateCanonical) return "unchanged";
  if (baselineCanonical === undefined) return "foreign";
  if (currentCanonical === baselineCanonical) return "stale-ours";
  return "modified";
}

function actionForConnect(state: ReturnType<typeof classify>): UnitActionKind {
  switch (state) {
    case "missing": return "add";
    case "unchanged": return "unchanged";
    case "stale-ours": return "replace";
    case "foreign": return "conflict";
    case "modified": return "conflict";
  }
}

function noteForConnect(unit: UnitDef, state: ReturnType<typeof classify>): string {
  switch (state) {
    case "missing": return "还没有我们的条目，准备新增";
    case "unchanged": return "已是想要的形态，不动（幂等）";
    case "stale-ours": return "是我们上次写的老版本，准备更新为新候选";
    case "foreign": return "位置上已有内容，但没有我们写过的记录——保留现场，不覆盖";
    case "modified": return "我们的条目后来被改过——保留现场，不覆盖";
  }
  void unit;
}

export type PlanMode = "connect" | "repair" | "remove";

/** 单元归属判定拿到的「我们的条目」下标或表段（含 canonical）。 */
interface Presence {
  /** 我们的条目/键的规范化内容；undefined = 没有我们的东西。 */
  oursCanonical?: string;
  /** 位置上有没有「别人的/未知的内容」（键存在但非我们写、多条目等）。 */
  foreignCanonical?: string;
  extra?: string;
}

function jsonKeyPresence(text: string, path: JsoncPath): Presence | { error: string } {
  const probe = readJsoncPath(text, path);
  if (!probe.ok) return { error: probe.error.message };
  if (probe.value === undefined) return {};
  return { oursCanonical: canonicalJson(probe.value) };
}

function jsonHookArrayPresence(text: string, path: JsoncPath): Presence | { error: string } {
  const ours = findOurItems(text, path);
  if (ours === null) return {};
  if (!Array.isArray(ours)) return { error: ours.message };
  if (ours.length === 0) return {};
  const values = readJsoncPath(text, path);
  if (!values.ok || !Array.isArray(values.value)) return { error: "array vanished while scanning" };
  const arrValue = values.value as unknown[];
  // 混合组：组里既有我们的命令也有别人的——删整组会连别人的命令删掉，保留现场。
  if (ours.some((index) => hookEntryIsMixed(arrValue[index]))) {
    return {
      oursCanonical: canonicalJson(values.value[ours[0]]),
      extra: "这条钩子组里还夹着别人的命令（我们只写自己的组）——保留现场，需要人工拆分",
    };
  }
  if (ours.length === 1) {
    return { oursCanonical: canonicalJson(values.value[ours[0]]), foreignCanonical: undefined };
  }
  return {
    oursCanonical: canonicalJson(values.value[ours[0]]),
    foreignCanonical: canonicalJson(values.value),
    extra: `发现 ${ours.length} 条归属本工具的条目（我们从不写两条），需要人工处理`,
  };
}

function tomlNamedPresence(text: string, name: string): Presence | { error: string } {
  // 先做 shape 检查：父键（如 mcp_servers）若已存在且不是表 → 没法安全落座。
  const guard = parseTomlSafe(text);
  if (!guard.ok) return { error: guard.error.message };
  const seg = readTomlNamedTable(text, name);
  if (seg === undefined) {
    // 父键类型检查：mcp_servers.anysearch 的父 mcp_servers。
    const parentKey = name.split(".").slice(0, -1).join(".");
    if (parentKey) {
      const parent = guard.value[parentKey];
      if (parent !== undefined && (parent === null || typeof parent !== "object" || Array.isArray(parent))) {
        return { error: `键 "${parentKey}" 已存在但不是表，没法安全落座 [${name}]` };
      }
    }
    return {};
  }
  if ("reason" in seg) return { error: String(seg.message) };
  return { oursCanonical: canonicalJson(seg) };
}

function tomlArrayTablePresence(text: string, name: string): Presence | { error: string } {
  const ours = findOurArrayTables(text, name, codexHookSegmentIsOurs);
  if (ours === null) return {};
  if (!Array.isArray(ours)) return { error: ours.message };
  if (ours.length === 0) return {};
  // 混合段：hooks[] 里既有我们的命令也有别人的——删整段会连别人的命令删掉。
  if (ours.some((seg) => codexHookSegmentIsMixed(seg.values))) {
    return {
      oursCanonical: canonicalJson(ours[0].values),
      extra: "这段 hooks 里还夹着别人的命令（我们只写自己的段）——保留现场，需要人工拆分",
    };
  }
  if (ours.length === 1) return { oursCanonical: canonicalJson(ours[0].values) };
  return {
    oursCanonical: canonicalJson(ours[0].values),
    foreignCanonical: canonicalJson(ours.map((o) => o.values)),
    extra: `发现 ${ours.length} 段归属本工具的 [[${name}]]，我们从不写两段，需要人工处理`,
  };
}

function presenceFor(text: string, unit: UnitDef): Presence | { error: string } {
  switch (unit.type) {
    case "json-key": return jsonKeyPresence(text, unit.path);
    case "json-hook-array": return jsonHookArrayPresence(text, unit.path);
    case "toml-named-table": return tomlNamedPresence(text, unit.name);
    case "toml-array-table": return tomlArrayTablePresence(text, unit.name);
  }
}

/** 计算（预览用）计划。mode 决定 remove 语义；connect/repair 差异语义一致。 */
export function computePlan(
  host: HostDef,
  mode: PlanMode,
  opts: { projectRoot: string; home?: string },
): HostPlan {
  const home = opts.home ?? resolveConfigHome();
  const plan: HostPlan = { host, projectRoot: opts.projectRoot, home, files: [] };
  for (const file of host.files) {
    const base = file.scope === "project" ? opts.projectRoot : home;
    const absPath = join(base, file.relPath);
    const exists = existsSync(absPath);
    let currentText: string | null = null;
    let readFailed: string | undefined;
    if (exists) {
      try {
        currentText = readFileSync(absPath, "utf8");
      } catch (e) {
        // 读失败 ≠ 文件不存在：按现状当新建会覆盖原配置，这里必须拦下。
        readFailed = (e as Error).message;
        currentText = null;
      }
    }
    // journal 基线（同 scope 的 wiring root）：取最近一条带单元记录的——
    // remove 的 done 行不带 units，基线要回溯到最近一次 connect/repair。
    const root = wiringRoot(file.scope, opts.projectRoot, home);
    const last = baselineEntryFor(root, host.id);
    const baselines = last?.units ?? {};
    const filePlan: FilePlan = { file, absPath, exists, currentText, units: [] };
    // 读失败：按不安全处理（绝不当成新建，避免覆盖原配置）。
    if (readFailed) {
      filePlan.readFailed = readFailed;
      for (const unit of file.units) {
        filePlan.units.push({
          unit, action: "blocked",
          note: `文件在但读不出来（${readFailed}）——怕覆盖你的配置，这个文件不动，先解决读取问题`,
        });
      }
      plan.files.push(filePlan);
      continue;
    }
    // 解析安全检查：语法错 → 该文件整体 blocked。
    const guardOk = currentText === null
      ? true
      : file.format === "jsonc"
        ? parseJsonc(currentText).ok
        : parseTomlSafe(currentText).ok;
    if (!guardOk) {
      const message = file.format === "jsonc"
        ? "JSON 语法解析失败"
        : "TOML 语法解析失败";
      filePlan.unsafe = message;
      for (const unit of file.units) {
        filePlan.units.push({ unit, action: "blocked", note: `${message}——该文件不动，先修好语法再说` });
      }
      plan.files.push(filePlan);
      continue;
    }
    for (const unit of file.units) {
      const candidateCanonical = canonicalJson(unit.candidate);
      let presence: Presence | { error: string } = {};
      if (currentText !== null) {
        presence = presenceFor(currentText, unit);
      }
      const baselineCanonical = baselines[unit.id];
      if ("error" in presence) {
        filePlan.units.push({ unit, action: "conflict", note: presence.error });
        continue;
      }
      if (mode === "remove") {
        // 移除：按归属删（键名/认得出的 bin 就是本工具命名空间）；没有 → 幂等空操作。
        if (presence.oursCanonical === undefined && presence.foreignCanonical === undefined && presence.extra === undefined) {
          filePlan.units.push({ unit, action: "n/a", note: "没有我们的条目，无事可做（幂等）" });
        } else if (presence.extra) {
          filePlan.units.push({ unit, action: "conflict", note: presence.extra });
        } else {
          const modified = presence.oursCanonical !== undefined && baselineCanonical !== undefined && presence.oursCanonical !== baselineCanonical;
          const noRecord = presence.oursCanonical !== undefined && baselineCanonical === undefined;
          filePlan.units.push({
            unit, action: "remove",
            note: modified
              ? "条目跟上次我们写的不一样（你改过），仍按归属移除，原内容在备份里"
              : noRecord
                ? "没有我们写过的记录（可能是你手写的同名条目），仍按归属移除，原内容在备份里"
                : "按归属移除本工具条目",
          });
        }
        continue;
      }
      // connect / repair：差异语义一致（这条分支上 repair 只补「缺」和更新「老」；冲突只报不修，
      // 中断的 remove 走上面 probeInterrupted 那条分支）。
      if (presence.extra) {
        filePlan.units.push({ unit, action: "conflict", note: presence.extra });
        continue;
      }
      const state = classify(presence.oursCanonical, candidateCanonical, baselineCanonical);
      filePlan.units.push({
        unit,
        action: actionForConnect(state),
        currentCanonical: presence.oursCanonical,
        baselineCanonical,
        note: noteForConnect(unit, state),
      });
    }
    plan.files.push(filePlan);
  }
  return plan;
}

/** 计划里有没有会动文件的单元（预览/幂等判断用）。 */
export function planHasWrites(plan: HostPlan, mode: PlanMode): boolean {
  return plan.files.some((f) => f.units.some((u) =>
    mode === "remove" ? u.action === "remove" : u.action === "add" || u.action === "replace",
  ));
}

/** 计划里有没有冲突/不安全（要先报告、不能直接写）。 */
export function planHasConflicts(plan: HostPlan): boolean {
  return plan.files.some((f) => f.units.some((u) => u.action === "conflict" || u.action === "blocked"));
}
