import type { CSSProperties } from 'react'
import backIcon from '@/assets/v13/common/back.png'
import linkIcon from '@/assets/v13/common/link.png'
import powerIcon from '@/assets/v13/common/power.png'
import launchBackground from '@/assets/v13/launch/background.png'
import launchLogo from '@/assets/v13/launch/logo.png'
import homeBackground from '@/assets/v13/home/background.png'
import cardFreeCreate from '@/assets/v13/home/card-free-create.png'
import cardLibrary from '@/assets/v13/home/card-library.png'
import cardPhotoImport from '@/assets/v13/home/card-photo-import.png'
import cardPixelImport from '@/assets/v13/home/card-pixel-import.png'
import homeHero from '@/assets/v13/home/hero.png'
import homeLogo from '@/assets/v13/home/logo.png'
import buttonFreeCreate from '@/assets/v13/home/button-free-create.png'
import buttonLibrary from '@/assets/v13/home/button-library.png'
import buttonPhotoImport from '@/assets/v13/home/button-photo-import.png'
import buttonPixelImport from '@/assets/v13/home/button-pixel-import.png'
import './index.h5.scss'

interface V13LaunchScreenProps {
  visible: boolean
}

export function V13LaunchScreen({ visible }: V13LaunchScreenProps) {
  if (!visible) return null

  return (
    <div
      className='v13-launch-screen'
      style={{ '--v13-launch-bg': `url(${launchBackground})` } as CSSProperties}
      aria-label='DIY拼豆启动页'
    >
      <img className='v13-launch-screen__hero' src={homeHero} alt='' />
      <img className='v13-launch-screen__logo' src={launchLogo} alt='DIY拼豆' />
    </div>
  )
}

interface V13HomeLandingProps {
  hasLocalDraft: boolean
  onCreate: () => void
  onPixelImport: () => void
  onPhotoImport: () => void
  onOpenLibrary: () => void
  onOpenConnection: () => void
  onRestoreDraft: () => void
}

const HOME_ACTIONS = [
  {
    key: 'free-create',
    title: '自由创作',
    subtitle: '激发想象，随心创作',
    card: cardFreeCreate,
    button: buttonFreeCreate
  },
  {
    key: 'pixel-import',
    title: '导入像素画',
    subtitle: '保留硬边，不平滑原像素',
    card: cardPixelImport,
    button: buttonPixelImport
  },
  {
    key: 'photo-import',
    title: '照片转拼豆',
    subtitle: '等比取样，量化为拼豆色',
    card: cardPhotoImport,
    button: buttonPhotoImport
  },
  {
    key: 'library',
    title: '素材库',
    subtitle: '优秀作品，随时搜索',
    card: cardLibrary,
    button: buttonLibrary
  }
] as const

export function V13HomeLanding({
  hasLocalDraft,
  onCreate,
  onPixelImport,
  onPhotoImport,
  onOpenLibrary,
  onOpenConnection,
  onRestoreDraft
}: V13HomeLandingProps) {
  const handlers = {
    'free-create': onCreate,
    'pixel-import': onPixelImport,
    'photo-import': onPhotoImport,
    library: onOpenLibrary
  }

  return (
    <section
      className='v13-home'
      style={{ '--v13-home-bg': `url(${homeBackground})` } as CSSProperties}
      aria-labelledby='v13-home-title'
    >
      <header className='v13-home__header'>
        <button className='v13-round-action' type='button' onClick={onCreate} aria-label='开始自由创作'>
          <img src={powerIcon} alt='' />
        </button>
        <img className='v13-home__logo' src={homeLogo} alt='DIY拼豆' />
        <button className='v13-round-action' type='button' onClick={onOpenConnection} aria-label='连接拼豆设备'>
          <img src={linkIcon} alt='' />
        </button>
      </header>

      <img className='v13-home__hero' src={homeHero} alt='' />
      <h1 id='v13-home-title' className='v13-visually-hidden'>DIY拼豆首页</h1>

      <div className='v13-home__action-panel'>
        <div className='v13-home__action-grid'>
          {HOME_ACTIONS.map((action) => (
            <button
              key={action.key}
              className={`v13-entry-card v13-entry-card--${action.key}`}
              type='button'
              onClick={handlers[action.key]}
            >
              <img className='v13-entry-card__background' src={action.card} alt='' />
              <span className='v13-entry-card__copy'>
                <strong>{action.title}</strong>
                <small>{action.subtitle}</small>
              </span>
              <img className='v13-entry-card__button' src={action.button} alt='' />
            </button>
          ))}
        </div>
        {hasLocalDraft ? (
          <button className='v13-home__restore' type='button' onClick={onRestoreDraft}>
            恢复上次本地草稿
          </button>
        ) : null}
      </div>
    </section>
  )
}

interface SetupOption {
  id: string
  label: string
}

interface V13CreationSetupProps {
  boardOptions: SetupOption[]
  paletteOptions: SetupOption[]
  selectedBoard: string
  selectedPalette: string
  onBack: () => void
  onBoardChange: (value: string) => void
  onPaletteChange: (value: string) => void
  onStart: () => void
}

export function V13CreationSetup({
  boardOptions,
  paletteOptions,
  selectedBoard,
  selectedPalette,
  onBack,
  onBoardChange,
  onPaletteChange,
  onStart
}: V13CreationSetupProps) {
  return (
    <section className='v13-setup' aria-labelledby='v13-setup-title'>
      <header className='v13-page-header'>
        <button className='v13-page-header__back' type='button' onClick={onBack} aria-label='返回首页'>
          <img src={backIcon} alt='' />
        </button>
        <h1 id='v13-setup-title'>参数选择</h1>
        <span aria-hidden='true' />
      </header>

      <div className='v13-setup__panel'>
        <fieldset className='v13-choice-group'>
          <legend>配色方案</legend>
          <div className='v13-choice-group__options'>
            {paletteOptions.map((option) => (
              <button
                key={option.id}
                className={`v13-choice-button ${selectedPalette === option.id ? 'is-active' : ''}`}
                type='button'
                aria-pressed={selectedPalette === option.id}
                onClick={() => onPaletteChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className='v13-choice-group'>
          <legend>钉板尺寸</legend>
          <div className='v13-choice-group__options v13-choice-group__options--boards'>
            {boardOptions.map((option) => (
              <button
                key={option.id}
                className={`v13-choice-button ${selectedBoard === option.id ? 'is-active' : ''}`}
                type='button'
                aria-pressed={selectedBoard === option.id}
                onClick={() => onBoardChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <button className='v13-setup__start' type='button' onClick={onStart}>
        开始创作
      </button>
    </section>
  )
}
