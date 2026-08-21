import { useEffect, useMemo, useState } from 'react'
import css from './KunpengWorkbench.module.css'

export type WorkbenchView = 'literature' | 'daily' | 'omics' | 'data' | 'gs' | 'writing' | 'knowledge' | 'intake' | 'feedback'

interface KnowledgeEntry {
  id: string
  title: string
  file: string
  category: string
  status: string
  evidenceLevel: string
  sensitivity: string
  source: string
  sourceLocator: string
  excerpt: string
  content: string
}

interface KnowledgePayload {
  count: number
  entries: KnowledgeEntry[]
}

interface ResearchTask {
  id: string
  title: string
  owner: string
  due: string
  status: 'todo' | 'doing' | 'done'
}

interface IdManifest {
  name: string
  rows: number
  ids: string[]
  duplicates: string[]
  emptyIds: number
}

interface TableAudit extends IdManifest {
  columns: string[]
  emptyCells: number
  inconsistentRows: number
}

interface EvidenceRecord {
  id: string
  title: string
  doi: string
  level: 'A' | 'B' | 'C'
  status: '待核验' | '已核验'
  conclusion: string
}

interface RadarArticle {
  journal: string
  title: string
  doi: string
  url: string
  date: string | null
  authors: string[]
  abstract: string
}

interface RadarPayload {
  updatedAt: string | null
  failedAt?: string
  source?: string
  evidenceLevel?: string
  articles: RadarArticle[]
  error: string | null
}

interface ResearchRadarBridge {
  get: () => Promise<RadarPayload>
  refresh: () => Promise<RadarPayload>
}

interface ControlBridge {
  submitKnowledge: (payload: { title: string; content: string; sourceLocator: string }) => Promise<{ id: string; status: string }>
  submitFeedback: (payload: { category: string; title: string; body: string }) => Promise<{ id: string }>
}

const TASK_STORAGE_KEY = 'kunpeng.research.tasks.v1'
const SETTINGS_STORAGE_KEY = 'kunpeng.research.settings.v1'
const EVIDENCE_STORAGE_KEY = 'kunpeng.evidence.records.v1'
const RADAR_FREQUENCY_KEY = 'kunpeng.research.radar.frequency.v1'

interface KunpengPreferences {
  labName: string
  defaultOwner: string
  gsModel: 'GBLUP' | 'ssGBLUP'
  includeDraftKnowledge: boolean
  persistDailyTasks: boolean
}

function readPreferences(): KunpengPreferences {
  const defaults: KunpengPreferences = { labName: '厦门大学鱼类遗传育种实验室', defaultOwner: '', gsModel: 'GBLUP', includeDraftKnowledge: true, persistDailyTasks: true }
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Partial<KunpengPreferences> }
  } catch {
    return defaults
  }
}

function readTasks(): ResearchTask[] {
  try {
    const value = JSON.parse(localStorage.getItem(TASK_STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value as ResearchTask[] : []
  } catch {
    return []
  }
}

function parseManifest(file: File): Promise<IdManifest> {
  return file.text().then((text) => {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
    const delimiter = (lines[0]?.includes('\t') ?? false) ? '\t' : ','
    const rows = lines.slice(1)
    const ids = rows.map(line => (line.split(delimiter)[0] ?? '').trim())
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const id of ids) {
      if (id !== '' && seen.has(id)) duplicates.add(id)
      seen.add(id)
    }
    return {
      name: file.name,
      rows: rows.length,
      ids: ids.filter(Boolean),
      duplicates: [...duplicates],
      emptyIds: ids.filter(id => id === '').length,
    }
  })
}

function parseTableAudit(file: File): Promise<TableAudit> {
  return file.text().then((text) => {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
    const delimiter = (lines[0]?.includes('\t') ?? false) ? '\t' : ','
    const columns = (lines[0] ?? '').split(delimiter).map(value => value.trim())
    const data = lines.slice(1).map(line => line.split(delimiter).map(value => value.trim()))
    const ids = data.map(row => row[0] ?? '')
    const seen = new Set<string>(); const duplicates = new Set<string>()
    for (const id of ids) { if (id !== '' && seen.has(id)) duplicates.add(id); seen.add(id) }
    return {
      name: file.name,
      rows: data.length,
      columns,
      ids: ids.filter(Boolean),
      duplicates: [...duplicates],
      emptyIds: ids.filter(id => id === '').length,
      emptyCells: data.reduce((sum, row) => sum + row.filter(value => value === '').length, 0),
      inconsistentRows: data.filter(row => row.length !== columns.length).length,
    }
  })
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url)
}

