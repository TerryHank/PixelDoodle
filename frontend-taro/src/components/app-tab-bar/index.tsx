import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import './index.scss'

export type AppTabKey = 'community' | 'tool' | 'profile'

const TAB_CONFIG: Record<
  AppTabKey,
  { label: string; url: string; icon: string }
> = {
  community: {
    label: '社区',
    url: '/pages/community/index',
    icon: '社'
  },
  tool: {
    label: '工具',
    url: '/pages/tool/index',
    icon: '工'
  },
  profile: {
    label: '我的',
    url: '/pages/profile/index',
    icon: '我'
  }
}

export interface AppTabBarProps {
  current: AppTabKey
}

export function AppTabBar({ current }: AppTabBarProps) {
  async function handleNavigate(tab: AppTabKey) {
    if (tab === current) {
      return
    }

    await Taro.redirectTo({
      url: TAB_CONFIG[tab].url
    })
  }

  return (
    <View className='app-tab-bar'>
      {(['community', 'tool', 'profile'] as AppTabKey[]).map((tab) => {
        const item = TAB_CONFIG[tab]
        const active = tab === current

        return (
          <View
            key={tab}
            className={`app-tab-bar__item ${active ? 'app-tab-bar__item--active' : ''}`}
            hoverClass='app-tab-bar__item--hover'
            hoverStayTime={40}
            onClick={() => {
              void handleNavigate(tab)
            }}
          >
            <Text className='app-tab-bar__icon'>{item.icon}</Text>
            <Text className='app-tab-bar__label'>{item.label}</Text>
          </View>
        )
      })}
    </View>
  )
}
