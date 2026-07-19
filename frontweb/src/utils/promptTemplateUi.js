export function promptRowKey(item) {
  return item.prompt_key
}

export function effectivePromptContent(item, projectMode = false) {
  return projectMode ? item.effective_content : item.system_content
}

export function filterPromptItems(items, filters = {}) {
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  return (items || []).filter((item) => {
    if (filters.category && item.category !== filters.category) return false
    if (filters.subcategory && item.subcategory !== filters.subcategory) return false
    if (filters.detailCategory && item.detail_category !== filters.detailCategory) return false
    if (filters.workflowStage && item.workflow_stage !== filters.workflowStage) return false
    if (filters.sceneKey && item.scene_key !== filters.sceneKey) return false
    if (filters.templateKind && item.template_kind !== filters.templateKind) return false
    if (!keyword) return true
    return [
      item.name,
      item.prompt_key,
      item.category,
      item.subcategory,
      item.detail_category,
      item.workflow_stage,
      item.business_scene_label,
      item.business_scene_config_name,
      item.business_scene_model,
      item.scene_key,
      item.description,
      item.injection_channel,
      item.parent_prompt_key,
      item.relation_note,
      item.template_kind,
      item.template_subtype,
      item.content_type,
    ]
      .some((value) => String(value || '').toLowerCase().includes(keyword))
  })
}

export function rootPromptKey(item, allItems = []) {
  const byKey = new Map((allItems || []).map((row) => [row.prompt_key, row]))
  let current = item
  const visited = new Set()
  while (current?.parent_prompt_key && !visited.has(current.prompt_key)) {
    visited.add(current.prompt_key)
    const parent = byKey.get(current.parent_prompt_key)
    if (!parent) return current.parent_prompt_key
    current = parent
  }
  return current?.prompt_key || item?.prompt_key || ''
}

export function promptBundleKey(item, allItems = []) {
  if (item?.scene_key) return `scene:${item.scene_key}`
  return `prompt:${rootPromptKey(item, allItems)}`
}

export function groupPromptItems(visibleItems, allItems = visibleItems) {
  const allByKey = new Map((allItems || []).map((item) => [item.prompt_key, item]))
  const groups = new Map()
  for (const item of visibleItems || []) {
    const rootKey = rootPromptKey(item, allItems)
    const bundleKey = promptBundleKey(item, allItems)
    if (!groups.has(bundleKey)) {
      const sceneItems = item.scene_key
        ? (allItems || []).filter((row) => row.scene_key === item.scene_key)
        : []
      groups.set(bundleKey, {
        key: bundleKey,
        scene_key: item.scene_key || '',
        label: item.business_scene_label || item.name || rootKey,
        root: allByKey.get(rootKey) || null,
        parent: null,
        children: [],
        items: [],
        allItems: sceneItems,
      })
    }
    const group = groups.get(bundleKey)
    group.items.push(item)
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => {
      const aOrder = Number(a.business_component_order || a.sort_order || 0)
      const bOrder = Number(b.business_component_order || b.sort_order || 0)
      return aOrder - bOrder
    })
    group.allItems.sort((a, b) => {
      const aOrder = Number(a.business_component_order || a.sort_order || 0)
      const bOrder = Number(b.business_component_order || b.sort_order || 0)
      return aOrder - bOrder
    })
    group.root = group.allItems[0] || group.items[0] || group.root
    group.parent = group.items[0] || null
    group.children = group.items.slice(1)
  }
  return [...groups.values()].sort((a, b) => {
    const aOrder = Number(a.root?.business_scene_order ?? a.root?.sort_order ?? 0)
    const bOrder = Number(b.root?.business_scene_order ?? b.root?.sort_order ?? 0)
    return aOrder - bOrder
  })
}

export function groupPromptSections(promptGroups = []) {
  const categories = new Map()
  for (const group of promptGroups || []) {
    const item = group.root || group.parent || group.children[0] || {}
    const categoryLabel = item.category || '未分类'
    const categoryOrder = Number(item.workflow_order || 0)
    const categoryKey = `${categoryOrder}:${categoryLabel}`
    if (!categories.has(categoryKey)) {
      categories.set(categoryKey, {
        key: categoryKey,
        label: categoryLabel,
        order: categoryOrder,
        subcategories: new Map(),
      })
    }
    const category = categories.get(categoryKey)
    const subcategoryLabel = item.subcategory || '其他'
    if (!category.subcategories.has(subcategoryLabel)) {
      category.subcategories.set(subcategoryLabel, {
        key: `${categoryKey}:${subcategoryLabel}`,
        label: subcategoryLabel,
        details: new Map(),
      })
    }
    const subcategory = category.subcategories.get(subcategoryLabel)
    const detailLabel = item.detail_category || ''
    if (!subcategory.details.has(detailLabel)) {
      subcategory.details.set(detailLabel, {
        key: `${subcategory.key}:${detailLabel || 'all'}`,
        label: detailLabel,
        groups: [],
      })
    }
    subcategory.details.get(detailLabel).groups.push(group)
  }
  return [...categories.values()]
    .sort((a, b) => a.order - b.order)
    .map((category) => ({
      ...category,
      subcategories: [...category.subcategories.values()].map((subcategory) => ({
        ...subcategory,
        details: [...subcategory.details.values()],
      })),
    }))
}
