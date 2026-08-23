import './app.scss'
import { initializeWanxiangCloudBase } from './services/wanxiang-cloudbase'

initializeWanxiangCloudBase()

export default function App({ children }) {
  return children
}
