export class ApiClient {
  async get(url) {
    return fetch(url).then((response) => response.json());
  }
}
