export class Queue {
  #items = [];
  add(item) { this.#items.push(item); }
  all() { return [...this.#items]; }
}
