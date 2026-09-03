export function normalizeUser(input) {
  if (!input || typeof input !== "object") throw new TypeError("user record is required");
  const firstName = String(input.firstName ?? "").trim();
  const lastName = String(input.lastName ?? "").trim();
  if (!firstName && !lastName) throw new TypeError("firstName or lastName is required");
  return { firstName, lastName, displayName: [firstName, lastName].filter(Boolean).join(" ") };
}
