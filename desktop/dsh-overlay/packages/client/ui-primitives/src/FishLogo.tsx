import type { IconProps } from './icons/props.ts'

/** Render the Kunpeng bird-and-croaker emblem while keeping the upstream logo API stable. */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <img
      src="/kunpeng-logo.png"
      alt=""
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      style={{ borderRadius: '50%' }}
    />
  )
}
