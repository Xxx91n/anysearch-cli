// ADR-0052 D2-D5: local-first observation asset.
// The internal representation is the schema contract. Exporters translate it
// to volatile gen_ai.* semantics only at the boundary.
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type {
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetrySpan,
} from "@earendil-works/pi-telemetry";

export const OBSERVATION_SCHEMA_URL = "anysearch://schemas/observation/1.0.0";
export const OBSERVATION_SCHEMA_VERSION = 1;
export const SEMCONV_GENAI_COMMIT = "b5d8440f6f126738fd50f927752cd669772c517b";
export const SEMCONV_LEGACY_TAG = "v1.42.0";
export const SEMCONV_LEGACY_COMMIT = "ae3a98640194ed405c4c797281502e4d3bd258b3";
export const SEMCONV_MCP_TAG = "v1.39.0";
export const SEMCONV_MCP_COMMIT = "6d05e92070f0a5c9a5bbcd396d2ebe2103377f8c";

export interface TestedWithRow {
  component: string;
  version: string;
  observedAt: string;
}

export const OBSERVATION_TESTED_WITH: readonly TestedWithRow[] = [
  { component: "open-telemetry/semantic-conventions-genai", version: SEMCONV_GENAI_COMMIT, observedAt: "2026-09-09" },
  { component: "OpenTelemetry SDK", version: "not linked (internal adapter)", observedAt: "2026-09-09" },
  { component: "exporter", version: "anysearch/otlp-json@1", observedAt: "2026-09-09" },
  { component: "local backend", version: "better-sqlite3@13.0.3", observedAt: "2026-09-09" },
];

export type ObservationAttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

export type ObservationAttributes = Record<string, ObservationAttributeValue | undefined>;

export type ObservationKind =
  | "cli"
  | "mcp"
  | "retrieve"
  | "generate"
  | "evaluate"
  | "invoke_agent"
  | "chat"
  | "execute_tool"
  | "plan";

export interface ObservationEvent {
  name: string;
  attributes: ObservationAttributes;
}

export interface ObservationSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  kind: ObservationKind;
  operation: string;
  startUnixNano: number;
  endUnixNano: number;
  status: "ok" | "error";
  attributes: ObservationAttributes;
  events: ObservationEvent[];
  error?: { name: string; message: string };
}

export interface EvaluationObservationInput {
  traceId: string;
  spanId: string;
  evaluationId: string;
  name: string;
  scoreValue?: number;
  scoreLabel?: string;
  explanation?: string;
  responseId?: string;
  evaluatedAt: string;
}

export interface ScoreObservationInput {
  rubricItem: string;
  value: number;
  label?: string;
}

export interface ObservationTrace {
  schema: typeof OBSERVATION_SCHEMA_URL;
  version: typeof OBSERVATION_SCHEMA_VERSION;
  semconvPin: typeof SEMCONV_GENAI_COMMIT;
  traceId: string;
  runId: string;
  kind: ObservationKind;
  operation: string;
  startUnixNano: number;
  endUnixNano: number;
  status: "ok" | "error";
  spans: ObservationSpan[];
  evaluations: EvaluationObservationInput[];
  scores: ScoreObservationInput[];
  attributes: ObservationAttributes;
}

const AttributeValueSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
]);

const AttributesSchema = Type.Record(Type.String(), AttributeValueSchema);

const ObservationEventSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    attributes: AttributesSchema,
  },
  { additionalProperties: false },
);

