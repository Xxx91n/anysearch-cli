// #312: 分层诊断的统一说法。
//
// 一条结果只属于一层（安装 / 能力 / 宿主 / 数据），只取四种状态之一：
// - ready：查过，是好的。
// - unconfigured：还没配，或者本来就不需要配。这是合法的空，不是坏。
// - unchecked：没能查，或者没去查。不冒充通过。
// - failed：查过，确实坏了。
//
// 每条结果还带一个 mode：offline 是离线检查（构造对象、看文件、看环境变量），
// live 是真实调用（真的联网、真的起宿主）。离线检查通过不等于真实调用通过，
// 所以两者分开写，不互相顶替。
//
// 退出码：有 failed 就是 1；--strict 时还有 unchecked 就是 5；否则 0。
// unconfigured 不抬退出码：没配 provider 是合法状态，不是故障。

export type DiagLayer = "install" | "capability" | "host" | "data";
export type DiagState = "ready" | "unconfigured" | "unchecked" | "failed";
export type DiagMode = "offline" | "live";

export interface DiagEntry {
  layer: DiagLayer;
  name: string;
  state: DiagState;
  mode: DiagMode;
  detail?: string;
}

export interface DiagSummary {
  ready: number;
  unconfigured: number;
  unchecked: number;
  failed: number;
}

export interface DiagJson {
  product: string;
  version: string;
  generatedAt: string;
  strict: boolean;
  summary: DiagSummary;
  exitCode: number;
  layers: Array<{ layer: DiagLayer; label: string; entries: DiagEntry[] }>;
}

const LAYER_ORDER: DiagLayer[] = ["install", "capability", "host", "data"];

const LAYER_LABELS: Record<DiagLayer, string> = {
  install: "安装",
  capability: "能力",
  host: "宿主",
  data: "数据",
};

const STATE_LABELS: Record<DiagState, string> = {
  ready: "OK",
  unconfigured: "未配置",
  unchecked: "未检查",
  failed: "失败",
};

const MODE_LABELS: Record<DiagMode, string> = {
  offline: "离线",
  live: "实测",
};

export class DiagReport {
  readonly entries: DiagEntry[] = [];

  constructor(
    readonly product: string,
    readonly version: string,
  ) {}

  add(entry: DiagEntry): DiagEntry {
    this.entries.push(entry);
    return entry;
  }

  summary(): DiagSummary {
    const out: DiagSummary = { ready: 0, unconfigured: 0, unchecked: 0, failed: 0 };
    for (const entry of this.entries) out[entry.state]++;
    return out;
  }

  exitCode(strict: boolean): number {
    const summary = this.summary();
    if (summary.failed > 0) return 1;
    if (strict && summary.unchecked > 0) return 5;
    return 0;
  }

  /** 文字版：按层分组，逐条打印。 */
  render(): string[] {
    const lines: string[] = [];
    for (const layer of LAYER_ORDER) {
      const entries = this.entries.filter((entry) => entry.layer === layer);
      if (entries.length === 0) continue;
      lines.push(`[${LAYER_LABELS[layer]}]`);
      for (const entry of entries) {
        const head = `  [${STATE_LABELS[entry.state]}] ${entry.name}`;
        const tail = entry.detail ? `${head}：${entry.detail}` : head;
        lines.push(`${tail}（${MODE_LABELS[entry.mode]}）`);
      }
    }
    const summary = this.summary();
    lines.push(
      `汇总：${summary.ready} 可用 · ${summary.unconfigured} 未配置 · ${summary.unchecked} 未检查 · ${summary.failed} 失败`,
    );
    lines.push("未配置和未检查都不算通过；只有失败会让退出码变成 1。");
    return lines;
  }

  toJson(strict: boolean): DiagJson {
    return {
      product: this.product,
      version: this.version,
      generatedAt: new Date().toISOString(),
      strict,
      summary: this.summary(),
      exitCode: this.exitCode(strict),
      layers: LAYER_ORDER.map((layer) => ({
        layer,
        label: LAYER_LABELS[layer],
        entries: this.entries.filter((entry) => entry.layer === layer),
      })),
    };
  }
}
