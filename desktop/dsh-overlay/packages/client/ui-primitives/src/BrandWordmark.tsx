import type { IconProps } from './icons/props.ts'

/** Render the Kunpeng product wordmark while keeping the upstream component API stable. */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: size, whiteSpace: 'nowrap' }}
    >
      <img src="/kunpeng-logo.png" alt="" width={size} height={size} style={{ borderRadius: '50%' }} />
      <span style={{ fontSize: size * 0.72, lineHeight: 1, fontWeight: 650, letterSpacing: '0.06em' }}>鲲鹏智能体</span>
      <span style={{ fontSize: size * 0.38, lineHeight: 1, color: 'var(--dsw-alias-label-tertiary)', letterSpacing: '0.08em' }}>科研工作台</span>
    </span>
  )
}