export const ObservationSpanSchema = Type.Object(
  {
    traceId: Type.String({ minLength: 32, maxLength: 32 }),
    spanId: Type.String({ minLength: 16, maxLength: 16 }),
    parentSpanId: Type.Union([Type.String({ minLength: 16, maxLength: 16 }), Type.Null()]),
    kind: Type.String({ minLength: 1 }),
    operation: Type.String({ minLength: 1 }),
    startUnixNano: Type.Integer({ minimum: 0 }),
    endUnixNano: Type.Integer({ minimum: 0 }),
    status: Type.Union([Type.Literal("ok"), Type.Literal("error")]),
    attributes: AttributesSchema,
    events: Type.Array(ObservationEventSchema),
    error: Type.Optional(
      Type.Object(
        { name: Type.String(), message: Type.String() },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const EvaluationObservationSchema = Type.Object(
  {
    traceId: Type.String({ minLength: 32, maxLength: 32 }),
    spanId: Type.String({ minLength: 16, maxLength: 16 }),
    evaluationId: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    scoreValue: Type.Optional(Type.Number()),
    scoreLabel: Type.Optional(Type.String()),
    explanation: Type.Optional(Type.String()),
    responseId: Type.Optional(Type.String()),
    evaluatedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const ScoreObservationSchema = Type.Object(
  {
    rubricItem: Type.String({ minLength: 1 }),
    value: Type.Number(),
    label: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ObservationTraceSchema = Type.Object(
  {
    schema: Type.Literal(OBSERVATION_SCHEMA_URL),
    version: Type.Literal(OBSERVATION_SCHEMA_VERSION),
    semconvPin: Type.Literal(SEMCONV_GENAI_COMMIT),
    traceId: Type.String({ minLength: 32, maxLength: 32 }),
    runId: Type.String({ minLength: 1 }),
    kind: Type.String({ minLength: 1 }),
    operation: Type.String({ minLength: 1 }),
    startUnixNano: Type.Integer({ minimum: 0 }),
    endUnixNano: Type.Integer({ minimum: 0 }),
    status: Type.Union([Type.Literal("ok"), Type.Literal("error")]),
    spans: Type.Array(ObservationSpanSchema),
    evaluations: Type.Array(EvaluationObservationSchema),
    scores: Type.Array(ScoreObservationSchema),
    attributes: AttributesSchema,
  },
  { additionalProperties: false },
);

export type EvaluationObservation = Static<typeof EvaluationObservationSchema>;

const OBSERVATION_SQL = `
CREATE TABLE IF NOT EXISTS observability_traces (
  trace_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS observability_spans (
  span_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  kind TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  attributes_json TEXT NOT NULL,
  events_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observability_evaluations (
  evaluation_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score_value REAL,
  score_label TEXT,
  explanation TEXT,
  response_id TEXT,
  evaluated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observability_scores (
  trace_id TEXT NOT NULL,
  rubric_item TEXT NOT NULL,
  value REAL NOT NULL,
  label TEXT,
  PRIMARY KEY (trace_id, rubric_item)
);

CREATE INDEX IF NOT EXISTS idx_observability_spans_trace ON observability_spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_observability_evaluations_trace ON observability_evaluations(trace_id);
`;

function nowUnixNano(): number {
  return Date.now() * 1_000_000;
}

function cleanAttributes(
  attributes: ObservationAttributes | SpanAttributes | undefined,
): ObservationAttributes {
  const out: ObservationAttributes = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    // Custom fields never claim the volatile external namespace.
    if (key.startsWith("gen_ai.")) continue;
    if (value !== undefined) out[key] = value as ObservationAttributeValue;
  }
  return out;
}

function statusFromError(error: unknown): SpanStatus {
  if (error instanceof Error) {
    return { status: "error", error: { name: error.name, message: error.message } };
  }
  return { status: "error", error: { name: "Error", message: String(error) } };
}

function toErrorRecord(status: SpanStatus): { name: string; message: string } | undefined {
  return status.status === "error" && status.error ? status.error : undefined;
}

class ObservationSpanNode implements TelemetrySpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly kind: ObservationKind;
  readonly operation: string;
  readonly startUnixNano: number;
  readonly attributes: ObservationAttributes;
  readonly events: ObservationEvent[] = [];
  private settled = false;
  private endUnixNano: number;
  private status: SpanStatus = { status: "ok" };

  constructor(
    traceId: string,
    spanId: string,
    parentSpanId: string | null,
    kind: ObservationKind,
    operation: string,
    attributes: ObservationAttributes | SpanAttributes,
  ) {
    this.traceId = traceId;
    this.spanId = spanId;
    this.parentSpanId = parentSpanId;
    this.kind = kind;
    this.operation = operation;
    this.startUnixNano = nowUnixNano();
    this.endUnixNano = this.startUnixNano;
    this.attributes = cleanAttributes(attributes);
  }

  addEvent(name: string, attributes: SpanAttributes = {}): void {
    if (this.settled) return;
    this.events.push({ name, attributes: cleanAttributes(attributes) });
  }

  setAttributes(attributes: SpanAttributes): void {
    if (this.settled) return;
    Object.assign(this.attributes, cleanAttributes(attributes));
  }

  setStatus(status: SpanStatus): void {
    if (this.settled) return;
    this.status = status;
  }

  startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
    const child = new ObservationSpanNode(
      this.traceId,
      randomUUID().replace(/-/g, "").slice(0, 16),
      this.spanId,
      this.kind,
      options.name,
      options.attributes ?? {},
    );
    this.childSpans.push(child);
    try {
      const result = callback(child);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        return Promise.resolve(result).then(
          (value) => {
            child.finish({ status: "ok" });
            return value;
          },
          (error: unknown) => {
            child.finish(statusFromError(error));
            throw error;
          },
        );
      }
      child.finish({ status: "ok" });
      return Promise.resolve(result);
    } catch (error) {
      child.finish(statusFromError(error));
      return Promise.reject(error);
    }
  }

  private readonly childSpans: ObservationSpanNode[] = [];

  finish(status: SpanStatus): void {
    if (this.settled) return;
    this.settled = true;
    this.endUnixNano = nowUnixNano();
    this.status = this.status.status === "error" ? this.status : status;
  }

  isSettled(): boolean {
    return this.settled;
  }

  statusValue(): "ok" | "error" {
    return this.status.status;
  }

  toSpans(): ObservationSpan[] {
    return [
      this.toSpan(),
      ...this.childSpans.flatMap((child) => child.toSpans()),
    ];
  }

  private toSpan(): ObservationSpan {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      kind: this.kind,
      operation: this.operation,
      startUnixNano: this.startUnixNano,
      endUnixNano: this.endUnixNano,
      status: this.status.status,
      attributes: { ...this.attributes },
      events: this.events.map((event) => ({
        name: event.name,
        attributes: { ...event.attributes },
      })),
      ...(toErrorRecord(this.status) ? { error: toErrorRecord(this.status) } : {}),
    };
  }
}

function mapAttributeValue(value: ObservationAttributeValue) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) return { arrayValue: { values: value.map((item) => ({ stringValue: item })) } };
    if (value.every((item) => typeof item === "number")) return { arrayValue: { values: value.map((item) => ({ doubleValue: item })) } };
    return { arrayValue: { values: value.map((item) => ({ boolValue: item })) } };
  }
  return { stringValue: String(value) };
}

