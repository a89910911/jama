const LAST_FRAME_TYPES = new Set(['storyboard_last', 'last', 'tail', 'last_frame'])

export function isStoryboardLastFrameHistory(image) {
  return LAST_FRAME_TYPES.has(String(image?.frame_type || '').trim().toLowerCase())
}

export function splitStoryboardFrameHistory(images, boundImageIds = []) {
  const boundIds = new Set(boundImageIds.filter((id) => id != null).map(Number))
  const groups = { first: [], last: [] }

  for (const image of Array.isArray(images) ? images : []) {
    if (boundIds.has(Number(image?.id))) continue
    groups[isStoryboardLastFrameHistory(image) ? 'last' : 'first'].push(image)
  }

  return groups
}
