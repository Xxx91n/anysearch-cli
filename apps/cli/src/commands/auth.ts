// ans auth: configure provider API keys.
// ponytail: MVP shows which keys are set, does not write config files.

export async function runAuth(args: string[]): Promise<number> {
  console.log("ans auth - Provider API key configuration");
  console.log("---");
  const keys = [
    { env: "TAVILY_API_KEY", provider: "Tavily", note: "1000 credit/month free" },
    { env: "EXA_API_KEY", provider: "Exa", note: "$20+$10/month free tier" },
    { env: "ANS_API_KEY", provider: "AnySearch", note: "optional, anonymous has lower rate" },
  ];
  for (const k of keys) {
    const set = !!process.env[k.env];
    console.log((set ? "[SET]  " : "[EMPTY] ") + k.provider + " (" + k.env + ") - " + k.note);
  }
  console.log("---");
  console.log("Set keys via: export TAVILY_API_KEY=tvly-xxxxx");
  return 0;
}
