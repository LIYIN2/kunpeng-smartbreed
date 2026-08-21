import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..')
const sourceDir = path.resolve(webRoot, '../cli/config/agent-presets/kunpeng-smartbreed/knowledge')
const outputPath = path.resolve(webRoot, 'public/kunpeng-knowledge.json')

function categoryOf(name) {
  if (/安全|病害|规范/.test(name)) return '安全与规范'
  if (/PIT|测鱼宝|游泳|仪器|实验技术|装置/.test(name)) return '实验技术'
  if (/拉鱼|用池|鱼排|养殖|繁育|实验安排|近期工作/.test(name)) return '养殖与繁育'
  if (/芯片|种质|数据档案/.test(name)) return '数据与送测'
  if (/采购|报销|物资|通讯录|课题组/.test(name)) return '科研事务'
  if (/新品种|审定|建设方案/.test(name)) return '项目与申报'
  return '其他'
}

function frontmatterOf(text) {
  if (!text.startsWith('---\n')) return {}
  const end = text.indexOf('\n---\n', 4)
  if (end < 0) return {}
  const result = {}
  for (const line of text.slice(4, end).split('\n')) {
    const match = line.match(/^([a-z_]+):\s*["']?(.*?)["']?$/)
    if (match) result[match[1]] = match[2]
  }
  return result
}

function bodyOf(text) {
  if (!text.startsWith('---\n')) return text
  const end = text.indexOf('\n---\n', 4)
  return end < 0 ? text : text.slice(end + 5)
}

const files = (await readdir(sourceDir)).filter(name => name.endsWith('.md')).sort((a, b) => a.localeCompare(b, 'zh-CN'))
const entries = []
for (const file of files) {
  const raw = await readFile(path.join(sourceDir, file), 'utf8')
  const meta = frontmatterOf(raw)
  const body = bodyOf(raw).trim()
  const heading = body.match(/^#\s+(.+)$/m)?.[1]
  const title = meta.title || heading || file.replace(/\.md$/, '')
  const plain = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[`>*_[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  entries.push({
    id: meta.knowledge_id || file.replace(/\.md$/, ''),
    title,
    file,
    category: meta.category || categoryOf(file),
    status: meta.status || 'legacy',
    evidenceLevel: meta.evidence_level || 'unrated',
    sensitivity: meta.sensitivity || 'internal',
    source: meta.source_title || file.replace(/\.md$/, ''),
    sourceLocator: meta.source_locator || '原知识页',
    excerpt: plain.slice(0, 180),
    content: body,
  })
}

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), count: entries.length, entries }, null, 2)}\n`)
console.log(`generated ${entries.length} knowledge entries -> ${outputPath}`)
