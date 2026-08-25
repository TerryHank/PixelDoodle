import Taro from '@tarojs/taro'
import { Image, Text, View } from '@tarojs/components'
import beanActiveIcon from '@/assets/v13/tabs/bean-active.png'
import beanIcon from '@/assets/v13/tabs/bean.png'
import homeActiveIcon from '@/assets/v13/tabs/home-active.png'
import homeIcon from '@/assets/v13/tabs/home.png'
import localGalleryIcon from '@/assets/v13/tabs/local-gallery.png'
import profileIcon from '@/assets/v13/tabs/profile.png'
import './index.scss'

export type AppTabKey = 'community' | 'materials' | 'tool' | 'profile'

const TAB_CONFIG: Record<
  AppTabKey,
  { label: string; url: string; icon: string; activeIcon: string }
> = {
  community: {
    label: '豆仓',
    url: '/pages/community/index',
    icon: beanIcon,
    activeIcon: beanActiveIcon
  },
  materials: {
    label: '本地图库',
    url: '/pages/materials/index',
    icon: localGalleryIcon,
    activeIcon: localGalleryIcon
  },
  tool: {
    label: '首页',
    url: '/pages/home/index',
    icon: homeIcon,
    activeIcon: homeActiveIcon
  },
  profile: {
    label: '我的',
    url: '/pages/profile/index',
    icon: profileIcon,
    activeIcon: profileIcon
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
      {(['tool', 'materials', 'community', 'profile'] as AppTabKey[]).map((tab) => {
        const item = TAB_CONFIG[tab]
        const active = tab === current

        return (
          <View
            key={tab}
            className={`app-tab-bar__item app-tab-bar__item--${tab} ${active ? 'app-tab-bar__item--active' : ''}`}
            aria-current={active ? 'page' : undefined}
            hoverClass='app-tab-bar__item--hover'
            hoverStayTime={40}
            onClick={() => {
              void handleNavigate(tab)
            }}
          >
            <Image
              className='app-tab-bar__icon'
              src={active ? item.activeIcon : item.icon}
              mode='aspectFit'
            />
            <Text className='app-tab-bar__label'>{item.label}</Text>
          </View>
        )
      })}
    </View>
  )
}
