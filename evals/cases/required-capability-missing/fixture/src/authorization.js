export function canEdit(user, document) {
  return user.id === document.ownerId;
}
