import { Text, View } from '@tarojs/components'
import { AppTabBar } from '@/components/app-tab-bar'
import './index.scss'

export default function WarehousePage() {
  return (
    <View className='warehouse-page'>
      <View className='warehouse-page__content'>
        <Text>豆仓完整库存管理请在 H5 或 Android APP 中使用。</Text>
      </View>
      <AppTabBar current='warehouse' />
    </View>
  )
}
