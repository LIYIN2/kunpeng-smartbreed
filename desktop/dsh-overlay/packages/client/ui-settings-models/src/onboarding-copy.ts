/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-21.kunpeng-2'

/** The complete editable internal-testing notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '欢迎使用鲲鹏智能体',
    body: '鲲鹏智能体面向大黄鱼全基因组选育与学生日常科研办公，提供文献证据、实验办公、组学工作流、育种数据治理、全基因组选育和科研写作能力。\n\n鲲鹏基于 DeepSeek Harness 的开源插件体系构建，保留智能体创建、文件、终端、工作流和扩展能力。模型输出不替代真实证据、受控计算和负责人审核。',
    continueLabel: '进入科研工作台',
  },
  en: {
    title: 'Welcome to Kunpeng Research Agent',
    body: 'Kunpeng supports large yellow croaker genomic selection and daily research work: evidence search, experiment operations, omics workflows, breeding-data governance, genomic selection, and scientific writing.\n\nIt is built on the open-source DeepSeek Harness plugin system and retains agent authoring, files, terminals, workflows, and extension points. Model output never replaces evidence, governed computation, or human review.',
    continueLabel: 'Open research workspace',
  },
} as const
