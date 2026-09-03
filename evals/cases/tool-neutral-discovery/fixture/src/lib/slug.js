export function toSlug(value) {
  return String(value).trim().toLowerCase().replace(" ", "-");
}
