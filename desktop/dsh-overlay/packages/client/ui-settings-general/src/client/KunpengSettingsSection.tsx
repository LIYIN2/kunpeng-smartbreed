import { useMemo, useState } from 'react'
import css from './KunpengSettingsSection.module.css'

const STORAGE_KEY = 'kunpeng.research.settings.v1'

interface KunpengSettings {
  labName: string
  defaultOwner: string
  gsModel: 'GBLUP' | 'ssGBLUP'
  includeDraftKnowledge: boolean
  persistDailyTasks: boolean
}

const defaults: KunpengSettings = {
  labName: '厦门大学鱼类遗传育种实验室',
  defaultOwner: '',
  gsModel: 'GBLUP',
  includeDraftKnowledge: true,
  persistDailyTasks: true,
}

function loadSettings(): KunpengSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<KunpengSettings>
    return { ...defaults, ...stored }
  } catch {
    return defaults
  }
}

export function KunpengSettingsSection() {
  const initial = useMemo(loadSettings, [])
  const [settings, setSettings] = useState(initial)
  const [saved, setSaved] = useState(false)
  const update = <K extends keyof KunpengSettings>(key: K, value: KunpengSettings[K]) => {
    setSettings(previous => ({ ...previous, [key]: value }))
    setSaved(false)
  }
  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    setSaved(true)
  }

  return (
    <div className={css.page}>
      <section className={css.hero}>
        <img src="/kunpeng-logo.png" alt="" />
        <div><span>鲲鹏智能体 2.2</span><h2>科研默认设置</h2><p>这些设置会直接作用于知识中心、每日任务台和全基因组选育输入门禁。</p></div>
      </section>

      <section className={css.group}>
        <header><h3>实验室与任务</h3><p>用于工作台显示和新任务的默认负责人。</p></header>
        <label><span>实验室名称</span><input value={settings.labName} onChange={event => { update('labName', event.currentTarget.value) }} /></label>
        <label><span>默认负责人</span><input value={settings.defaultOwner} onChange={event => { update('defaultOwner', event.currentTarget.value) }} placeholder="可留空，由学生每次填写" /></label>
        <label className={css.switchRow}><span><strong>在本机保存每日任务</strong><small>关闭后，新任务只保留到当前窗口关闭。</small></span><input type="checkbox" checked={settings.persistDailyTasks} onChange={event => { update('persistDailyTasks', event.currentTarget.checked) }} /></label>
      </section>

      <section className={css.group}>
        <header><h3>全基因组选育</h3><p>这里只设置准入默认值，不会绕过样本质控与人工审核。</p></header>
        <label><span>默认准入模型</span><select value={settings.gsModel} onChange={event => { update('gsModel', event.currentTarget.value as KunpengSettings['gsModel']) }}><option value="GBLUP">GBLUP</option><option value="ssGBLUP">ssGBLUP</option></select></label>
      </section>

      <section className={css.group}>
        <header><h3>知识治理</h3><p>reviewed 表示已复核；draft 只能作为待核对材料，不能当作定论。</p></header>
        <label className={css.switchRow}><span><strong>知识中心显示 draft 条目</strong><small>关闭后仅显示 reviewed 条目；源文件不会被删除。</small></span><input type="checkbox" checked={settings.includeDraftKnowledge} onChange={event => { update('includeDraftKnowledge', event.currentTarget.checked) }} /></label>
      </section>

      <div className={css.saveBar}><span>{saved ? '已保存，重新打开工作台后生效' : '修改尚未保存'}</span><button type="button" onClick={save}>保存科研设置</button></div>
    </div>
  )
}