function mapSpanToOtlp(span: ObservationSpan): Record<string, unknown> {
  const attributes: Record<string, unknown>[] = [];
  const provider = span.attributes["anysearch.provider"];
  const model = span.attributes["anysearch.model"];
  const inputTokens = span.attributes["anysearch.input_tokens"];
  const outputTokens = span.attributes["anysearch.output_tokens"];
  if (typeof provider === "string") {
    attributes.push({ key: "gen_ai.provider.name", value: { stringValue: provider } });
    attributes.push({ key: "gen_ai.system", value: { stringValue: provider } });
  }
  if (typeof model === "string") attributes.push({ key: "gen_ai.request.model", value: { stringValue: model } });
  if (typeof inputTokens === "number") {
    attributes.push({ key: "gen_ai.usage.input_tokens", value: { doubleValue: inputTokens } });
    attributes.push({ key: "gen_ai.usage.prompt_tokens", value: { doubleValue: inputTokens } });
  }
  if (typeof outputTokens === "number") {
    attributes.push({ key: "gen_ai.usage.output_tokens", value: { doubleValue: outputTokens } });
    attributes.push({ key: "gen_ai.usage.completion_tokens", value: { doubleValue: outputTokens } });
  }
  for (const [key, value] of Object.entries(span.attributes)) {
    if (key.startsWith("gen_ai.")) continue;
    if (value !== undefined) attributes.push({ key, value: mapAttributeValue(value) });
  }
  const events = span.events.map((event) => ({
    name: event.name,
    attributes: Object.entries(event.attributes).map(([key, value]) => ({
      key,
      value: mapAttributeValue(value!),
    })),
  }));
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.operation,
    startTimeUnixNano: span.startUnixNano,
    endTimeUnixNano: span.endUnixNano,
    attributes,
    events,
    status: { code: span.status === "ok" ? 1 : 2 },
  };
}

