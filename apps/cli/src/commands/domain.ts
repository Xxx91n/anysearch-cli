// ans domain: switch or show Active Domain (cc-persona TOML, ADR-0002).
// ponytail: MVP just shows current domain from ANS_DOMAIN env or default.

export async function runDomain(args: string[]): Promise<number> {
  const current = process.env.ANS_DOMAIN || "default";
  if (args.length === 0) {
    console.log("Active Domain: " + current);
    console.log("Set with: ANS_DOMAIN=<name> or ans domain <name>");
    return 0;
  }
  const newDomain = args[0];
  console.log("Switching Active Domain to: " + newDomain);
  console.log("Note: This session-only. Set ANS_DOMAIN=" + newDomain + " for persistence.");
  return 0;
}
