import { readPersistedState, writePersistedState } from '@/utils/persistence'

export const ACCESS_TOKEN_STORAGE_KEY = 'pixeldoodle:access-token'

export function setPrivateApiAccessToken(token: string) {
  return writePersistedState(ACCESS_TOKEN_STORAGE_KEY, token.trim())
}

export function clearPrivateApiAccessToken() {
  return writePersistedState(ACCESS_TOKEN_STORAGE_KEY, '')
}

export function getPrivateApiHeaders(userId: string) {
  const accessToken = readPersistedState<string>(ACCESS_TOKEN_STORAGE_KEY, '').trim()
  if (accessToken) {
    return {
      authorization: `Bearer ${accessToken}`
    }
  }

  return {
    'x-pixeldoodle-user-id': userId.trim()
  }
}