function KnowledgeCenter() {
  const [preferences] = useState(readPreferences)
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let active = true
    void fetch('/kunpeng-knowledge.json')
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json() as KnowledgePayload
      })
      .then(payload => {
        if (!active) return
        setEntries(payload.entries)
        setSelectedId(payload.entries[0]?.id)
      })
      .catch(error => { if (active) setLoadError(String(error)) })
    return () => { active = false }
  }, [])

  const visibleEntries = useMemo(() => preferences.includeDraftKnowledge ? entries : entries.filter(entry => entry.status === 'reviewed'), [entries, preferences.includeDraftKnowledge])
  const categories = useMemo(() => ['全部', ...new Set(visibleEntries.map(entry => entry.category))], [visibleEntries])
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('zh-CN')
    return visibleEntries.filter(entry => {
      if (category !== '全部' && entry.category !== category) return false
      if (term === '') return true
      return `${entry.title}\n${entry.excerpt}\n${entry.content}`.toLocaleLowerCase('zh-CN').includes(term)
    })
  }, [visibleEntries, query, category])
  const selected = entries.find(entry => entry.id === selectedId) ?? filtered[0]

  return (
    <div className={css.knowledgeLayout}>
      <aside className={css.knowledgeList}>
        <div className={css.searchRow}>
          <input value={query} onChange={event => { setQuery(event.currentTarget.value) }} placeholder="搜索标题、正文或流程…" />
          <select value={category} onChange={event => { setCategory(event.currentTarget.value) }}>
            {categories.map(value => <option key={value}>{value}</option>)}
          </select>
        </div>
        <div className={css.resultCount}>{loadError === undefined ? `已载入 ${entries.length} 条 · 当前 ${filtered.length} 条${preferences.includeDraftKnowledge ? '' : '（仅 reviewed）'}` : `载入失败：${loadError}`}</div>
        <div className={css.resultList}>
          {filtered.map(entry => (
            <button key={entry.id} type="button" className={entry.id === selected?.id ? css.resultActive : css.resultItem} onClick={() => { setSelectedId(entry.id) }}>
              <strong>{entry.title}</strong>
              <span>{entry.category} · {entry.status} · 证据 {entry.evidenceLevel}</span>
              <small>{entry.excerpt || '暂无摘要'}</small>
            </button>
          ))}
        </div>
      </aside>
      <article className={css.knowledgeArticle}>
        {selected === undefined
          ? <div className={css.emptyState}>没有匹配的知识条目</div>
          : (
            <>
              <header>
                <div className={css.badges}><span>{selected.category}</span><span>{selected.status}</span><span>证据 {selected.evidenceLevel}</span><span>{selected.sensitivity}</span></div>
                <h3>{selected.title}</h3>
                <p>来源：{selected.source} · {selected.sourceLocator} · <code>{selected.file}</code></p>
              </header>
              <pre>{selected.content}</pre>
            </>
          )}
      </article>
    </div>
  )
}

