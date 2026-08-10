import { Text, View } from '@tarojs/components'
import './index.scss'

function hashSeed(seed: string) {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return hash
}

function buildAvatarTone(seed: string) {
  const hash = hashSeed(seed || 'pixel')
  const hue = hash % 360
  return {
    background: `linear-gradient(135deg, hsl(${hue} 78% 58%), hsl(${(hue + 36) % 360} 72% 52%))`
  }
}

export interface ProfileAvatarProps {
  seed: string
  nickname: string
  size?: 'sm' | 'md' | 'lg'
}

export function ProfileAvatar({
  seed,
  nickname,
  size = 'md'
}: ProfileAvatarProps) {
  const label = (nickname.trim() || seed.trim() || '像').slice(0, 1).toUpperCase()

  return (
    <View className={`profile-avatar profile-avatar--${size}`} style={buildAvatarTone(seed)}>
      <Text className='profile-avatar__text'>{label}</Text>
    </View>
  )
}
