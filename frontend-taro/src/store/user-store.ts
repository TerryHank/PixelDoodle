import { create } from 'zustand'
import type { UserProfile } from '@/types/community'
import {
  ensurePersistedString,
  readPersistedState,
  writePersistedState
} from '@/utils/persistence'

const USER_PROFILE_STORAGE_KEY = 'pixeldoodle:user-profile'
const USER_ID_STORAGE_KEY = 'pixeldoodle:user-id'

function createDefaultProfile(): UserProfile {
  const id = ensurePersistedString(USER_ID_STORAGE_KEY, 'user')
  const nickname = `像素玩家${id.slice(-4)}`

  return {
    id,
    nickname,
    avatarSeed: nickname,
    bio: '用 PixelDoodle 生成拼豆图案',
    autoShareToCommunity: false
  }
}

const persistedProfile = readPersistedState<UserProfile | null>(
  USER_PROFILE_STORAGE_KEY,
  null
)

const initialProfile = persistedProfile ?? createDefaultProfile()

function persist(profile: UserProfile) {
  writePersistedState(USER_PROFILE_STORAGE_KEY, profile)
}

export interface UserStoreState extends UserProfile {
  setNickname: (nickname: string) => void
  setBio: (bio: string) => void
  setAutoShareToCommunity: (enabled: boolean) => void
}

export const useUserStore = create<UserStoreState>((set, get) => ({
  ...initialProfile,
  setNickname: (nickname) => {
    const nextNickname = nickname.trim() || createDefaultProfile().nickname
    set(() => {
      const nextProfile: UserProfile = {
        ...get(),
        nickname: nextNickname,
        avatarSeed: nextNickname
      }
      persist(nextProfile)
      return nextProfile
    })
  },
  setBio: (bio) =>
    set(() => {
      const nextProfile: UserProfile = {
        ...get(),
        bio: bio.trim()
      }
      persist(nextProfile)
      return nextProfile
    }),
  setAutoShareToCommunity: (enabled) =>
    set(() => {
      const nextProfile: UserProfile = {
        ...get(),
        autoShareToCommunity: enabled
      }
      persist(nextProfile)
      return nextProfile
    })
}))
