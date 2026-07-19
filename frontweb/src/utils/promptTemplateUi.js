export function promptRowKey(item) {
  return `${item.prompt_key}::${item.locale}`
}

export function effectivePromptContent(item, projectMode = false) {
  return projectMode ? item.effective_content : item.system_content
}

export function filterPromptItems(items, filters = {}) {
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  return (items || []).filter((item) => {
    if (filters.category && item.category !== filters.category) return false
    if (filters.sceneKey && item.scene_key !== filters.sceneKey) return false
    if (filters.role && item.message_role !== filters.role) return false
    if (filters.locale && item.locale !== filters.locale) return false
    if (!keyword) return true
    return [item.name, item.prompt_key, item.category, item.scene_key, item.description]
      .some((value) => String(value || '').toLowerCase().includes(keyword))
  })
}
