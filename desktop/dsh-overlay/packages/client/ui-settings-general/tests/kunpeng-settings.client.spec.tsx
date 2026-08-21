// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { KunpengSettingsSection } from '../src/client/KunpengSettingsSection.tsx'

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

describe('KunpengSettingsSection', () => {
  it('persists research defaults consumed by the workbench', () => {
    render(<KunpengSettingsSection />)
    fireEvent.change(screen.getByPlaceholderText('可留空，由学生每次填写'), { target: { value: '研究生甲' } })
    fireEvent.change(screen.getByDisplayValue('GBLUP'), { target: { value: 'ssGBLUP' } })
    fireEvent.click(screen.getByText('保存科研设置'))
    const saved = JSON.parse(localStorage.getItem('kunpeng.research.settings.v1') ?? '{}') as Record<string, unknown>
    expect(saved.defaultOwner).toBe('研究生甲')
    expect(saved.gsModel).toBe('ssGBLUP')
    expect(screen.getByText('已保存，重新打开工作台后生效')).toBeTruthy()
  })
})