export function mapTraceToOtlp(trace: ObservationTrace): Record<string, unknown> {
  const evalEvents = trace.evaluations.map((evaluation) => ({
    name: "gen_ai.evaluation.result",
    attributes: [
      { key: "gen_ai.evaluation.name", value: { stringValue: evaluation.name } },
      ...(evaluation.scoreValue !== undefined ? [{ key: "gen_ai.evaluation.result.score.value", value: { doubleValue: evaluation.scoreValue } }] : []),
      ...(evaluation.scoreLabel !== undefined ? [{ key: "gen_ai.evaluation.result.score.label", value: { stringValue: evaluation.scoreLabel } }] : []),
      ...(evaluation.explanation !== undefined ? [{ key: "gen_ai.evaluation.result.explanation", value: { stringValue: evaluation.explanation } }] : []),
      ...(evaluation.responseId !== undefined ? [{ key: "gen_ai.response.id", value: { stringValue: evaluation.responseId } }] : []),
    ],
  }));
  const spans = trace.spans.map((span) => mapSpanToOtlp(span));
  if (evalEvents.length > 0 && spans.length > 0) {
    spans[0] = { ...(spans[0] as Record<string, unknown>), events: [...(spans[0] as { events: unknown[] }).events, ...evalEvents] };
  }
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "anysearch" } }] },
      scopeSpans: [{ scope: { name: "anysearch" }, spans }],
    }],
  };
}

