/**
 * Build inclusive, cumulative time ranges for an ordered storyboard list.
 * An 8-second first storyboard therefore occupies 0-7 seconds.
 */
export function buildStoryboardTimeRanges(
  storyboards,
  getDuration = (storyboard) => storyboard?.duration,
  fallbackDuration = 5
) {
  const boards = Array.isArray(storyboards) ? storyboards : []
  const fallback = normalizeDuration(fallbackDuration, 5)
  let start = 0

  return boards.map((storyboard, index) => {
    const duration = normalizeDuration(getDuration(storyboard, index), fallback)
    const end = start + duration - 1
    const range = {
      start,
      end,
      duration,
      label: `${start}-${end}秒`,
    }
    start = end + 1
    return range
  })
}

function normalizeDuration(value, fallback) {
  const duration = Number(value)
  if (Number.isFinite(duration) && duration > 0) return Math.round(duration)
  return Math.max(1, Math.round(Number(fallback)) || 1)
}
