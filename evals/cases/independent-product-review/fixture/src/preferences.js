export function readViewPreference(record) {
  if (!record || typeof record !== "object") return "compact";
  return record.view ?? "compact";
}
