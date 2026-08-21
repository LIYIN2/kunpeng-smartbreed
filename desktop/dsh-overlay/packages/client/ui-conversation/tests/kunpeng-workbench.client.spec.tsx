// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KunpengWorkbench } from '../src/client/skeleton/KunpengWorkbench.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('crypto', { randomUUID: () => 'task-1' })
})

describe('KunpengWorkbench', () => {
  it('loads and searches the generated knowledge catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        count: 2,
        entries: [
          { id: '1', title: 'PIT 标记操作', file: 'pit.md', category: '实验技术', status: 'reviewed', evidenceLevel: 'A', sensitivity: 'internal', source: '知识库', sourceLocator: '第 1 节', excerpt: '电子标记', content: 'PIT 标记规范正文' },
          { id: '2', title: '采购流程', file: 'buy.md', category: '科研办公', status: 'draft', evidenceLevel: 'B', sensitivity: 'internal', source: '知识库', sourceLocator: '第 2 节', excerpt: '采购', content: '采购流程正文' },
        ],
      }),
    })))

    render(<KunpengWorkbench initialView="knowledge" onClose={() => {}} />)
    expect(await screen.findByText('已载入 2 条 · 当前 2 条')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('搜索标题、正文或流程…'), { target: { value: 'PIT' } })
    expect(screen.getByText('已载入 2 条 · 当前 1 条')).toBeTruthy()
    expect(screen.getAllByText('PIT 标记操作')).toHaveLength(2)
    expect(screen.queryByText('采购流程')).toBeNull()
  })

  it('persists daily research tasks locally', () => {
    render(<KunpengWorkbench initialView="daily" onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('要交付的具体结果'), { target: { value: '完成芯片质控' } })
    fireEvent.change(screen.getByPlaceholderText('负责人'), { target: { value: '学生甲' } })
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: '2026-08-22' } })
    fireEvent.click(screen.getByText('添加任务'))
    expect(screen.getByText('完成芯片质控')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('kunpeng.research.tasks.v1') ?? '[]')).toEqual([
      { id: 'task-1', title: '完成芯片质控', owner: '学生甲', due: '2026-08-22', status: 'todo' },
    ])
  })

  it('unlocks genomic-selection handoff only after sample alignment gates pass', async () => {
    const onQuickStart = vi.fn()
    render(<KunpengWorkbench initialView="gs" onClose={() => {}} onQuickStart={onQuickStart} />)
    fireEvent.change(screen.getByPlaceholderText('例：宁抗1号 F4 候选群体'), { target: { value: '抗病候选群体' } })
    fireEvent.change(screen.getByPlaceholderText('例：攻毒后存活（0/1）'), { target: { value: '存活（0/1）' } })
    const files = screen.getAllByLabelText(/首列为个体 ID/)
    const phenotype = { name: 'phenotype.csv', text: async () => 'id,value\nA,1\nB,0\n' } as File
    const genotype = { name: 'genotype.csv', text: async () => 'id\nB\nC\n' } as File
    fireEvent.change(files[0]!, { target: { files: [phenotype] } })
    fireEvent.change(files[1]!, { target: { files: [genotype] } })
    await waitFor(() => { expect(screen.getByText('5/5')).toBeTruthy() })
    expect(screen.getByText((_, element) => element?.tagName === 'DIV' && element.textContent === '可对齐个体 1 · 仅表型 1 · 仅基因型 1')).toBeTruthy()
    fireEvent.click(screen.getByText('将已校验项目送入分析对话'))
    expect(onQuickStart).toHaveBeenCalledOnce()
    expect(onQuickStart.mock.calls[0]?.[0]).toContain('可对齐个体 1 个')
  })

})
