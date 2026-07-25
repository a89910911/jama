/**
 * 保存单镜配置；经典模式随后按已保存字段重建 video_prompt。
 * 全能模式只保存 universal_segment_text，不触碰经典视频提示词。
 */
export async function saveStoryboardWorkspace(api, storyboardId, payload) {
  await api.update(storyboardId, payload)

  if (payload?.creation_mode === 'universal') {
    return { rebuiltVideoPrompt: false, storyboard: null }
  }

  const storyboard = await api.rebuildVideoPrompt(storyboardId)
  return { rebuiltVideoPrompt: true, storyboard }
}
