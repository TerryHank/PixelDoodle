import Taro from '@tarojs/taro'
import { Input, ScrollView, Text, View } from '@tarojs/components'
import { useEffect, useMemo, useState } from 'react'
import { bleAdapter } from '@/adapters/ble'
import { fileAdapter } from '@/adapters/file'
import { savePendingCloudWorkEdit } from '@/services/cloud-work-edit'
import {
  createPaymentOrder,
  createSettlement,
  fetchEarningsCsv,
  getCommerceConfig,
  getPaymentOrder,
  issueDeviceAccessGrant,
  listEarnings,
  listPaymentOrders,
  recordDeviceActivation,
  sandboxPayOrder,
  sandboxRegisterCommerceDevice
} from '@/services/commerce-service'
import {
  deletePrivateCloudWork,
  getPrivateCloudWork,
  listPrivateCloudWorks,
  restorePrivateCloudWork
} from '@/services/private-cloud-service'
import { useDeviceStore } from '@/store/device-store'
import { useUserStore } from '@/store/user-store'
import type { CommerceConfig, EarningsResponse, PaymentOrder } from '@/types/commerce'
import type { PrivateCloudWorkSummary } from '@/types/private-cloud'
import './index.scss'

function money(cents = 0, currency = 'CNY') {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency
  }).format(cents / 100)
}

function normalizeDeviceId(value: string) {
  return value.trim().toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12)
}

