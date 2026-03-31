import { Text, View } from '@tarojs/components'
import './index.scss'

export interface ToastHostProps {
  message?: string
}

export function ToastHost({ message = '' }: ToastHostProps) {
  return (
    <View className={`toast-host ${message ? 'toast-host--visible' : ''}`}>
      {message ? <Text className='toast-host__message'>{message}</Text> : null}
    </View>
  )
}
