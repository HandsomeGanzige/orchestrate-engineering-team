import path from "node:path";

export function createFakeRunner({ runs = [], version = "fake-runner/1" } = {}) {
  let index = 0;
  return {
    id: "fake",
    async preflight({ skillPath }) {
      return { runner: "fake", version, capabilities: { jsonEvents: true, structuredOutput: true, multiAgent: true }, skillPaths: [path.resolve(skillPath)] };
    },
    async run(request) {
      const entry = runs[index++];
      if (!entry) throw new Error(`fake runner has no response for call ${index}`);
      if (typeof entry === "function") return entry(request);
      return structuredClone(entry);
    },
    calls() { return index; },
  };
}
