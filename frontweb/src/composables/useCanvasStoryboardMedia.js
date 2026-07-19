import { ref } from 'vue'
import { episodeMediaAPI } from '@/api/episodeMedia'

/**
 * 加载当前剧集分镜的 images / videos 列表（与 FilmCreate.loadStoryboardMedia 对齐）
 */
export function useCanvasStoryboardMedia() {
  const imagesBySbId = ref({})
  const videosBySbId = ref({})
  const mediaLoading = ref(false)

  async function loadForStoryboards(storyboards) {
    const boards = storyboards || []
    if (!boards.length) {
      imagesBySbId.value = {}
      videosBySbId.value = {}
      return
    }
    mediaLoading.value = true
    try {
      const nextImages = {}
      const nextVideos = {}
      const boardsByEpisode = new Map()
      for (const board of boards) {
        const episodeId = Number(board?.episode_id)
        if (!Number.isInteger(episodeId) || episodeId <= 0) continue
        if (!boardsByEpisode.has(episodeId)) boardsByEpisode.set(episodeId, [])
        boardsByEpisode.get(episodeId).push(board)
      }

      const episodeResults = await Promise.all(
        [...boardsByEpisode.entries()].map(async ([episodeId, episodeBoards]) => ({
          episodeBoards,
          media: await episodeMediaAPI.get(episodeId, episodeBoards.map((board) => board.id)),
        }))
      )
      for (const { episodeBoards, media } of episodeResults) {
        const imageGroups = media?.images_by_storyboard || {}
        const videoGroups = media?.videos_by_storyboard || {}
        for (const board of episodeBoards) {
          nextImages[board.id] = imageGroups[String(board.id)] || []
          nextVideos[board.id] = videoGroups[String(board.id)] || []
        }
      }
      imagesBySbId.value = nextImages
      videosBySbId.value = nextVideos
    } finally {
      mediaLoading.value = false
    }
  }

  async function loadForDrama(drama, episodeId = null) {
    const episodes = episodeId
      ? (drama?.episodes || []).filter((ep) => Number(ep.id) === Number(episodeId))
      : (drama?.episodes || [])
    const boards = episodes.flatMap((ep) => ep.storyboards || [])
    await loadForStoryboards(boards)
  }

  return {
    imagesBySbId,
    videosBySbId,
    mediaLoading,
    loadForStoryboards,
    loadForDrama,
  }
}