export class SqliteObservationStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { timeout: 5000 });
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(OBSERVATION_SQL);
  }

  close(): void {
    this.db.close();
  }

  async recordOperation<T>(
    options: {
      runId?: string;
      kind: ObservationKind;
      operation: string;
      attributes?: ObservationAttributes;
    },
    callback: (span: TelemetrySpan) => T | Promise<T>,
  ): Promise<T> {
    const runId = options.runId ?? randomUUID();
    const traceId = randomUUID().replace(/-/g, "");
    const spanId = randomUUID().replace(/-/g, "").slice(0, 16);
    const root = new ObservationSpanNode(traceId, spanId, null, options.kind, options.operation, options.attributes ?? {});
    const startUnixNano = nowUnixNano();
    let status: "ok" | "error" = "ok";
    try {
      const result = callback(root);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        return await (result as Promise<T>).then((value) => {
          root.finish({ status: "ok" });
          return value;
        });
      }
      root.finish({ status: "ok" });
      return result;
    } catch (error) {
      root.finish(statusFromError(error));
      throw error;
    } finally {
      if (!root.isSettled()) root.finish({ status: "ok" });
      status = root.statusValue();
      const trace: ObservationTrace = {
        schema: OBSERVATION_SCHEMA_URL,
        version: OBSERVATION_SCHEMA_VERSION,
        semconvPin: SEMCONV_GENAI_COMMIT,
        traceId,
        runId,
        kind: options.kind,
        operation: options.operation,
        startUnixNano,
        endUnixNano: nowUnixNano(),
        status,
        spans: root.toSpans(),
        evaluations: [],
        scores: [],
        attributes: cleanAttributes(options.attributes),
      };
      this.persistTrace(trace);
    }
  }

  recordEvaluationTrace(input: {
    runId?: string;
    name: string;
    attributes?: ObservationAttributes;
    evaluation: Omit<EvaluationObservationInput, "traceId" | "spanId" | "evaluationId" | "evaluatedAt">;
    scores?: ScoreObservationInput[];
  }): ObservationTrace {
    const runId = input.runId ?? randomUUID();
    const traceId = randomUUID().replace(/-/g, "");
    const spanId = randomUUID().replace(/-/g, "").slice(0, 16);
    const startUnixNano = nowUnixNano();
    const evaluation: EvaluationObservationInput = {
      traceId,
      spanId,
      evaluationId: randomUUID(),
      name: input.evaluation.name,
      ...(input.evaluation.scoreValue !== undefined ? { scoreValue: input.evaluation.scoreValue } : {}),
      ...(input.evaluation.scoreLabel !== undefined ? { scoreLabel: input.evaluation.scoreLabel } : {}),
      ...(input.evaluation.explanation !== undefined ? { explanation: input.evaluation.explanation } : {}),
      ...(input.evaluation.responseId !== undefined ? { responseId: input.evaluation.responseId } : {}),
      evaluatedAt: new Date().toISOString(),
    };
    const trace: ObservationTrace = {
      schema: OBSERVATION_SCHEMA_URL,
      version: OBSERVATION_SCHEMA_VERSION,
      semconvPin: SEMCONV_GENAI_COMMIT,
      traceId,
      runId,
      kind: "evaluate",
      operation: input.name,
      startUnixNano,
      endUnixNano: nowUnixNano(),
      status: "ok",
      spans: [{
        traceId,
        spanId,
        parentSpanId: null,
        kind: "evaluate",
        operation: input.name,
        startUnixNano,
        endUnixNano: nowUnixNano(),
        status: "ok",
        attributes: cleanAttributes(input.attributes),
        events: [],
      }],
      evaluations: [evaluation],
      scores: input.scores ?? [],
      attributes: cleanAttributes(input.attributes),
    };
    this.persistTrace(trace);
    return trace;
  }

  getTrace(runId: string): ObservationTrace | undefined {
    const row = this.db.prepare("SELECT payload_json FROM observability_traces WHERE run_id = ?").get(runId) as { payload_json: string } | undefined;
    if (!row) return undefined;
    const parsed = JSON.parse(row.payload_json) as ObservationTrace;
    return Value.Check(ObservationTraceSchema, parsed) ? parsed : undefined;
  }

  exportOtlp(runId: string): Record<string, unknown> | undefined {
    const trace = this.getTrace(runId);
    return trace ? mapTraceToOtlp(trace) : undefined;
  }

  private persistTrace(trace: ObservationTrace): void {
    if (!Value.Check(ObservationTraceSchema, trace)) throw new Error("invalid observation trace");
    const payload = JSON.stringify(trace);
    this.db.prepare(
      "INSERT OR IGNORE INTO observability_traces (trace_id, run_id, kind, operation, status, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(trace.traceId, trace.runId, trace.kind, trace.operation, trace.status, payload);
    const insertSpan = this.db.prepare(
      "INSERT OR IGNORE INTO observability_spans (span_id, trace_id, parent_span_id, kind, operation, status, attributes_json, events_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const span of trace.spans) {
      insertSpan.run(span.spanId, span.traceId, span.parentSpanId, span.kind, span.operation, span.status, JSON.stringify(span.attributes), JSON.stringify(span.events));
    }
    const insertEvaluation = this.db.prepare(
      "INSERT OR IGNORE INTO observability_evaluations (evaluation_id, trace_id, span_id, name, score_value, score_label, explanation, response_id, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const evaluation of trace.evaluations) {
      insertEvaluation.run(evaluation.evaluationId, evaluation.traceId, evaluation.spanId, evaluation.name, evaluation.scoreValue ?? null, evaluation.scoreLabel ?? null, evaluation.explanation ?? null, evaluation.responseId ?? null, evaluation.evaluatedAt);
    }
    const insertScore = this.db.prepare(
      "INSERT OR IGNORE INTO observability_scores (trace_id, rubric_item, value, label) VALUES (?, ?, ?, ?)",
    );
    for (const score of trace.scores) insertScore.run(trace.traceId, score.rubricItem, score.value, score.label ?? null);
  }
}

export function observationRunId(input: unknown): string {
  return typeof input === "string" && input.length > 0 ? input : randomUUID();
}
