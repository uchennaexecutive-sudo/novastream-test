/**
 * StorageIndicator
 *
 * Storage usage card for the Downloads page.
 * Shows a segmented fill bar, per-type breakdown, and used/free counts.
 *
 * Backend wiring points (Phase C/E):
 *   usedBytes, totalBytes, breakdown  → fed from invoke("get_downloads_storage_info")
 *   onRefreshStorage                  → calls invoke("get_downloads_storage_info") on demand
 *   onManage                          → navigates to Settings > Downloads
 */
import { HardDrive, RefreshCw } from 'lucide-react'

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB'
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const TYPE_COLORS = {
  movies:    'var(--accent)',
  series:    'var(--accent-secondary, #818cf8)',
  anime:     '#f472b6',
  animation: '#fb923c',
}

const TYPE_LABELS = {
  movies:    'Movies',
  series:    'Series',
  anime:     'Anime',
  animation: 'Animation',
}

export default function StorageIndicator({
  usedBytes = 0,
  totalBytes = 0,
  freeBytes = null,
  breakdown = {},
  onManage,
  // Phase E wiring point: call invoke("get_downloads_storage_info") to refresh real disk usage
  onRefreshStorage = null,
}) {
  const usedBytesNum = Number(usedBytes) || 0
  const totalBytesNum = Number(totalBytes) || 0
  const fillPercent = totalBytesNum > 0
    ? Math.min(100, (usedBytesNum / totalBytesNum) * 100)
    : null

  const hasAnyUsage = usedBytesNum > 0
  const breakdownEntries = Object.entries(breakdown).filter(([, v]) => Number(v) > 0)
  const hasBreakdown = breakdownEntries.length > 0

  const freeBytesNum = freeBytes != null
    ? Math.max(0, Number(freeBytes) || 0)
    : (totalBytesNum > 0 ? Math.max(0, totalBytesNum - usedBytesNum) : null)

  return (
    <div
      className="rounded-2xl px-5 py-4"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      {/* Top row: icon + label + actions */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <HardDrive size={15} style={{ color: 'var(--text-muted)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Storage
          </span>
          {hasAnyUsage && (
            <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
              {formatBytes(usedBytesNum)} used
              {freeBytesNum != null && (
                <span style={{ opacity: 0.55 }}> · {formatBytes(freeBytesNum)} free</span>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {onRefreshStorage && (
            <button
              onClick={onRefreshStorage}
              className="flex items-center gap-1 text-xs transition-colors duration-150"
              style={{ color: 'var(--text-muted)' }}
              title="Refresh storage info from disk"
            >
              <RefreshCw size={11} />
            </button>
          )}
          {onManage && (
            <button
              onClick={onManage}
              className="text-xs font-medium transition-colors duration-150"
              style={{ color: 'var(--accent)' }}
            >
              Manage
            </button>
          )}
        </div>
      </div>

      {/* Fill bar */}
      <div
        className="h-2.5 rounded-full overflow-hidden mb-3"
        style={{ background: 'rgba(255,255,255,0.07)' }}
      >
        {!hasAnyUsage ? (
          // Empty state — subtle ghost bar
          <div
            className="h-full rounded-full"
            style={{
              width: '0%',
              background: 'var(--accent)',
            }}
          />
        ) : hasBreakdown ? (
          // Segmented bar
          <div className="flex h-full">
            {breakdownEntries.map(([key, bytes]) => {
              const segPercent = totalBytesNum > 0
                ? (Number(bytes) / totalBytesNum) * 100
                : (usedBytesNum > 0 ? (Number(bytes) / usedBytesNum) * 100 : 0)
              return (
                <div
                  key={key}
                  style={{
                    width: `${segPercent}%`,
                    background: TYPE_COLORS[key] || 'var(--accent)',
                    transition: 'width 0.6s ease',
                    minWidth: segPercent > 0 ? 3 : 0,
                  }}
                />
              )
            })}
          </div>
        ) : (
          // Single solid bar
          <div
            className="h-full rounded-full"
            style={{
              width: fillPercent != null ? `${fillPercent}%` : '0%',
              background: 'var(--accent)',
              boxShadow: '0 0 8px var(--accent-glow)',
              transition: 'width 0.6s ease',
            }}
          />
        )}
      </div>

      {/* Breakdown legend row */}
      {hasAnyUsage ? (
        <div className="flex items-center justify-between flex-wrap gap-y-1.5">
          <div className="flex items-center gap-4 flex-wrap">
            {hasBreakdown
              ? breakdownEntries.map(([key, bytes]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: TYPE_COLORS[key] || 'var(--accent)' }}
                    />
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {TYPE_LABELS[key] || key}
                      <span className="font-semibold font-mono ml-1" style={{ color: 'var(--text-secondary)' }}>
                        {formatBytes(Number(bytes))}
                      </span>
                    </span>
                  </div>
                ))
              : (
                <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(usedBytesNum)} used
                </span>
              )
            }
          </div>

          {totalBytesNum > 0 && fillPercent != null && (
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {Math.round(fillPercent)}% full
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No downloads stored yet. Downloaded titles will appear here.
        </p>
      )}
    </div>
  )
}