function KnowledgeIntake() {
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('')
  const [locator, setLocator] = useState('')
  const [submitter, setSubmitter] = useState('')
  const [category, setCategory] = useState('其他')
  const [facts, setFacts] = useState('')
  const [copied, setCopied] = useState(false)
  const [submissionState, setSubmissionState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const today = new Date().toISOString().slice(0, 10)
  const slug = title.trim() || '待填写：知识条目标题'
  const markdown = `---\nknowledge_id: KP-${today.replaceAll('-', '')}-NNN\ntitle: "${slug.replaceAll('"', '\\"')}"\ncategory: "${category}"\nstatus: draft\nevidence_level: B\nsensitivity: internal\nsource_type: "待确认"\nsource_title: "${source.replaceAll('"', '\\"')}"\nsource_date: ${today}\nsource_locator: "${locator.replaceAll('"', '\\"')}"\nsubmitted_by: "${submitter.replaceAll('"', '\\"')}"\nsubmitted_at: ${today}\nreviewer: "待确认"\nreviewed_at: "待确认"\nnext_review_at: "待确认"\ntags: []\n---\n\n# ${slug}\n\n## 一句话摘要\n\n待填写。\n\n## 适用范围\n\n- 适用对象：待填写\n- 不适用/限制条件：待填写\n\n## 可核验事实\n\n${facts || '- 待填写，并标注原文页码/章节。'}\n\n## 意见、解释与推断\n\n- 专家意见：待填写\n- 整理者解释：待填写\n- 对大黄鱼的推断（待验证）：待填写\n\n## 风险与待确认项\n\n- [ ] 已核对原文与定位\n- [ ] 已确认敏感等级\n- [ ] 已指定复审人与复审日期\n`
  const ready = title.trim() !== '' && source.trim() !== '' && locator.trim() !== '' && submitter.trim() !== ''
  const control = (window as unknown as { dshControl?: ControlBridge }).dshControl

  return (
    <div className={css.formLayout}>
      <section className={css.formCard}>
        <h3>知识登记</h3>
        <p>新知识默认为 draft，经负责人核对原文后才能改为 reviewed。</p>
        <label>标题<input value={title} onChange={event => { setTitle(event.currentTarget.value) }} /></label>
        <label>分类<select value={category} onChange={event => { setCategory(event.currentTarget.value) }}><option>实验技术</option><option>养殖管理</option><option>育种选择</option><option>数据治理</option><option>新品种申报</option><option>科研办公</option><option>其他</option></select></label>
        <label>原始来源<input value={source} onChange={event => { setSource(event.currentTarget.value) }} placeholder="文件名、论文或会议名称" /></label>
        <label>原文定位<input value={locator} onChange={event => { setLocator(event.currentTarget.value) }} placeholder="PDF p.5-8 / 第 3 节 / 表 2" /></label>
        <label>登记人<input value={submitter} onChange={event => { setSubmitter(event.currentTarget.value) }} /></label>
        <label>可核验事实<textarea rows={5} value={facts} onChange={event => { setFacts(event.currentTarget.value) }} placeholder="每条后写原文定位" /></label>
      </section>
      <section className={css.previewCard}>
        <div className={css.previewHeader}><strong>Markdown 登记稿</strong><div className={css.headerActions}><button type="button" disabled={!ready} onClick={() => { void navigator.clipboard.writeText(markdown).then(() => { setCopied(true) }) }}>{copied ? '已复制' : '复制模板'}</button><button type="button" disabled={!ready || control === undefined || submissionState === 'sending'} onClick={() => { setSubmissionState('sending'); void control?.submitKnowledge({ title: title.trim(), content: markdown, sourceLocator: `${source.trim()} · ${locator.trim()}` }).then(() => { setSubmissionState('sent') }).catch(() => { setSubmissionState('error') }) }}>{submissionState === 'sending' ? '提交中…' : submissionState === 'sent' ? '已进入审核队列' : '提交审核'}</button></div></div>
        {!ready && <div className={css.formWarning}>请先填完标题、来源、原文定位和登记人。</div>}
        {control === undefined && <div className={css.formWarning}>需在已登录的鲲鹏桌面应用中提交中心审核。</div>}
        {submissionState === 'error' && <div className={css.formWarning}>提交失败，请检查管理中心连接或账号状态。</div>}
        <textarea readOnly value={markdown} />
      </section>
    </div>
  )
}

function FeedbackWorkbench() {
  const [category, setCategory] = useState('功能建议'); const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const control = (window as unknown as { dshControl?: ControlBridge }).dshControl
  const ready = title.trim() !== '' && body.trim() !== '' && control !== undefined
  const submit = () => {
    if (!ready || control === undefined) return
    setState('sending'); void control.submitFeedback({ category, title: title.trim(), body: body.trim() }).then(() => { setState('sent'); setTitle(''); setBody('') }).catch(() => { setState('error') })
  }
  return <div className={css.formLayout}><section className={css.formCard}><h3>信息反馈</h3><p>问题、建议和知识纠错会进入中心处理队列，管理员与审核员可以查看和回复。</p><label>类别<select value={category} onChange={event => { setCategory(event.currentTarget.value) }}><option>功能建议</option><option>问题报告</option><option>知识纠错</option><option>其他</option></select></label><label>标题<input value={title} onChange={event => { setTitle(event.currentTarget.value) }} /></label><label>详细内容<textarea rows={8} value={body} onChange={event => { setBody(event.currentTarget.value) }} placeholder="请写清操作步骤、预期结果和实际现象；不要粘贴密码或 API Key。" /></label><button className={css.primaryAction} type="button" disabled={!ready || state === 'sending'} onClick={submit}>{state === 'sending' ? '提交中…' : '提交反馈'}</button></section><section className={css.previewCard}><div className={css.feedbackState}><strong>{state === 'sent' ? '反馈已进入处理队列' : '提交后会发生什么？'}</strong><p>{state === 'sent' ? '反馈已经绑定当前登录账号。审核员处理后会在管理中心保留回复和状态记录。' : '系统记录提交人、时间、类别和内容；审核员可标记处理中或已解决，所有关键操作进入审计日志。'}</p>{control === undefined && <div className={css.formWarning}>需在已登录的桌面应用中提交。</div>}{state === 'error' && <div className={css.formWarning}>提交失败，请检查管理中心连接。</div>}</div></section></div>
}

function LiteratureWorkbench({ onQuickStart }: { onQuickStart?: ((prompt: string) => void) | undefined }) {
  const [records, setRecords] = useState<EvidenceRecord[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(EVIDENCE_STORAGE_KEY) ?? '[]') as unknown; return Array.isArray(value) ? value as EvidenceRecord[] : [] } catch { return [] }
  })
  const [topic, setTopic] = useState(''); const [start, setStart] = useState(''); const [end, setEnd] = useState('')
  const [title, setTitle] = useState(''); const [doi, setDoi] = useState(''); const [conclusion, setConclusion] = useState(''); const [level, setLevel] = useState<EvidenceRecord['level']>('B')
  const doiValid = doi === '' || /^10\.\d{4,9}\/\S+$/i.test(doi.trim())
  const save = (next: EvidenceRecord[]) => { setRecords(next); localStorage.setItem(EVIDENCE_STORAGE_KEY, JSON.stringify(next)) }
  const add = () => {
    if (title.trim() === '' || conclusion.trim() === '' || !doiValid) return
    save([...records, { id: crypto.randomUUID(), title: title.trim(), doi: doi.trim(), conclusion: conclusion.trim(), level, status: '待核验' }]); setTitle(''); setDoi(''); setConclusion('')
  }
  const prompt = `请使用 kunpeng-literature skill 建立文献证据检索任务。主题：${topic}；时间范围：${start || '未限定'} 至 ${end || '未限定'}。现有证据台账 ${records.length} 条，其中已核验 ${records.filter(item => item.status === '已核验').length} 条。检索后逐条核对题目、作者、期刊、正式在线日期、DOI 和原文证据，并与现有台账去重；严格区分论文原始结论、方法迁移解释和对大黄鱼的推断。`
  return (
    <div className={css.moduleLayout}>
      <section className={css.controlPanel}>
        <h3>文献证据项目</h3><p>建立检索范围和可核验台账，不把搜索摘要当作原文证据。</p>
        <label>研究主题<input value={topic} onChange={event => { setTopic(event.currentTarget.value) }} placeholder="例：大黄鱼抗病性全基因组选择" /></label>
        <div className={css.inlineFields}><label>起始日期<input type="date" value={start} onChange={event => { setStart(event.currentTarget.value) }} /></label><label>结束日期<input type="date" value={end} onChange={event => { setEnd(event.currentTarget.value) }} /></label></div>
        <div className={css.sectionTitle}>登记一条候选证据</div>
        <label>题目<input value={title} onChange={event => { setTitle(event.currentTarget.value) }} /></label>
        <label>DOI（可暂空）<input value={doi} onChange={event => { setDoi(event.currentTarget.value) }} aria-invalid={!doiValid} placeholder="10.xxxx/xxxxx" /></label>
        {!doiValid && <div className={css.formWarning}>DOI 格式不正确。</div>}
        <label>原文结论/待核验主张<textarea rows={3} value={conclusion} onChange={event => { setConclusion(event.currentTarget.value) }} /></label>
        <div className={css.inlineAction}><select value={level} onChange={event => { setLevel(event.currentTarget.value as EvidenceRecord['level']) }}><option>A</option><option>B</option><option>C</option></select><button type="button" onClick={add} disabled={title.trim() === '' || conclusion.trim() === '' || !doiValid}>加入台账</button></div>
      </section>
      <section className={css.workPanel}>
        <div className={css.panelHeader}><div><strong>证据台账</strong><span>{records.length} 条 · 已核验 {records.filter(item => item.status === '已核验').length} 条</span></div><button type="button" onClick={() => { downloadJson('kunpeng-evidence-ledger.json', records) }} disabled={records.length === 0}>导出 JSON</button></div>
        <div className={css.scrollList}>{records.length === 0 && <div className={css.emptyState}>先登记待核验文献，或直接创建检索任务。</div>}{records.map(item => <div className={css.recordRow} key={item.id}><div><strong>{item.title}</strong><span>证据 {item.level} · {item.doi || 'DOI 待补'} · {item.status}</span><small>{item.conclusion}</small></div><select value={item.status} onChange={event => { save(records.map(record => record.id === item.id ? { ...record, status: event.currentTarget.value as EvidenceRecord['status'] } : record)) }}><option>待核验</option><option>已核验</option></select><button type="button" onClick={() => { save(records.filter(record => record.id !== item.id)) }}>删除</button></div>)}</div>
        <button className={css.primaryAction} type="button" disabled={topic.trim() === ''} onClick={() => { onQuickStart?.(prompt) }}>启动检索与核验</button>
      </section>
    </div>
  )
}