export default function AccountPage() {
  const userId = useUserStore((state) => state.id)
  const rememberedDeviceId = useDeviceStore((state) => state.targetDeviceUuid)
  const [deviceId, setDeviceId] = useState(rememberedDeviceId)
  const [config, setConfig] = useState<CommerceConfig | null>(null)
  const [order, setOrder] = useState<PaymentOrder | null>(null)
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [works, setWorks] = useState<PrivateCloudWorkSummary[]>([])
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [earnings, setEarnings] = useState<EarningsResponse | null>(null)
  const [busyAction, setBusyAction] = useState('')
  const [notice, setNotice] = useState('')

  const cnySummary = earnings?.summary.CNY
  const normalizedDeviceId = normalizeDeviceId(deviceId)
  const canUseDevice = normalizedDeviceId.length === 12

  async function loadCloud(nextIncludeDeleted = includeDeleted) {
    const page = await listPrivateCloudWorks(userId, {
      includeDeleted: nextIncludeDeleted,
      limit: 100
    })
    if (!page || !Array.isArray(page.items)) {
      throw new Error('云端服务暂未连接')
    }
    setWorks(page.items)
  }

  async function refreshFinance() {
    const [nextOrders, nextEarnings] = await Promise.all([
      listPaymentOrders(userId),
      listEarnings(userId)
    ])
    if (!nextOrders || !Array.isArray(nextOrders.items) || !nextEarnings) {
      throw new Error('支付与收益服务暂未连接')
    }
    setOrders(nextOrders.items)
    setEarnings(nextEarnings)
  }

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      getCommerceConfig(),
      listPrivateCloudWorks(userId, { includeDeleted: false, limit: 100 }),
      listPaymentOrders(userId),
      listEarnings(userId)
    ])
      .then(([configResult, cloudResult, ordersResult, earningsResult]) => {
        if (cancelled) return

        let serviceUnavailable = false
        if (configResult.status === 'fulfilled' && configResult.value) {
          setConfig(configResult.value)
        } else {
          serviceUnavailable = true
        }
        if (
          cloudResult.status === 'fulfilled' &&
          cloudResult.value &&
          Array.isArray(cloudResult.value.items)
        ) {
          setWorks(cloudResult.value.items)
        } else {
          serviceUnavailable = true
        }
        if (
          ordersResult.status === 'fulfilled' &&
          ordersResult.value &&
          Array.isArray(ordersResult.value.items)
        ) {
          setOrders(ordersResult.value.items)
        } else {
          serviceUnavailable = true
        }
        if (earningsResult.status === 'fulfilled' && earningsResult.value) {
          setEarnings(earningsResult.value)
        } else {
          serviceUnavailable = true
        }

        if (serviceUnavailable) {
          setNotice('云端与支付服务暂未连接，当前仍可使用本地创作和素材库。')
        }
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  async function run(action: string, operation: () => Promise<void>) {
    setBusyAction(action)
    setNotice('')
    try {
      await operation()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusyAction('')
    }
  }

  function handleCreateOrder() {
    void run('create-order', async () => {
      if (!canUseDevice) {
        throw new Error('请输入设备机身上的 12 位十六进制设备码')
      }
      if (config?.sandbox_payment) {
        await sandboxRegisterCommerceDevice(userId, {
          device_id: normalizedDeviceId
        })
      }
      const created = await createPaymentOrder(userId, normalizedDeviceId)
      setOrder(created)
      setOrders((items) => [created, ...items.filter((item) => item.id !== created.id)])
      setNotice(`订单已创建：${money(created.amount_cents, created.currency)}`)
    })
  }

  function handleSandboxPay() {
    if (!order) return
    void run('pay', async () => {
      const result = await sandboxPayOrder(userId, order.id)
      setOrder(result.order)
      await refreshFinance()
      setNotice('沙盒支付已确认，分润台账已自动生成')
    })
  }

  function handleRefreshOrder() {
    if (!order) return
    void run('refresh-order', async () => {
      const next = await getPaymentOrder(userId, order.id)
      setOrder(next)
      setNotice(`订单状态：${next.status}`)
    })
  }

  function handleOpenCheckout() {
    const checkoutUrl = order?.checkout_url
    if (!checkoutUrl) return
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(checkoutUrl, '_blank', 'noopener,noreferrer')
      return
    }
    void Taro.setClipboardData({ data: checkoutUrl })
  }

  function handleUnlockDevice() {
    if (!order) return
    void run('unlock', async () => {
      const grant = await issueDeviceAccessGrant(userId, order.id)
      const connectedId = await bleAdapter.connectTargetDevice(grant.device_id)
      if (connectedId !== grant.device_id) {
        throw new Error('当前连接的蓝牙设备与订单设备不一致')
      }
      await bleAdapter.activateDevice(grant.access_token)
      await recordDeviceActivation(userId, grant.device_id, grant.access_token)
      useDeviceStore.getState().setTargetDeviceUuid(grant.device_id)
      useDeviceStore.getState().setBleConnectionStatus('connected')
      useDeviceStore.getState().setBleCharacteristicStatus('ready')
      setNotice(`设备已启动，可使用 ${Math.round(grant.duration_seconds / 60)} 分钟`)
    })
  }

  function handleOpenCloudWork(work: PrivateCloudWorkSummary) {
    void run(`open-${work.id}`, async () => {
      const detail = await getPrivateCloudWork(userId, work.id, {
        includeDeleted: Boolean(work.deleted_at)
      })
      if (detail.deleted_at) {
        throw new Error('请先恢复已删除的作品')
      }
      savePendingCloudWorkEdit(detail)
      await Taro.redirectTo({ url: '/pages/home/index' })
    })
  }

  function handleDeleteCloudWork(work: PrivateCloudWorkSummary) {
    void run(`delete-${work.id}`, async () => {
      await deletePrivateCloudWork(userId, work.id, work.version)
      await loadCloud(includeDeleted)
      setNotice('作品已移入云端回收站')
    })
  }

  function handleRestoreCloudWork(work: PrivateCloudWorkSummary) {
    void run(`restore-${work.id}`, async () => {
      await restorePrivateCloudWork(userId, work.id, work.version)
      await loadCloud(includeDeleted)
      setNotice('云端作品已恢复')
    })
  }

  function handleExportEarnings() {
    void run('export', async () => {
      const content = await fetchEarningsCsv(userId)
      await fileAdapter.saveBinaryFile(
        'pixeldoodle-earnings.csv',
        'text/csv;charset=utf-8',
        content
      )
      setNotice('收益明细 CSV 已导出')
    })
  }

  function handleSettlement() {
    void run('settlement', async () => {
      const batch = await createSettlement(userId)
      await refreshFinance()
      setNotice(`结算批次 ${batch.status}：${money(batch.amount_cents, batch.currency)}`)
    })
  }

  const orderHint = useMemo(() => {
    if (!order) return '由服务端设备登记信息决定价格和收款方，客户端不能修改。'
    return `${order.device_id} · ${money(order.amount_cents, order.currency)} · ${order.status}`
  }, [order])

  return (
    <View className='account-page'>
      <ScrollView className='account-page__scroll' scrollY>
        <View className='account-page__content'>
          <View className='account-page__header'>
            <View
              className='account-page__back'
              onClick={() => void Taro.redirectTo({ url: '/pages/profile/index' })}
            >
              <Text>← 返回我的</Text>
            </View>
            <Text className='account-page__title'>云端与设备中心</Text>
            <Text className='account-page__subtitle'>支付解锁、私有云作品和收益结算统一管理</Text>
          </View>

          {notice ? <View className='account-notice'><Text>{notice}</Text></View> : null}

          <View className='account-card'>
            <View className='account-card__heading'>
              <View>
                <Text className='account-card__title'>支付后启动设备</Text>
                <Text className='account-card__hint'>{orderHint}</Text>
              </View>
              <Text className='account-badge'>
                {config?.sandbox_payment ? '本地沙盒' : config?.payment_provider || '待接支付商'}
              </Text>
            </View>
            <Input
              className='account-input'
              value={deviceId}
              maxlength={12}
              placeholder='12 位设备码，例如 A1B2C3D4E5F6'
              onInput={(event) => setDeviceId(normalizeDeviceId(event.detail.value))}
            />
            <View className='account-actions'>
              <View className='account-button account-button--primary' onClick={handleCreateOrder}>
                <Text>{busyAction === 'create-order' ? '创建中...' : '创建支付订单'}</Text>
              </View>
              {order?.status === 'pending' && config?.sandbox_payment ? (
                <View className='account-button' onClick={handleSandboxPay}>
                  <Text>{busyAction === 'pay' ? '确认中...' : '模拟支付成功'}</Text>
                </View>
              ) : null}
              {order?.status === 'pending' && !config?.sandbox_payment ? (
                <View className='account-button' onClick={handleOpenCheckout}>
                  <Text>打开支付页</Text>
                </View>
              ) : null}
              {order ? (
                <View className='account-button' onClick={handleRefreshOrder}>
                  <Text>刷新状态</Text>
                </View>
              ) : null}
              {order?.status === 'paid' ? (
                <View className='account-button account-button--success' onClick={handleUnlockDevice}>
                  <Text>{busyAction === 'unlock' ? '正在连接并启动...' : '连接并启动设备'}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View className='account-card'>
            <View className='account-card__heading'>
              <View>
                <Text className='account-card__title'>我的私有云作品</Text>
                <Text className='account-card__hint'>画布页可直接保存；这里负责打开、删除和恢复。</Text>
              </View>
              <View
                className={`account-chip ${includeDeleted ? 'account-chip--active' : ''}`}
                onClick={() => {
                  const next = !includeDeleted
                  setIncludeDeleted(next)
                  void run('cloud-list', () => loadCloud(next))
                }}
              >
                <Text>{includeDeleted ? '含回收站' : '仅正常作品'}</Text>
              </View>
            </View>
            {works.length === 0 ? (
              <View className='account-empty'><Text>还没有云端作品，请从创作画布保存。</Text></View>
            ) : (
              <View className='account-list'>
                {works.map((work) => (
                  <View className='account-list__item' key={work.id}>
                    <View className='account-list__meta'>
                      <Text className='account-list__title'>{work.title}</Text>
                      <Text className='account-card__hint'>
                        {work.grid_size.width}×{work.grid_size.height} · v{work.version} · {work.total_beads} 颗
                      </Text>
                    </View>
                    {work.deleted_at ? (
                      <View className='account-button account-button--compact' onClick={() => handleRestoreCloudWork(work)}>
                        <Text>恢复</Text>
                      </View>
                    ) : (
                      <>
                        <View className='account-button account-button--compact' onClick={() => handleOpenCloudWork(work)}>
                          <Text>打开</Text>
                        </View>
                        <View className='account-button account-button--compact account-button--danger' onClick={() => handleDeleteCloudWork(work)}>
                          <Text>删除</Text>
                        </View>
                      </>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>

          <View className='account-card'>
            <View className='account-card__heading'>
              <View>
                <Text className='account-card__title'>收益与自动分润</Text>
                <Text className='account-card__hint'>每笔支付按规则快照分账，金额以分为单位守恒。</Text>
              </View>
              <Text className='account-badge'>{config?.auto_settle ? '自动结算已开' : '自动结算由调度器执行'}</Text>
            </View>
            <View className='earnings-summary'>
              <View className='earnings-summary__item'><Text>累计收益</Text><Text>{money(cnySummary?.total_cents)}</Text></View>
              <View className='earnings-summary__item'><Text>可结算</Text><Text>{money(cnySummary?.available_cents)}</Text></View>
              <View className='earnings-summary__item'><Text>已结算</Text><Text>{money(cnySummary?.settled_cents)}</Text></View>
            </View>
            <View className='account-actions'>
              <View className='account-button' onClick={handleExportEarnings}>
                <Text>{busyAction === 'export' ? '导出中...' : '导出 CSV'}</Text>
              </View>
              <View className='account-button account-button--primary' onClick={handleSettlement}>
                <Text>{busyAction === 'settlement' ? '结算中...' : '立即结算可用收益'}</Text>
              </View>
            </View>
            {earnings?.items.length ? (
              <View className='account-list'>
                {earnings.items.slice(0, 8).map((item) => (
                  <View className='account-list__item' key={item.allocation_id}>
                    <View className='account-list__meta'>
                      <Text className='account-list__title'>{money(item.share_cents, item.currency)}</Text>
                      <Text className='account-card__hint'>{item.role} · 订单 {item.order_id.slice(0, 8)}</Text>
                    </View>
                    <Text className='account-badge'>{item.status}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {orders.length ? (
            <View className='account-card'>
              <Text className='account-card__title'>最近订单</Text>
              <View className='account-list'>
                {orders.slice(0, 6).map((item) => (
                  <View className='account-list__item' key={item.id} onClick={() => setOrder(item)}>
                    <View className='account-list__meta'>
                      <Text className='account-list__title'>{item.device_id}</Text>
                      <Text className='account-card__hint'>{money(item.amount_cents, item.currency)} · {new Date(item.created_at).toLocaleString()}</Text>
                    </View>
                    <Text className='account-badge'>{item.status}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  )
}
