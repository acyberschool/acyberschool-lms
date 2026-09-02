'use client'
import React from 'react'
import {
  WarningCircle,
  SquaresFour,
  Microphone,
  UsersThree,
  Code,
  GraduationCap,
  ArrowSquareOut,
  File as FileIcon,
  DownloadSimple,
} from '@phosphor-icons/react'
import { buildEmbedUrl, buildResourceUrl, type ResourceKind } from '@/lib/library/resourceEmbed'
import { mediaKind } from '@/lib/media/mediaKind'
import { directMediaKind, toEmbedUrl } from '@/lib/media/embedUrl'
import {
  getMediaById,
  getMediaFileDirectory,
} from '@services/media/media-resource'
import { useLHSession } from '@components/Contexts/LHSessionContext'

const KIND_META: Partial<Record<ResourceKind, { label: string; icon: any; color: string }>> = {
  course: { label: 'Course', icon: GraduationCap, color: 'text-blue-500' },
  podcast: { label: 'Podcast', icon: Microphone, color: 'text-violet-500' },
  community: { label: 'Community', icon: UsersThree, color: 'text-emerald-500' },
  board: { label: 'Board', icon: SquaresFour, color: 'text-indigo-500' },
  playground: { label: 'Playground', icon: Code, color: 'text-amber-500' },
  media: { label: 'Learning file', icon: FileIcon, color: 'text-amber-500' },
}

interface ResourceActivityProps {
  activity: any
  orgslug: string
  style?: React.CSSProperties
}

function MediaResource({ activity }: { activity: any }) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const resourceUuid = activity.content?.resource_uuid || ''
  const snapshot = activity.content?.resource_snapshot || null
  const [resource, setResource] = React.useState<any>(snapshot)
  const [loading, setLoading] = React.useState(!snapshot)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    if (!resourceUuid || snapshot) return
    let cancelled = false
    setLoading(true)
    getMediaById(resourceUuid, accessToken)
      .then((data) => {
        if (!cancelled) setResource(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [resourceUuid, snapshot, accessToken])

  if (loading) {
    return (
      <div className="w-full h-48 rounded-xl bg-gray-100 animate-pulse" />
    )
  }

  if (failed || !resource) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <WarningCircle size={40} className="text-red-400" />
        <p className="text-sm text-gray-600">This learning file is unavailable.</p>
      </div>
    )
  }

  const kind = mediaKind(resource)
  const fileUrl = getMediaFileDirectory(undefined, resourceUuid)
  const downloadUrl = getMediaFileDirectory(undefined, resourceUuid, undefined, {
    download: true,
  })

  if (kind === 'audio') {
    return (
      <div className="w-full rounded-xl nice-shadow bg-white p-6">
        <audio
          src={fileUrl}
          controls
          preload="metadata"
          controlsList="nodownload"
          className="w-full"
        />
      </div>
    )
  }

  if (kind === 'video') {
    return (
      <div className="w-full rounded-xl overflow-hidden nice-shadow bg-black" style={{ aspectRatio: '16/9' }}>
        <video
          src={fileUrl}
          controls
          preload="metadata"
          controlsList="nodownload"
          playsInline
          className="w-full h-full"
        />
      </div>
    )
  }

  if (kind === 'pdf') {
    return (
      <div className="w-full rounded-xl overflow-hidden nice-shadow bg-white" style={{ height: '78vh', minHeight: 520 }}>
        <iframe
          src={fileUrl}
          title={resource.name || activity.name || 'PDF document'}
          className="w-full h-full border-0"
        />
      </div>
    )
  }

  if (kind === 'image') {
    return (
      <div className="w-full flex justify-center rounded-xl nice-shadow bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={fileUrl}
          alt={resource.name || activity.name || 'Learning image'}
          className="max-w-full max-h-[78vh] object-contain rounded-lg"
        />
      </div>
    )
  }

  if (kind === 'embed') {
    const url = resource.url || ''
    if (!url) {
      return (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <WarningCircle size={40} className="text-red-400" />
          <p className="text-sm text-gray-600">This linked resource has no URL.</p>
        </div>
      )
    }

    const directKind = directMediaKind(url)
    if (directKind === 'audio') {
      return (
        <div className="w-full rounded-xl nice-shadow bg-white p-6">
          <audio src={url} controls preload="metadata" controlsList="nodownload" className="w-full" />
        </div>
      )
    }
    if (directKind === 'video') {
      return (
        <div className="w-full rounded-xl overflow-hidden nice-shadow bg-black" style={{ aspectRatio: '16/9' }}>
          <video src={url} controls preload="metadata" controlsList="nodownload" playsInline className="w-full h-full" />
        </div>
      )
    }

    return (
      <div className="w-full rounded-xl overflow-hidden nice-shadow" style={{ aspectRatio: '16/9' }}>
        <iframe
          src={toEmbedUrl(url)}
          title={resource.name || activity.name || 'Learning content'}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
        />
      </div>
    )
  }

  return (
    <div className="w-full rounded-xl nice-shadow bg-white p-8 flex flex-col items-center text-center gap-4">
      <FileIcon size={42} weight="duotone" className="text-gray-400" />
      <div>
        <p className="font-medium text-gray-800">{resource.name || activity.name}</p>
        <p className="mt-1 text-sm text-gray-500">
          This file is available securely from the course.
        </p>
      </div>
      <a
        href={downloadUrl}
        className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        <DownloadSimple size={16} />
        Open file
      </a>
    </div>
  )
}

function ResourceActivity({ activity, orgslug, style }: ResourceActivityProps) {
  const kind = (activity.content?.resource_type || '') as ResourceKind
  const resourceUuid = activity.content?.resource_uuid || ''
  const meta = KIND_META[kind]

  if (!meta || !resourceUuid) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <WarningCircle size={40} className="text-red-400" />
        <p className="text-sm text-gray-600">No resource configured</p>
      </div>
    )
  }

  if (kind === 'media') {
    return (
      <div className="w-full px-6 py-6" style={style}>
        <MediaResource activity={activity} />
      </div>
    )
  }

  const baseUrl = buildResourceUrl(kind, resourceUuid, orgslug)
  if (!baseUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <WarningCircle size={40} className="text-red-400" />
        <p className="text-sm text-gray-600">No resource configured</p>
      </div>
    )
  }

  const Icon = meta.icon
  const embedUrl = buildEmbedUrl(kind, baseUrl)

  return (
    <div className="w-full px-6 py-6" style={style}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={20} weight="duotone" className={`${meta.color} flex-shrink-0`} />
          <span className="text-sm font-medium text-gray-600">{meta.label}</span>
        </div>
        <a
          href={baseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowSquareOut size={14} />
          Open
        </a>
      </div>

      <div
        className="w-full rounded-xl overflow-hidden nice-shadow bg-white"
        style={{ height: '75vh', minHeight: 480 }}
      >
        <iframe
          src={embedUrl}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    </div>
  )
}

export default ResourceActivity