type OmicsWorkflow = 'RNA-seq' | 'WGCNA' | 'GWAS'

function OmicsWorkbench({ onQuickStart }: { onQuickStart?: ((prompt: string) => void) | undefined }) {
  const [workflow, setWorkflow] = useState<OmicsWorkflow>('RNA-seq'); const [project, setProject] = useState(''); const [species, setSpecies] = useState('大黄鱼 Larimichthys crocea'); const [design, setDesign] = useState('')
  const [primary, setPrimary] = useState<TableAudit | undefined>(); const [secondary, setSecondary] = useState<TableAudit | undefined>(); const [reference, setReference] = useState<File | undefined>(); const [annotation, setAnnotation] = useState<File | undefined>()
  useEffect(() => { setPrimary(undefined); setSecondary(undefined); setReference(undefined); setAnnotation(undefined) }, [workflow])
  const required = workflow === 'RNA-seq' ? ['sample_id', 'group', 'read1'] : workflow === 'WGCNA' ? [] : ['sample_id']
  const missing = primary === undefined ? required : required.filter(column => !primary.columns.includes(column))
  const commonPass = project.trim() !== '' && species.trim() !== '' && design.trim() !== '' && primary !== undefined && primary.duplicates.length === 0 && primary.emptyIds === 0 && primary.inconsistentRows === 0 && missing.length === 0
  const extraPass = workflow === 'RNA-seq' ? reference !== undefined && annotation !== undefined : secondary !== undefined && secondary.duplicates.length === 0 && secondary.emptyIds === 0 && secondary.inconsistentRows === 0
  const labels = workflow === 'RNA-seq' ? ['样本表 CSV/TSV', '参考基因组 FASTA', '基因注释 GTF/GFF3'] : workflow === 'WGCNA' ? ['表达矩阵（首列 gene_id）', '性状表（首列 sample_id）'] : ['表型表（含 sample_id）', '基因型样本清单（首列 sample_id）']
  const skill = workflow === 'RNA-seq' ? 'kunpeng-rnaseq' : workflow === 'WGCNA' ? 'kunpeng-wgcna' : 'kunpeng-gwas'
  const prompt = `请使用 ${skill} skill 继续这个已经过桌面预检的项目。项目：${project}；物种：${species}；分析：${workflow}；设计/目标：${design}；主表：${primary?.name}，${primary?.rows ?? 0} 行；辅助表：${secondary?.name ?? '不适用'}。先读取真实文件并在项目目录运行该 skill 的 scripts/preflight.py；桌面预检不能替代命令行预检。只有预检通过并经我确认后才运行计算，逐阶段保存日志、参数、版本和结果清单。`
  return (
    <div className={css.moduleLayout}>
      <section className={css.controlPanel}>
        <h3>组学分析项目</h3><p>选择专项流程，系统会按不同输入契约检查；计算在 Linux/HPC、WSL2 或已验证环境执行。</p>
        <div className={css.workflowPicker}>{(['RNA-seq', 'WGCNA', 'GWAS'] as OmicsWorkflow[]).map(value => <button type="button" data-active={workflow === value} onClick={() => { setWorkflow(value) }} key={value}>{value}</button>)}</div>
        <label>项目名称<input value={project} onChange={event => { setProject(event.currentTarget.value) }} /></label>
        <label>物种与参考版本<input value={species} onChange={event => { setSpecies(event.currentTarget.value) }} /></label>
        <label>实验设计/目标性状<textarea rows={3} value={design} onChange={event => { setDesign(event.currentTarget.value) }} placeholder="分组、批次、比较或目标性状与协变量" /></label>
        <label className={css.fileField}>{labels[0]}<input type="file" accept=".csv,.tsv,.txt" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void parseTableAudit(file).then(setPrimary) }} /></label>
        {workflow === 'RNA-seq' ? <><label className={css.fileField}>{labels[1]}<input type="file" accept=".fa,.fasta,.fna,.gz" onChange={event => { setReference(event.currentTarget.files?.[0]) }} /></label><label className={css.fileField}>{labels[2]}<input type="file" accept=".gtf,.gff,.gff3,.gz" onChange={event => { setAnnotation(event.currentTarget.files?.[0]) }} /></label></> : <label className={css.fileField}>{labels[1]}<input type="file" accept=".csv,.tsv,.txt,.fam" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void parseTableAudit(file).then(setSecondary) }} /></label>}
      </section>
      <section className={css.workPanel}>
        <div className={css.gateScore}><strong>{[project.trim() !== '', species.trim() !== '', design.trim() !== '', primary !== undefined, commonPass, extraPass].filter(Boolean).length}/6</strong><span>项项目门禁通过</span></div>
        {[['项目信息完整', project.trim() !== '' && species.trim() !== '' && design.trim() !== ''], ['主数据表已读取', primary !== undefined], ['主表 ID/行结构合格', commonPass], [workflow === 'RNA-seq' ? '参考与注释已选择' : '辅助数据表合格', extraPass]].map(([label, pass]) => <div className={pass ? css.gatePass : css.gatePending} key={String(label)}><span>{pass ? '✓' : '·'}</span>{label}</div>)}
        {primary && <div className={css.auditCard}><strong>{primary.name}</strong><span>{primary.rows} 行 · {primary.columns.length} 列 · 空单元格 {primary.emptyCells}</span>{missing.length > 0 && <small>缺少列：{missing.join('、')}</small>}</div>}
        {secondary && <div className={css.auditCard}><strong>{secondary.name}</strong><span>{secondary.rows} 行 · {secondary.columns.length} 列 · 重复 ID {secondary.duplicates.length}</span></div>}
        <div className={css.scopeNote}>桌面端完成登记与轻量预检；真正的流程由 <code>{skill}</code> 在工作目录执行，并以退出码、日志和产物验收。</div>
        <button className={css.primaryAction} type="button" disabled={!commonPass || !extraPass} onClick={() => { onQuickStart?.(prompt) }}>进入专项 skill 并执行深度预检</button>
      </section>
    </div>
  )
}

