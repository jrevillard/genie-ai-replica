// src/utils/userUtils.js - local-auth user utility functions

export function getCurrentUser() {
  try {
    const raw = localStorage.getItem('user')
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    console.error('[userUtils] Failed to parse current user:', error)
    return null
  }
}

export function getUserId() {
  const user = getCurrentUser()
  return (
    user?._key ||
    user?.id ||
    user?.userId ||
    user?._id?.split('/').pop() ||
    null
  )
}

export function getLoginName() {
  const user = getCurrentUser()
  return user?.loginName || user?.username || user?.email || null
}

export default {
  getCurrentUser,
  getUserId,
  getLoginName
}
