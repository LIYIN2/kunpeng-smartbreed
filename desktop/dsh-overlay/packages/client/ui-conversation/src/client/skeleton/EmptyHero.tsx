// Hero chrome for the blank-draft phase of ConversationRoot: fish headline,
// glow backdrop, and the workspace row. Pure presentation — the resident
// composer is NOT rendered here (it keeps its own stable tree position in
// ConversationRoot so the textarea survives the hero → composer flip); CSS
// positions it over this shell's glow area during the hero phase.

import { useId, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  IconChevronDownOutline14, IconFolderClose16, IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSlotProps } from '../contract/slots.ts'
import css from './HeroShell.module.css'
import { KunpengWorkbench } from './KunpengWorkbench.tsx'
import type { WorkbenchView } from './KunpengWorkbench.tsx'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationSlotProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderClose16 className={css.folder} size={16} />
        : <IconFolderOpen16 className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutline14 className={css.chevron} size={12} />
    </button>
  )
}

/**
 * The soft blue backdrop ellipse (figma 313:14109). Rendered by the hero
 * owner (ConversationRoot), not HeroShell, so it can center on the input
 * card; the owner's className supplies all positioning.
 * @param props.className - positioning class from the owner.
 * @returns the blurred-ellipse svg element.
 */
export function HeroGlow({ className }: { className?: string | undefined }) {
  // Stable filter id so multiple hero mounts do not collide in the DOM.
  const glowFilterId = `empty-glow-${useId().replace(/:/g, '')}`
  return (
    <svg className={className} viewBox="0 0 1051 468" fill="none" aria-hidden="true">
      <defs>
        <filter
          id={glowFilterId}
          x="0"
          y="0"
          width="1051"
          height="468"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="50" result="effect1_foregroundBlur" />
        </filter>
      </defs>
      <g filter={`url(#${glowFilterId})`}>
        <ellipse cx="525.5" cy="234" rx="425.5" ry="134" fill="#6187D8" fillOpacity="0.08" />
      </g>
    </svg>
  )
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Fill the resident composer with one reviewed research-task starter. */
  onQuickStart?: ((prompt: string) => void) | undefined
  /** False until a workspace-backed session exposes the input action face. */
  quickStartReady?: boolean
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/**
 * Render the hero chrome (headline only; no glow, no composer, no workspace
 * row — the glow is the owner's {@link HeroGlow}).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, onQuickStart, quickStartReady = false, children }: HeroShellProps) {
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView | undefined>(undefined)
  const modules = [
    { id: 'literature', code: '01', title: t('hero.module.literature'), description: t('hero.module.literature.desc'), prompt: '', view: 'literature' as const },
    { id: 'daily', code: '02', title: t('hero.module.daily'), description: t('hero.module.daily.desc'), prompt: '', view: 'daily' as const },
    { id: 'omics', code: '03', title: t('hero.module.omics'), description: t('hero.module.omics.desc'), prompt: '', view: 'omics' as const },
    { id: 'data', code: '04', title: t('hero.module.data'), description: t('hero.module.data.desc'), prompt: '', view: 'data' as const },
    { id: 'gs', code: '05', title: t('hero.module.gs'), description: t('hero.module.gs.desc'), prompt: '', view: 'gs' as const },
    { id: 'writing', code: '06', title: t('hero.module.writing'), description: t('hero.module.writing.desc'), prompt: '', view: 'writing' as const },
  ] as const
  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.identity}>
          <img className={css.heroLogo} src="/kunpeng-logo.png" alt="" />
          <div>
            <div className={css.eyebrow}>{t('hero.kicker')}</div>
            <div className={css.headline}>{t('hero.headline')}</div>
          </div>
        </div>
        <p className={css.intro}>{t('hero.intro')}</p>
        <div className={css.principles}>
          <span>{t('hero.principle.evidence')}</span><span>{t('hero.principle.reproducible')}</span>
          <span>{t('hero.principle.explainable')}</span><span>{t('hero.principle.governed')}</span>
        </div>
        <div className={css.workbenchActions}>
          <button type="button" onClick={() => { setWorkbenchView('knowledge') }}>打开知识中心</button>
          <button type="button" onClick={() => { setWorkbenchView('intake') }}>登记新知识</button>
          <button type="button" onClick={() => { setWorkbenchView('feedback') }}>提交信息反馈</button>
          <span>GitHub 知识库已载入本地索引</span>
        </div>
        <div className={css.moduleGrid} aria-label={t('hero.modules')}>
          {modules.map(module => (
            <button
              key={module.id}
              type="button"
              className={css.moduleCard}
              onClick={() => {
                setWorkbenchView(module.view)
              }}
            >
              <span className={css.moduleCode}>{module.code}</span>
              <strong>{module.title}</strong>
              <small>{module.description}</small>
              <span className={css.moduleArrow}>↗</span>
            </button>
          ))}
        </div>
        {!quickStartReady && <div className={css.readyHint}>可以先查看和登记；启动分析对话前需选择工作区。</div>}
      </div>
      {workbenchView !== undefined && <KunpengWorkbench initialView={workbenchView} onClose={() => { setWorkbenchView(undefined) }} onQuickStart={onQuickStart} />}
      {children}
    </div>
  )
}
