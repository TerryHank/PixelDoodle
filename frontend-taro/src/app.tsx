import './app.scss'
import { initializeWanxiangCloudBase } from './services/wanxiang-cloudbase-bootstrap'

initializeWanxiangCloudBase()

export default function App({ children }) {
  return children
}
