// webprobe driver: provides headlessStartup so headless-runner can drive a
// one-shot task inside the web profile composition (web-startup stays enabled
// and keeps parsing argv -- the task comes from DSH_PROBE_TASK, not argv).
export const name = 'webprobe-driver';
export const inject = [];
export function apply(ctx) {
  ctx.provide('headlessStartup', { task: process.env.DSH_PROBE_TASK || 'say hello' });
}
