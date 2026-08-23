import type { ChangeEvent } from 'react'
import {
  DEFAULT_GENERATION_STYLE_INDEX,
  GENERATION_STYLES
} from '@/constants/generation-styles'
import { BOARD_SIZE_OPTIONS } from '@/features/pixel-editor/model'
import type { ToolbarProps } from './types'
import './index.h5.scss'

export function Toolbar({
  removeBackground = false,
  boardSizeValue = { width: 29, height: 29 },
  styleIndexValue = DEFAULT_GENERATION_STYLE_INDEX,
  modeQuickLabel,
  modeQuickConnected = false,
  onToggleBackground,
  onClear,
  onPickImage,
  onOpenPairSheet,
  onOpenSettings,
  onChangeBoardSize,
  onChangeStyle
}: ToolbarProps) {
  function handleBoardSizeChange(event: ChangeEvent<HTMLSelectElement>) {
    const selected = BOARD_SIZE_OPTIONS.find((item) => item.id === event.target.value)
    if (selected) {
      onChangeBoardSize?.({ width: selected.width, height: selected.height })
    }
  }

  function handleStyleChange(event: ChangeEvent<HTMLSelectElement>) {
    onChangeStyle?.(Number(event.target.value))
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
        className='led-size-btn generation-style-select'
        onChange={handleStyleChange}
        title='生成风格'
        value={String(styleIndexValue)}
      >
        {GENERATION_STYLES.map((style) => (
          <option key={style.index} value={style.index}>
            {style.name}
          </option>
        ))}
      </select>
      <select
        className='led-size-btn'
        onChange={handleBoardSizeChange}
        value={`${boardSizeValue.width}x${boardSizeValue.height}`}
      >
        {BOARD_SIZE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
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
