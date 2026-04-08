import type { ChangeEvent } from 'react'
import type { ToolbarProps } from './types'
import './index.h5.scss'

export function Toolbar({
  removeBackground = false,
  difficultyValue = '0.125',
  ledSizeValue = 64,
  modeQuickLabel,
  modeQuickConnected = false,
  onToggleBackground,
  onClear,
  onPickImage,
  onOpenPairSheet,
  onOpenSettings,
  onChangeDifficulty,
  onChangeLedSize
}: ToolbarProps) {
  function handleDifficultyChange(event: ChangeEvent<HTMLSelectElement>) {
    onChangeDifficulty?.(event.target.value)
  }

  function handleLedSizeChange(event: ChangeEvent<HTMLSelectElement>) {
    onChangeLedSize?.(Number(event.target.value))
  }

  return (
    <div className='canvas-toolbar'>
      <button className='toolbar-btn' onClick={onClear} title='回到主页' type='button'>
        <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
          <path d='M3 10.5 12 3l9 7.5' />
          <path d='M5 9.5V21h14V9.5' />
          <path d='M9 21v-6h6v6' />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${removeBackground ? 'toolbar-btn--active' : ''}`}
        onClick={onToggleBackground}
        title='自动去除背景'
        type='button'
      >
        背
      </button>
      <button className='toolbar-btn' onClick={onPickImage} title='上传' type='button'>
        <span className='toolbar-btn-icon'>+</span>
      </button>
      <select
        className='led-size-btn'
        onChange={handleDifficultyChange}
        title='难度'
        value={difficultyValue}
      >
        <option value='1'>原</option>
        <option value='0.25'>难</option>
        <option value='0.125'>中</option>
        <option value='0.0625'>易</option>
      </select>
      <select
        className='led-size-btn'
        onChange={handleLedSizeChange}
        value={String(ledSizeValue)}
      >
        <option value='16'>16</option>
        <option value='32'>32</option>
        <option value='52'>52</option>
        <option value='64'>64</option>
      </select>
      <button
        className={`toolbar-btn mode-quick-btn ${modeQuickConnected ? 'mode-quick-btn--connected' : 'mode-quick-btn--disconnected'}`}
        onClick={onOpenPairSheet}
        title='蓝牙连接'
        type='button'
      >
        {modeQuickLabel}
      </button>
      <button className='toolbar-btn' onClick={onOpenSettings} title='导出' type='button'>
        <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
          <path d='M12 3v12' />
          <path d='m7 10 5 5 5-5' />
          <path d='M5 21h14' />
        </svg>
      </button>
    </div>
  )
}