function DataGovernanceWorkbench({ onQuickStart }: { onQuickStart?: ((prompt: string) => void) | undefined }) {
  const [project, setProject] = useState(''); const [files, setFiles] = useState<TableAudit[]>([])
  const totalRows = files.reduce((sum, file) => sum + file.rows, 0); const issues = files.reduce((sum, file) => sum + file.emptyIds + file.duplicates.length + file.inconsistentRows, 0)
  const report = { project, created_at: new Date().toISOString(), files }
  return <div className={css.moduleLayout}><section className={css.controlPanel}><h3>育种数据审计</h3><p>在正式入库前检查表结构、首列个体 ID、重复、缺失与行宽。</p><label>数据项目<input value={project} onChange={event => { setProject(event.currentTarget.value) }} /></label><label className={css.fileField}>选择一个或多个 CSV/TSV<input multiple type="file" accept=".csv,.tsv,.txt" onChange={event => { const selected = [...(event.currentTarget.files ?? [])]; void Promise.all(selected.map(parseTableAudit)).then(setFiles) }} /></label><div className={css.scopeNote}>更复杂的单位、取值域、亲缘/样本错配和跨表 ID 对齐会在 kunpeng-governance skill 中继续检查。</div></section><section className={css.workPanel}><div className={css.metricGrid}><div><strong>{files.length}</strong><span>文件</span></div><div><strong>{totalRows}</strong><span>数据行</span></div><div><strong>{issues}</strong><span>结构问题</span></div></div><div className={css.scrollList}>{files.map(file => <div className={css.auditCard} key={file.name}><strong>{file.name}</strong><span>{file.rows} 行 · {file.columns.length} 列 · 空 ID {file.emptyIds} · 重复 ID {file.duplicates.length}</span><small>空单元格 {file.emptyCells} · 行宽异常 {file.inconsistentRows}</small></div>)}</div><div className={css.inlineAction}><button type="button" disabled={files.length === 0} onClick={() => { downloadJson('kunpeng-data-audit.json', report) }}>导出审计报告</button><button type="button" disabled={project.trim() === '' || files.length === 0} onClick={() => { onQuickStart?.(`请使用 kunpeng-governance skill 深度审计项目“${project}”。桌面初检共 ${files.length} 个文件、${totalRows} 行，发现 ${issues} 个 ID/行结构问题。请读取真实文件，建立跨表 ID 对齐、字段字典、单位/取值域检查和修复清单；未经负责人审核不得覆盖原数据或正式入库。`) }}>启动深度治理</button></div></section></div>
}

