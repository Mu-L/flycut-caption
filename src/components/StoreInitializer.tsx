// Store 初始化组件
import { useEffect } from 'react'
import { useAppStore } from '@/stores/appStore'

export function StoreInitializer() {
  const initialize = useAppStore(state => state.initialize)
  
  useEffect(() => {
    initialize()
  }, [initialize])
  
  return null
}