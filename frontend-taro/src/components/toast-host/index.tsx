import { Text, View } from '@tarojs/components'
import './index.scss'

export interface ToastHostProps {
  message?: string
}

export function ToastHost({ message = '' }: ToastHostProps) {
  if (!message) {
    return null
  }

  return (
    <View className='toast-host toast-host--visible'>
      <Text className='toast-host__message'>{message}</Text>
    </View>
  )
}
