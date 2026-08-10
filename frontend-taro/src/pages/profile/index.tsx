import { Input, ScrollView, Text, Textarea, View } from '@tarojs/components'
import { AppTabBar } from '@/components/app-tab-bar'
import { PatternThumb } from '@/components/pattern-thumb'
import { ProfileAvatar } from '@/components/profile-avatar'
import { useHistoryStore } from '@/store/history-store'
import { useUserStore } from '@/store/user-store'
import './index.scss'

export default function ProfilePage() {
  const nickname = useUserStore((state) => state.nickname)
  const bio = useUserStore((state) => state.bio)
  const avatarSeed = useUserStore((state) => state.avatarSeed)
  const autoShareToCommunity = useUserStore((state) => state.autoShareToCommunity)
  const setNickname = useUserStore((state) => state.setNickname)
  const setBio = useUserStore((state) => state.setBio)
  const setAutoShareToCommunity = useUserStore((state) => state.setAutoShareToCommunity)
  const entries = useHistoryStore((state) => state.entries)
  const clearHistory = useHistoryStore((state) => state.clearHistory)

  return (
    <View className='profile-page'>
      <ScrollView className='profile-page__scroll' scrollY>
        <View className='profile-page__content'>
          <View className='profile-card'>
            <ProfileAvatar nickname={nickname} seed={avatarSeed} size='lg' />
            <View className='profile-card__meta'>
              <Text className='profile-card__title'>我的</Text>
              <Text className='profile-card__subtitle'>
                维护你的社区身份和历史生成记录。
              </Text>
            </View>
          </View>

          <View className='profile-form'>
            <Text className='profile-form__label'>昵称</Text>
            <Input
              className='profile-form__input'
              value={nickname}
              maxlength={20}
              placeholder='输入昵称'
              onInput={(event) => setNickname(event.detail.value)}
            />
            <Text className='profile-form__label'>个人简介</Text>
            <Textarea
              className='profile-form__textarea'
              value={bio}
              maxlength={120}
              placeholder='介绍一下你的作品风格'
              onInput={(event) => setBio(event.detail.value)}
            />
            <View className='profile-form__switch-row'>
              <View>
                <Text className='profile-form__label'>默认自动分享到社区</Text>
                <Text className='profile-form__hint'>工具页生成图案后会自动尝试发布</Text>
              </View>
              <View
                className={`profile-form__toggle ${autoShareToCommunity ? 'profile-form__toggle--active' : ''}`}
                onClick={() => setAutoShareToCommunity(!autoShareToCommunity)}
              >
                <Text>{autoShareToCommunity ? '已开启' : '未开启'}</Text>
              </View>
            </View>
          </View>

          <View className='history-section'>
            <View className='history-section__header'>
              <View>
                <Text className='history-section__title'>历史生成</Text>
                <Text className='history-section__subtitle'>
                  保存最近上传或示例生成过的图案，方便再次发布或参考。
                </Text>
              </View>
              <View className='history-section__clear' onClick={clearHistory}>
                <Text>清空</Text>
              </View>
            </View>

            {entries.length === 0 ? (
              <View className='history-empty'>
                <Text>还没有历史记录，去工具页生成第一张图案吧。</Text>
              </View>
            ) : (
              <View className='history-list'>
                {entries.map((entry) => (
                  <View className='history-card' key={entry.id}>
                    <PatternThumb
                      colorSummary={entry.colorSummary}
                      pixelMatrix={entry.pixelMatrix}
                    />
                    <View className='history-card__meta'>
                      <Text className='history-card__title'>{entry.title}</Text>
                      <Text className='history-card__subtitle'>{entry.sourceLabel}</Text>
                      <Text className='history-card__stats'>
                        {entry.gridSize.width}x{entry.gridSize.height} · {entry.totalBeads} 颗 ·{' '}
                        {new Date(entry.createdAt).toLocaleString()}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <AppTabBar current='profile' />
    </View>
  )
}
