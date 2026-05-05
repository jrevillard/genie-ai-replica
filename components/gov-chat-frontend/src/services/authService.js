/**
 * Facade for httpService interceptors. Core auth lives in userService (GitLab #396).
 * Dynamic import avoids a static cycle: httpService → authService → userService → httpService.
 */

const TOKEN_KEY = 'user'

export default {
  async refreshToken() {
    const { default: userService } = await import('./userService')
    const data = await userService.refreshToken()
    return { data }
  },

  clearUserData() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
  },
}