function WritingWorkbench({ onQuickStart }: { onQuickStart?: ((prompt: string) => void) | undefined }) {
  const [kind, setKind] = useState('论文正文'); const [audience, setAudience] = useState(''); const [goal, setGoal] = useState(''); const [claims, setClaims] = useState(''); const [files, setFiles] = useState<File[]>([])
  const [guideUrl, setGuideUrl] = useState('')
  const [submission, setSubmission] = useState<Record<string, boolean>>({ manuscript: false, cover: false, highlights: false, credit: false, conflict: false, ethics: false, data: false, response: false })
  const isSubmission = kind === 'SCI 投稿包' || kind === '审稿回复'
  const items = [['manuscript', 'Manuscript', true], ['cover', 'Cover Letter', true], ['highlights', 'Highlights', false], ['credit', 'CRediT Author Statement', true], ['conflict', 'Competing Interests', true], ['ethics', 'Ethics / permits', true], ['data', 'Data / Code availability', true], ['response', 'Response to Reviewers', kind === '审稿回复']] as const
  const ready = audience.trim() !== '' && goal.trim() !== '' && files.length > 0 && (!isSubmission || guideUrl.trim() !== '')
  const brief = `文种：${kind}\n受众/目标期刊：${audience || '待填写'}\n期刊指南：${guideUrl || '待填写'}\n交付目标：${goal || '待填写'}\n必须覆盖：${claims || '待填写'}\n材料：\n${files.map(file => `- ${file.name} (${Math.ceil(file.size / 1024)} KB)`).join('\n') || '- 尚未选择'}${isSubmission ? `\n投稿包状态：\n${items.map(([id, label, required]) => `- [${submission[id] ? 'x' : ' '}] ${label}${required ? '（必查）' : '（按期刊）'}`).join('\n')}` : ''}`
  return <div className={css.moduleLayout}><section className={css.controlPanel}><h3>科研写作项目</h3><p>先建立任务书和真实材料清单；SCI 投稿先核对目标期刊最新版要求。</p><label>文种<select value={kind} onChange={event => { setKind(event.currentTarget.value) }}><option>论文正文</option><option>SCI 投稿包</option><option>项目申请</option><option>科研报告</option><option>汇报材料</option><option>审稿回复</option></select></label><label>受众/目标期刊<input value={audience} onChange={event => { setAudience(event.currentTarget.value) }} /></label>{isSubmission && <label>Guide for Authors 链接<input value={guideUrl} onChange={event => { setGuideUrl(event.currentTarget.value) }} placeholder="必须核验最新版期刊要求" /></label>}<label>本次交付目标<textarea rows={3} value={goal} onChange={event => { setGoal(event.currentTarget.value) }} /></label><label>必须覆盖的事实或观点<textarea rows={3} value={claims} onChange={event => { setClaims(event.currentTarget.value) }} /></label><label className={css.fileField}>真实材料（可多选）<input multiple type="file" onChange={event => { setFiles([...(event.currentTarget.files ?? [])]) }} /></label></section><section className={css.workPanel}><div className={css.panelHeader}><div><strong>{isSubmission ? '投稿包门禁' : '写作任务书'}</strong><span>{files.length} 份材料</span></div><button type="button" onClick={() => { void navigator.clipboard.writeText(brief) }}>复制任务书</button></div>{isSubmission ? <div className={css.checklist}>{items.map(([id, label, required]) => <label key={id}><input type="checkbox" checked={submission[id]} onChange={event => { setSubmission({ ...submission, [id]: event.currentTarget.checked }) }} /><span><strong>{label}</strong><small>{required ? '必查；是否单独提交以期刊指南为准' : '仅在目标期刊要求时提交'}</small></span></label>)}</div> : <pre className={css.briefPreview}>{brief}</pre>}<div className={css.scopeNote}>Highlights 字符数、图像尺寸和排版不采用固定通用值；作者贡献、利益冲突、伦理和一稿一投声明必须由作者确认。</div><button className={css.primaryAction} type="button" disabled={!ready} onClick={() => { onQuickStart?.(`请使用 kunpeng-writing skill，并读取 references/submission-workflow.md，执行以下任务。\n${brief}\n先逐份读取真实材料并建立事实/证据清单；核验目标期刊指南后输出缺失项和工作顺序。若生成 DOCX/PDF，必须渲染并逐页检查。`) }}>{isSubmission ? '核验期刊要求并生成投稿包' : '读取材料并开始写作'}</button></section></div>
}

