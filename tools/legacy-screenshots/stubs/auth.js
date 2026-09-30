// Screenshot stub for @/helpers/auth — no MSAL, fake signed-in user.
class AuthStub {
  getUserId() { return 'analyst@contoso.com'; }
  handleResponse() {}
  async login() {}
  async logout() {}
  async getToken() { return 'fake-token'; }
  async getKustoToken() { return 'fake-token'; }
  async getApiToken() { return 'fake-token'; }
}
export default new AuthStub();
