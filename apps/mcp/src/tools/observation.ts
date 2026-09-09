import type { CompositionResult } from "@anysearch/kernel";
import type { ObservationAttributes } from "@anysearch/store";

export function observeTool<T>(
  eng: CompositionResult,
  toolName: string,
  callback: () => T | Promise<T>,
  attributes?: ObservationAttributes,
): Promise<T> {
  return eng.observation.recordOperation(
    {
      kind: "mcp",
      operation: toolName,
      attributes: { "anysearch.tool": toolName, ...attributes },
    },
    callback,
  );
}
