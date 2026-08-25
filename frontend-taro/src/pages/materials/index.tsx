import Taro from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import { AppTabBar } from '@/components/app-tab-bar'

export default function MaterialsFallbackPage() {
  return (
    <View style={{ padding: '48px 24px', textAlign: 'center' }}>
      <Text>海量素材库当前优先在 Web 端开放。</Text>
      <Button
        style={{ marginTop: '24px' }}
        onClick={() => Taro.redirectTo({ url: '/pages/home/index' })}
      >
        返回创作
      </Button>
      <AppTabBar />
    </View>
  )
}
