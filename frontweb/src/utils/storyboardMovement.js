export const STORYBOARD_MOVEMENT_OPTION_GROUPS = Object.freeze([
  {
    label: '基础运镜',
    options: [
      { label: '固定', value: 'static', shortLabel: '固定' },
      { label: '推镜', value: 'push', shortLabel: '推镜' },
      { label: '拉镜', value: 'pull', shortLabel: '拉镜' },
      { label: '横摇', value: 'pan', shortLabel: '横摇' },
      { label: '纵摇', value: 'tilt', shortLabel: '纵摇' },
      { label: '跟镜 / 跟踪', value: 'tracking', shortLabel: '跟镜' },
      { label: '升镜', value: 'crane_up', shortLabel: '升镜' },
      { label: '降镜', value: 'crane_dn', shortLabel: '降镜' },
      { label: '环绕 / 轨道', value: 'orbit', shortLabel: '环绕' },
      { label: '手持 / 晃动', value: 'handheld', shortLabel: '手持' },
    ],
  },
  {
    label: '进阶运镜',
    options: [
      { label: '变焦', value: 'zoom', shortLabel: '变焦' },
      { label: '旋转 / 滚镜', value: 'roll', shortLabel: '旋转' },
      { label: '甩镜 / 急摇', value: 'whip_pan', shortLabel: '甩镜' },
      { label: '螺旋升降', value: 'spiral', shortLabel: '螺旋' },
      { label: '希区柯克镜头', value: 'hitchcock_zoom', shortLabel: '希区柯克' },
      { label: '子弹时间', value: 'bullet_time', shortLabel: '子弹时间' },
      { label: '荷兰角运镜', value: 'dutch_angle_move', shortLabel: '荷兰角' },
      { label: '推轨复合', value: 'dolly_track', shortLabel: '推轨' },
      { label: '升格环绕', value: 'slowmo_orbit', shortLabel: '升格环绕' },
    ],
  },
])

const MOVEMENT_OPTIONS = STORYBOARD_MOVEMENT_OPTION_GROUPS.flatMap((group) => group.options)
const MOVEMENT_BY_VALUE = new Map(MOVEMENT_OPTIONS.map((option) => [option.value, option]))
const MOVEMENT_VALUES_BY_LENGTH = [...MOVEMENT_BY_VALUE.keys()].sort((a, b) => b.length - a.length)

const MOVEMENT_ALIASES = [
  ['dolly_track', ['推轨复合', '推轨']],
  ['hitchcock_zoom', ['希区柯克']],
  ['dutch_angle_move', ['荷兰角']],
  ['slowmo_orbit', ['升格环绕']],
  ['bullet_time', ['子弹时间']],
  ['whip_pan', ['甩镜', '急摇']],
  ['spiral', ['螺旋']],
  ['tracking', ['跟镜', '跟拍', '跟踪']],
  ['handheld', ['手持', '晃动']],
  ['crane_up', ['升镜', '上升']],
  ['crane_dn', ['降镜', '下降']],
  ['orbit', ['环绕', '轨道']],
  ['zoom', ['变焦']],
  ['roll', ['旋转', '滚镜']],
  ['static', ['固定', '不动']],
  ['push', ['推镜', '推进']],
  ['pull', ['拉镜', '拉出']],
  ['tilt', ['纵摇', '上摇', '下摇']],
  ['pan', ['横摇', '摇镜']],
]

/**
 * AI 历史数据可能写成“甩镜whip_pan”“推镜push”等中英组合形式。
 * 编辑控件统一使用英文枚举值，确保现有数据能命中下拉选项。
 */
export function normalizeStoryboardMovement(value) {
  const raw = (value ?? '').toString().trim()
  if (!raw) return ''
  if (MOVEMENT_BY_VALUE.has(raw)) return raw

  const compact = raw.toLowerCase().replace(/\s+/g, '')
  for (const movementValue of MOVEMENT_VALUES_BY_LENGTH) {
    if (compact === movementValue || compact.endsWith(movementValue)) return movementValue
  }
  for (const [movementValue, aliases] of MOVEMENT_ALIASES) {
    if (aliases.some((alias) => raw.includes(alias))) return movementValue
  }
  return raw
}

export function storyboardMovementLabel(value) {
  const normalized = normalizeStoryboardMovement(value)
  return MOVEMENT_BY_VALUE.get(normalized)?.shortLabel || normalized
}
