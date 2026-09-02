/*
 Turn a user-pasted URL into something the learner view can render.

 Shared by the Embed activity and the Library media viewer, so linked learning
 content opens in-app instead of sending the learner away from the course.
*/

/** Extract a YouTube video id from common URL shapes, or null. */
export function youTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      return u.pathname.split('/').filter(Boolean)[0] || null
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v')
      if (v) return v
      const parts = u.pathname.split('/').filter(Boolean)
      const i = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'v')
      if (i !== -1 && parts[i + 1]) return parts[i + 1]
    }
  } catch {
    /* not a parseable URL */
  }
  return null
}

/** Vimeo video id, or null. */
export function vimeoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.hostname.replace(/^www\./, '').endsWith('vimeo.com')) return null
    const id = u.pathname.split('/').filter(Boolean).find((p) => /^\d+$/.test(p))
    return id || null
  } catch {
    return null
  }
}

export type DirectMediaKind = 'audio' | 'video' | null

/**
 * Identify direct browser-playable media links. Query strings and signed URL
 * parameters do not affect detection because only the URL pathname is checked.
 */
export function directMediaKind(url: string): DirectMediaKind {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (/\.(mp3|wav|aac|flac|m4a|ogg)$/.test(pathname)) return 'audio'
    if (/\.(mp4|webm)$/.test(pathname)) return 'video'
  } catch {
    /* not a parseable URL */
  }
  return null
}

function isDirectOfficeDocument(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    return /\.(ppt|pptx|doc|docx|xls|xlsx)$/.test(pathname)
  } catch {
    return false
  }
}

export function toEmbedUrl(url: string): string {
  const yt = youTubeId(url)
  if (yt) return `https://www.youtube.com/embed/${yt}?autoplay=0&rel=0`

  const vimeo = vimeoId(url)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo}`

  // Google Docs/Sheets/Slides → preview
  const googleDocMatch = url.match(
    /^(https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[^/]+)/
  )
  if (googleDocMatch) {
    return `${googleDocMatch[1]}/preview`
  }

  // Google Forms → embedded
  const googleFormMatch = url.match(
    /^(https?:\/\/docs\.google\.com\/forms\/d\/[^/]+)/
  )
  if (googleFormMatch) {
    return `${googleFormMatch[1]}/viewform?embedded=true`
  }

  // Public direct Office files, including PowerPoint, render in Microsoft's
  // browser viewer. Private uploaded course files use the platform's protected
  // document path instead and are never exposed to this third-party viewer.
  if (isDirectOfficeDocument(url)) {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
  }

  // Figma → embed host
  if (/^https?:\/\/(www\.)?figma\.com\//.test(url)) {
    return `https://www.figma.com/embed?embed_host=learnhouse&url=${encodeURIComponent(url)}`
  }

  // Loom → /share/ to /embed/
  const loomMatch = url.match(/^(https?:\/\/www\.loom\.com)\/share\/(.+)$/)
  if (loomMatch) {
    return `${loomMatch[1]}/embed/${loomMatch[2]}`
  }

  // Canva design → embed
  if (url.includes('canva.com/design/')) {
    return url.includes('?') ? `${url}&embed` : `${url}?embed`
  }

  // Miro → embed
  const miroMatch = url.match(/^(https?:\/\/miro\.com\/app\/board\/)(.+)$/)
  if (miroMatch) {
    return `https://miro.com/app/live-embed/${miroMatch[2]}`
  }

  return url
}