function DailyDesk({ onQuickStart }: { onQuickStart?: ((prompt: string) => void) | undefined }) {
  const [preferences] = useState(readPreferences)
  const [tasks, setTasks] = useState<ResearchTask[]>(() => preferences.persistDailyTasks ? readTasks() : [])
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState(preferences.defaultOwner)
  const [due, setDue] = useState('')
  const [mode, setMode] = useState<'tasks' | 'radar'>('tasks')
  const [frequency, setFrequency] = useState(() => localStorage.getItem(RADAR_FREQUENCY_KEY) ?? 'daily')
  const [radar, setRadar] = useState<RadarPayload>({ updatedAt: null, articles: [], error: null })
  const [radarLoading, setRadarLoading] = useState(false)
  const radarBridge = (window as unknown as { dshResearchRadar?: ResearchRadarBridge }).dshResearchRadar
  const frequencyMs = frequency === 'daily' ? 86400000 : frequency === '3days' ? 3 * 86400000 : 7 * 86400000
  const radarDue = radar.updatedAt === null || Date.now() - new Date(radar.updatedAt).getTime() >= frequencyMs
  const refreshRadar = () => {
    if (radarBridge === undefined || radarLoading) return
    setRadarLoading(true)
    void radarBridge.refresh().then(setRadar).finally(() => { setRadarLoading(false) })
  }
  useEffect(() => {
    if (radarBridge === undefined) return
    let active = true
    void radarBridge.get().then(payload => {
      if (!active) return
      setRadar(payload)
      const basis = payload.failedAt ?? payload.updatedAt
      if (basis === null || basis === undefined || Date.now() - new Date(basis).getTime() >= frequencyMs) {
        setRadarLoading(true); void radarBridge.refresh().then(value => { if (active) setRadar(value) }).finally(() => { if (active) setRadarLoading(false) })
      }
    })
    const timer = window.setInterval(() => {
      if (!active) return
      void radarBridge.get().then(payload => {
        const basis = payload.failedAt ?? payload.updatedAt
        if (basis === null || basis === undefined || Date.now() - new Date(basis).getTime() >= frequencyMs) refreshRadar()
      })
    }, 60000)
    return () => { active = false; window.clearInterval(timer) }
  // Frequency changes intentionally reschedule the journal refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency])
  const save = (next: ResearchTask[]) => { setTasks(next); if (preferences.persistDailyTasks) localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(next)) }
  const add = () => {
    if (title.trim() === '' || owner.trim() === '' || due === '') return
    save([...tasks, { id: crypto.randomUUID(), title: title.trim(), owner: owner.trim(), due, status: 'todo' }])
    setTitle(''); setDue('')
  }
  const counts = { todo: tasks.filter(task => task.status === 'todo').length, doing: tasks.filter(task => task.status === 'doing').length, done: tasks.filter(task => task.status === 'done').length }
  return (
    <div className={css.dailyLayout}>
      <section className={css.taskComposer}>
        <div className={css.workflowPicker}><button type="button" data-active={mode === 'tasks'} onClick={() => { setMode('tasks') }}>任务台</button><button type="button" data-active={mode === 'radar'} onClick={() => { setMode('radar') }}>科研进展</button></div>
        {mode === 'tasks' ? <><h3>今日科研任务</h3>
        <p>{preferences.persistDailyTasks ? '任务保存在本机，不会自动上传。' : '本机保存已关闭，任务只保留到当前窗口关闭。'}</p>
        <input value={title} onChange={event => { setTitle(event.currentTarget.value) }} placeholder="要交付的具体结果" />
        <div className={css.inlineFields}><input value={owner} onChange={event => { setOwner(event.currentTarget.value) }} placeholder="负责人" /><input type="date" value={due} onChange={event => { setDue(event.currentTarget.value) }} /></div>
        <button type="button" onClick={add} disabled={title.trim() === '' || owner.trim() === '' || due === ''}>添加任务</button>
        <div className={css.taskStats}><span>待办 {counts.todo}</span><span>进行中 {counts.doing}</span><span>已完成 {counts.done}</span></div></> : <><h3>科研进展订阅</h3><p>追踪 Aquaculture、Marine Life Science &amp; Technology、Genetics Selection Evolution。题录和摘要来自 Crossref，结论需回原文核验。</p><label>更新频率<select value={frequency} onChange={event => { const value = event.currentTarget.value; setFrequency(value); localStorage.setItem(RADAR_FREQUENCY_KEY, value) }}><option value="daily">每天</option><option value="3days">每 3 天</option><option value="weekly">每周</option></select></label><button type="button" disabled={radarLoading || radarBridge === undefined} onClick={refreshRadar}>{radarLoading ? '正在更新…' : '立即更新'}</button><div className={css.scopeNote}>{radarBridge === undefined ? '当前不是桌面运行环境，无法后台更新。' : radar.error ? `更新失败：${radar.error}` : radar.updatedAt ? `上次更新：${new Date(radar.updatedAt).toLocaleString('zh-CN')} · ${radarDue ? '已到更新周期' : '未到更新周期'}` : '尚未更新'}</div></>}
      </section>
      <section className={css.taskList}>
        {mode === 'tasks' ? <>{tasks.length === 0 && <div className={css.emptyState}>还没有任务。先登记今天要交付的结果。</div>}
        {tasks.map(task => (
          <div key={task.id} className={css.taskRow}>
            <div><strong>{task.title}</strong><span>{task.owner} · {task.due}</span></div>
            <select value={task.status} onChange={event => { save(tasks.map(item => item.id === task.id ? { ...item, status: event.currentTarget.value as ResearchTask['status'] } : item)) }}><option value="todo">待办</option><option value="doing">进行中</option><option value="done">已完成</option></select>
            <button type="button" className={css.deleteButton} onClick={() => { save(tasks.filter(item => item.id !== task.id)) }}>删除</button>
          </div>
        ))}</> : <><div className={css.panelHeader}><div><strong>最近文章</strong><span>{radar.articles.length} 篇 · {radar.evidenceLevel ?? '仅基于题录/摘要'}</span></div><button type="button" disabled={radar.articles.length === 0} onClick={() => { const list = radar.articles.slice(0, 12).map(item => `${item.journal} | ${item.date ?? '日期待核验'} | ${item.title} | ${item.doi}`).join('\n'); onQuickStart?.(`请使用 kunpeng-literature skill 核验并生成本期科研进展。候选文章如下：\n${list}\n逐条核验正式在线日期、作者、DOI 和原文/摘要证据；去重后用中文总结，并区分论文原始结论、方法迁移解释和对大黄鱼智慧选育的推断。若只能读取摘要，明确标注“仅基于摘要”。`) }}>生成中文简报</button></div><div className={css.scrollList}>{radar.articles.length === 0 && <div className={css.emptyState}>{radar.error ? '更新失败，不等同于没有新文章。' : '暂无缓存文章，点击“立即更新”。'}</div>}{radar.articles.map(article => <a className={css.articleRow} href={article.url} target="_blank" rel="noreferrer" key={article.doi || `${article.journal}:${article.title}`}><strong>{article.title}</strong><span>{article.journal} · {article.date ?? '日期待核验'} · {article.doi || 'DOI 待补'}</span><small>{article.abstract || 'Crossref 未提供摘要；需打开原文核验。'}</small></a>)}</div></>}
      </section>
    </div>
  )
}

function GsWorkbench({ onQuickStart }: { onQuickStart?: ((prompt: string) => void) | undefined }) {
  const [preferences] = useState(readPreferences)
  const [project, setProject] = useState('')
  const [trait, setTrait] = useState('')
  const [model, setModel] = useState(preferences.gsModel)
  const [phenotype, setPhenotype] = useState<IdManifest | undefined>(undefined)
  const [genotype, setGenotype] = useState<IdManifest | undefined>(undefined)
  const alignment = useMemo(() => {
    if (phenotype === undefined || genotype === undefined) return { shared: [] as string[], phenotypeOnly: 0, genotypeOnly: 0 }
    const phenotypeIds = new Set(phenotype.ids)
    const genotypeIds = new Set(genotype.ids)
    const shared = [...phenotypeIds].filter(id => genotypeIds.has(id))
    return {
      shared,
      phenotypeOnly: [...phenotypeIds].filter(id => !genotypeIds.has(id)).length,
      genotypeOnly: [...genotypeIds].filter(id => !phenotypeIds.has(id)).length,
    }
  }, [phenotype, genotype])
  const gates = [
    { label: '项目名称已登记', pass: project.trim() !== '' },
    { label: '目标性状与单位已定义', pass: trait.trim() !== '' },
    { label: '表型样本清单无空 ID/重复 ID', pass: phenotype !== undefined && phenotype.emptyIds === 0 && phenotype.duplicates.length === 0 },
    { label: '基因型样本清单无空 ID/重复 ID', pass: genotype !== undefined && genotype.emptyIds === 0 && genotype.duplicates.length === 0 },
    { label: '表型与基因型存在可对齐个体', pass: alignment.shared.length > 0 },
  ]
  const passed = gates.filter(gate => gate.pass).length
  const prompt = `请基于已完成的 GS 输入门禁进行下一步分析规划。项目：${project}；目标性状：${trait}；准入模型：${model}；表型记录 ${phenotype?.rows ?? 0} 条；基因型样本 ${genotype?.rows ?? 0} 条；可对齐个体 ${alignment.shared.length} 个。先输出数据字典、质控规则、防泄漏验证分区和人工审核点，不虚构分析结果。`
  return (
    <div className={css.gsLayout}>
      <section className={css.gsInputs}>
        <h3>全基因组选育·输入门禁</h3>
        <p>本页做样本对齐和完整性校验，不会把“通过门禁”宣称为已完成 GEBV 计算。</p>
        <label>项目名称<input value={project} onChange={event => { setProject(event.currentTarget.value) }} placeholder="例：宁抗1号 F4 候选群体" /></label>
        <label>目标性状与单位<input value={trait} onChange={event => { setTrait(event.currentTarget.value) }} placeholder="例：攻毒后存活（0/1）" /></label>
        <label>准入模型<select value={model} onChange={event => { setModel(event.currentTarget.value as KunpengPreferences['gsModel']) }}><option>GBLUP</option><option>ssGBLUP</option></select></label>
        <label className={css.fileField}>表型清单 CSV/TSV（首列为个体 ID）<input type="file" accept=".csv,.tsv,.txt" onChange={event => { const file = event.currentTarget.files?.[0]; if (file !== undefined) void parseManifest(file).then(setPhenotype) }} /></label>
        <label className={css.fileField}>基因型样本清单 CSV/TSV（首列为个体 ID）<input type="file" accept=".csv,.tsv,.txt" onChange={event => { const file = event.currentTarget.files?.[0]; if (file !== undefined) void parseManifest(file).then(setGenotype) }} /></label>
      </section>
      <section className={css.gatePanel}>
        <div className={css.gateScore}><strong>{passed}/{gates.length}</strong><span>项门禁通过</span></div>
        {gates.map(gate => <div key={gate.label} className={gate.pass ? css.gatePass : css.gatePending}><span>{gate.pass ? '✓' : '·'}</span>{gate.label}</div>)}
        {phenotype !== undefined && <div className={css.fileResult}><strong>{phenotype.name}</strong><span>{phenotype.rows} 行 · 空 ID {phenotype.emptyIds} · 重复 {phenotype.duplicates.length}</span></div>}
        {genotype !== undefined && <div className={css.fileResult}><strong>{genotype.name}</strong><span>{genotype.rows} 行 · 空 ID {genotype.emptyIds} · 重复 {genotype.duplicates.length}</span></div>}
        {phenotype !== undefined && genotype !== undefined && <div className={css.matchResult}>可对齐个体 <strong>{alignment.shared.length}</strong> · 仅表型 {alignment.phenotypeOnly} · 仅基因型 {alignment.genotypeOnly}</div>}
        <button type="button" disabled={passed !== gates.length} onClick={() => { onQuickStart?.(prompt) }}>将已校验项目送入分析对话</button>
      </section>
    </div>
  )
}

export function KunpengWorkbench({ initialView, onClose, onQuickStart }: { initialView: WorkbenchView; onClose: () => void; onQuickStart?: ((prompt: string) => void) | undefined }) {
  const [view, setView] = useState<WorkbenchView>(initialView)
  return (
    <div className={css.backdrop} role="dialog" aria-modal="true" aria-label="鲲鹏科研工作台">
      <div className={css.shell}>
        <header className={css.topbar}>
          <div><img src="/kunpeng-logo.png" alt="" /><div><strong>鲲鹏科研工作台</strong><span>本地优先 · 来源可追溯 · 人工复核</span></div></div>
          <button type="button" aria-label="关闭鲲鹏科研工作台" onClick={onClose}>×</button>
        </header>
        <nav className={css.tabs}>
          <button type="button" data-active={view === 'literature'} onClick={() => { setView('literature') }}>文献证据</button>
          <button type="button" data-active={view === 'daily'} onClick={() => { setView('daily') }}>每日科研</button>
          <button type="button" data-active={view === 'omics'} onClick={() => { setView('omics') }}>组学分析</button>
          <button type="button" data-active={view === 'data'} onClick={() => { setView('data') }}>数据治理</button>
          <button type="button" data-active={view === 'gs'} onClick={() => { setView('gs') }}>全基因组选育</button>
          <button type="button" data-active={view === 'writing'} onClick={() => { setView('writing') }}>科研写作</button>
          <span className={css.tabDivider} />
          <button type="button" data-active={view === 'knowledge'} onClick={() => { setView('knowledge') }}>知识中心</button>
          <button type="button" data-active={view === 'intake'} onClick={() => { setView('intake') }}>知识登记</button>
          <button type="button" data-active={view === 'feedback'} onClick={() => { setView('feedback') }}>信息反馈</button>
        </nav>
        <main className={css.content}>
          {view === 'literature' && <LiteratureWorkbench onQuickStart={onQuickStart} />}
          {view === 'daily' && <DailyDesk onQuickStart={onQuickStart} />}
          {view === 'omics' && <OmicsWorkbench onQuickStart={onQuickStart} />}
          {view === 'data' && <DataGovernanceWorkbench onQuickStart={onQuickStart} />}
          {view === 'gs' && <GsWorkbench onQuickStart={onQuickStart} />}
          {view === 'writing' && <WritingWorkbench onQuickStart={onQuickStart} />}
          {view === 'knowledge' && <KnowledgeCenter />}
          {view === 'intake' && <KnowledgeIntake />}
          {view === 'feedback' && <FeedbackWorkbench />}
        </main>
      </div>
    </div>
  )
}
