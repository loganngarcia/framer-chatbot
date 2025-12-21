import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

// --- MARKDOWN & PARSING UTILITIES ---

function ensureProtocol(url: string): string {
    if (
        url.startsWith("mailto:") ||
        url.startsWith("tel:") ||
        url.startsWith("http://") ||
        url.startsWith("https://")
    ) {
        return url
    }
    if (url.includes(".") && !url.includes(" ") && !url.startsWith("/")) {
        if (/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(url.split("/")[0])) {
            return "https://" + url
        }
    }
    return url
}

const applyInlineFormatting = (
    textSegment: string,
    keyPrefix: string,
    linkStyle: React.CSSProperties
): (string | JSX.Element)[] => {
    if (!textSegment) return []
    const parts: (string | JSX.Element)[] = []
    let lastIndex = 0

    // Improved regex with better URL detection
    // Order matters: specific patterns (markdown links, HTML) before auto-detection
    const combinedRegex =
        /(\*\*(.*?)\*\*|__(.*?)__|<strong>(.*?)<\/strong>|<b>(.*?)<\/b>|\`([^`]+)\`|~~(.*?)~~|(\*|_)(.*?)\8|<em>(.*?)<\/em>|<i>(.*?)<\/i>|\[([^\]]+?)\]\(([^)]+?)\)|<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63})|(https?:\/\/[^\s<>"{}|\\^`\[\]]+[^\s<>"{}|\\^`\[\].,;:!?)])|([a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}(?::\d+)?(?:\/[^\s<>"{}|\\^`\[\]]*)?(?=[.,;:!?)]*(?:\s|$)))/gi

    let match
    while ((match = combinedRegex.exec(textSegment)) !== null) {
        if (match.index > lastIndex) {
            parts.push(textSegment.substring(lastIndex, match.index))
        }

        const [
            fullMatch,
            matchText,
            boldInner,
            boldInner2,
            strongInner,
            bInner,
            codeInner,
            strikeInner,
            italicDelim,
            italicInner,
            emInner,
            iInner,
            linkText,
            linkUrl,
            htmlLinkUrl,
            htmlLinkText,
            email,
            httpUrl,
            plainUrl,
        ] = match

        if (
            boldInner !== undefined ||
            boldInner2 !== undefined ||
            strongInner !== undefined ||
            bInner !== undefined
        ) {
            parts.push(
                <strong key={`${keyPrefix}-${match.index}-b`}>
                    {boldInner || boldInner2 || strongInner || bInner}
                </strong>
            )
        } else if (codeInner !== undefined) {
            parts.push(
                <span
                    key={`${keyPrefix}-${match.index}-code`}
                    className="chat-markdown-inline-code"
                >
                    {codeInner}
                </span>
            )
        } else if (strikeInner !== undefined) {
            parts.push(
                <del key={`${keyPrefix}-${match.index}-del`}>{strikeInner}</del>
            )
        } else if (
            italicInner !== undefined ||
            emInner !== undefined ||
            iInner !== undefined
        ) {
            parts.push(
                <em key={`${keyPrefix}-${match.index}-em`}>
                    {italicInner || emInner || iInner}
                </em>
            )
        } else if (linkText !== undefined && linkUrl !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-a`}
                    href={ensureProtocol(linkUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkStyle}
                >
                    {linkText}
                </a>
            )
        } else if (htmlLinkText !== undefined && htmlLinkUrl !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-html-a`}
                    href={ensureProtocol(htmlLinkUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkStyle}
                >
                    {htmlLinkText}
                </a>
            )
        } else if (email !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-mail`}
                    href={`mailto:${email}`}
                    style={linkStyle}
                >
                    {email}
                </a>
            )
        } else if (httpUrl !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-http`}
                    href={httpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkStyle}
                >
                    {httpUrl}
                </a>
            )
        } else if (plainUrl !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-url`}
                    href={ensureProtocol(plainUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkStyle}
                >
                    {plainUrl}
                </a>
            )
        } else {
            parts.push(fullMatch)
        }
        lastIndex = match.index + fullMatch.length
    }
    if (lastIndex < textSegment.length) {
        parts.push(textSegment.substring(lastIndex))
    }
    return parts
}

const renderTable = (
    block: string,
    key: string,
    baseStyle: React.CSSProperties,
    linkStyle: React.CSSProperties
) => {
    const lines = block.trim().split("\n")
    if (lines.length < 2) return null

    const headerLine = lines[0]
    const separatorLine = lines[1]
    const bodyLines = lines.slice(2)

    if (!separatorLine.includes("-") || !separatorLine.includes("|"))
        return null

    const headers = headerLine
        .split("|")
        .filter((h) => h.trim().length > 0)
        .map((h) => h.trim())
    const rows = bodyLines.map((line) =>
        line
            .split("|")
            .filter((c) => c.trim().length > 0)
            .map((c) => c.trim())
    )

    return (
        <div key={key} style={{ overflowX: "auto", width: "100%" }}>
            <table className="chat-markdown-table">
                <thead>
                    <tr>
                        {headers.map((h, i) => (
                            <th key={`th-${i}`}>
                                {applyInlineFormatting(
                                    h,
                                    `${key}-th-${i}`,
                                    linkStyle
                                )}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={`tr-${i}`}>
                            {row.map((cell, j) => (
                                <td key={`td-${i}-${j}`}>
                                    {applyInlineFormatting(
                                        cell,
                                        `${key}-td-${i}-${j}`,
                                        linkStyle
                                    )}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

const renderSimpleMarkdown = (
    markdownText: string,
    baseTextStyle: React.CSSProperties,
    linkStyle: React.CSSProperties
): JSX.Element => {
    if (!markdownText) return <React.Fragment />

    const codeBlockRegex = /(```[\s\S]*?```)/g
    const segments = markdownText.split(codeBlockRegex)

    const renderedSegments = segments.map((segment, segIndex) => {
        if (segment.startsWith("```")) {
            const content = segment.replace(/^```\w*\n?/, "").replace(/```$/, "")
            return (
                <div
                    key={`codeblock-${segIndex}`}
                    className="chat-markdown-code-block"
                >
                    {content}
                </div>
            )
        }

        const blocks = segment.split(/\n{2,}/)

        return blocks.map((block, blockIndex) => {
            const key = `seg-${segIndex}-blk-${blockIndex}`
            const trimmed = block.trim()
            if (!trimmed) return null

            if (
                trimmed.includes("|") &&
                trimmed.includes("\n") &&
                trimmed.split("\n")[1].includes("---")
            ) {
                const table = renderTable(trimmed, key, baseTextStyle, linkStyle)
                if (table) return table
            }

            if (/^---+$|^\*\*\*+$/.test(trimmed)) {
                return <hr key={key} className="chat-markdown-hr" />
            }

            const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/)
            if (headingMatch) {
                const level = headingMatch[1].length
                const content = headingMatch[2]
                const sizes = [24, 20, 18, 16, 14, 12]
                return (
                    <div
                        key={key}
                        style={{
                            ...baseTextStyle,
                            fontSize: `${Math.max(sizes[level - 1], 14)}px`,
                            fontWeight: "bold",
                            margin: "0.5em 0",
                        }}
                    >
                        {applyInlineFormatting(content, `${key}-h`, linkStyle)}
                    </div>
                )
            }

            if (trimmed.startsWith(">")) {
                const content = trimmed.replace(/^>\s?/gm, "").trim()
                return (
                    <blockquote key={key} className="chat-markdown-blockquote">
                        {applyInlineFormatting(content, `${key}-qt`, linkStyle)}
                    </blockquote>
                )
            }

            if (/^[-*]\s/.test(trimmed)) {
                const items = trimmed
                    .split("\n")
                    .map((l) => l.replace(/^[-*]\s+/, ""))
                return (
                    <ul
                        key={key}
                        style={{
                            paddingLeft: 20,
                            margin: "0.5em 0",
                            listStyleType: "disc",
                        }}
                    >
                        {items.map((item, i) => (
                            <li key={`${key}-li-${i}`} style={baseTextStyle}>
                                {applyInlineFormatting(
                                    item,
                                    `${key}-li-${i}`,
                                    linkStyle
                                )}
                            </li>
                        ))}
                    </ul>
                )
            }

            if (/^\d+\.\s/.test(trimmed)) {
                const items = trimmed
                    .split("\n")
                    .map((l) => l.replace(/^\d+\.\s+/, ""))
                return (
                    <ol
                        key={key}
                        style={{
                            paddingLeft: 20,
                            margin: "0.5em 0",
                            listStyleType: "decimal",
                        }}
                    >
                        {items.map((item, i) => (
                            <li key={`${key}-li-${i}`} style={baseTextStyle}>
                                {applyInlineFormatting(
                                    item,
                                    `${key}-li-${i}`,
                                    linkStyle
                                )}
                            </li>
                        ))}
                    </ol>
                )
            }

            return (
                <div key={key} style={{ ...baseTextStyle, margin: "0.5em 0" }}>
                    {applyInlineFormatting(trimmed, `${key}-p`, linkStyle)}
                </div>
            )
        })
    })

    return <React.Fragment>{renderedSegments}</React.Fragment>
}

/**
 * PROJECT: Omegle for Mentorship
 * ORGANIZATION: Curastem (501(c)(3) non-profit)
 * DESCRIPTION: A real-time video platform connecting students with mentors.
 * Built as a Framer Code Component using PeerJS for WebRTC and MQTT for signaling.
 */

// --- CONFIGURATION CONSTANTS ---
// External libraries loaded via CDN to keep the Framer component self-contained.
const MQTT_SCRIPT = "https://unpkg.com/mqtt@4.3.7/dist/mqtt.min.js"
const PEER_SCRIPT = "https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js"

// Signaling server configuration
const MQTT_SERVER = "wss://broker.emqx.io:8084/mqtt"
const TOPIC_LOBBY = "framer-hybrid-lobby-v1"

// Upload limits
const MAX_UPLOAD_SIZE_MB = 10
const INLINE_MAX_BYTES = 2 * 1024 * 1024 // 2MB inline limit

// --- INTERFACES ---
interface Props {
    geminiApiKey: string
    systemPrompt: string
    accentColor: string
    model: string
    debugMode?: boolean
}

interface Attachment {
    id: string
    file: File
    type: 'image' | 'video' | 'file'
    previewUrl?: string
    name: string
    mimeType: string
}

interface Message {
    role: string
    text: string
    attachments?: {
        type: 'image' | 'video' | 'file'
        url?: string
        name?: string
        mimeType?: string
    }[]
}

interface FileAttachmentProps {
    name: string
    type: string
    onRemove?: () => void
}

function FileAttachment({ name, type, onRemove }: FileAttachmentProps) {
    const getIconColor = (fileName: string, fileType: string) => {
        const n = (fileName || "").toLowerCase()
        const t = (fileType || "").toLowerCase()
        if (n.endsWith('.pdf') || t.includes('pdf')) return "#EA4335"
        if (n.endsWith('.xls') || n.endsWith('.xlsx') || n.endsWith('.csv') || t.includes('excel') || t.includes('spreadsheet') || t.includes('csv')) return "#34A853"
        if (n.endsWith('.ppt') || n.endsWith('.pptx') || t.includes('presentation') || t.includes('powerpoint')) return "#FBBC04"
        return "#4285F4"
    }

    return (
        <div
            style={{
                width: 296,
                height: 56,
                padding: 0,
                position: "relative",
                background: "#3D3D3D",
                borderRadius: 14,
                justifyContent: "flex-start",
                alignItems: "center",
                display: "flex",
                overflow: "hidden"
            }}
        >
            <div style={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}>
                <svg width="100%" height="100%" viewBox="0 0 49 49" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0.8125 14.6777C0.8125 6.94575 7.08051 0.677734 14.8125 0.677734H48.8125V48.6777H14.8125C7.08051 48.6777 0.8125 42.4097 0.8125 34.6777V14.6777Z" 
                        fill={getIconColor(name, type)}
                    />
                    <path d="M15.8125 17.6777C15.8125 17.1254 16.2602 16.6777 16.8125 16.6777H32.8125C33.3648 16.6777 33.8125 17.1254 33.8125 17.6777C33.8125 18.23 33.3648 18.6777 32.8125 18.6777H16.8125C16.2602 18.6777 15.8125 18.23 15.8125 17.6777ZM15.8125 24.6777C15.8125 24.1254 16.2602 23.6777 16.8125 23.6777H32.8125C33.3648 23.6777 33.8125 24.1254 33.8125 24.6777C33.8125 25.23 33.3648 25.6777 32.8125 25.6777H16.8125C16.2602 25.6777 15.8125 25.23 15.8125 24.6777ZM15.8125 31.6777C15.8125 31.1255 16.2602 30.6777 16.8125 30.6777H23.8125C24.3648 30.6777 24.8125 31.1255 24.8125 31.6777C24.8125 32.23 24.3648 32.6777 23.8125 32.6777H16.8125C16.2602 32.6777 15.8125 32.23 15.8125 31.6777Z" fill="white" fillOpacity="0.95"/>
                    <path d="M23.8125 30.5127C33.4559 23.5127 33.9775 24.0343 33.9775 24.6777C33.9775 25.3211 33.4559 25.8428 32.8125 25.8428H16.8125C16.1691 25.8428 15.6475 25.3211 15.6475 24.6777C15.6475 24.0343 16.1691 23.5127 16.8125 23.5127H32.8125ZM32.8125 23.5127C33.4559 23.5127 33.9775 24.0343 33.9775 24.6777C33.9775 25.3211 33.4559 25.8428 32.8125 25.8428H16.8125C16.1691 25.8428 15.6475 25.3211 15.6475 24.6777C15.6475 24.0343 16.1691 23.5127 16.8125 23.5127H32.8125ZM32.8125 16.5127C33.4559 16.5127 33.9775 17.0343 33.9775 17.6777C33.9775 18.3211 33.4559 18.8428 32.8125 18.8428H16.8125C16.1691 18.8428 15.6475 18.3211 15.6475 17.6777C15.6475 17.0343 16.1691 16.5127 16.8125 16.5127H32.8125Z" stroke="white" strokeOpacity="0.95" strokeWidth="0.33"/>
                </svg>
            </div>
            {onRemove && (
                <div
                    onClick={(e) => {
                        e.stopPropagation()
                        onRemove()
                    }}
                    style={{
                        position: "absolute",
                        right: 8,
                        top: 8,
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        background: "#F6F6F6",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        border: "none",
                        zIndex: 10
                    }}
                >
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 1L9 9M9 1L1 9" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                </div>
            )}
            <div style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "flex-start",
                overflow: "hidden",
                flex: 1,
                paddingLeft: 12,
                paddingRight: 12,
                gap: 2
            }}>
                <div style={{
                    color: "rgba(255, 255, 255, 0.95)",
                    fontSize: 13,
                    fontFamily: "Inter",
                    fontWeight: 500,
                    lineHeight: "16px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    width: "100%",
                    maxWidth: 190
                }}>
                    {name}
                </div>
                <div style={{
                    color: "rgba(255, 255, 255, 0.65)",
                    fontSize: 11,
                    fontFamily: "Inter",
                    fontWeight: 400,
                    lineHeight: "14px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    width: "100%",
                }}>
                    {name.split('.').pop()?.toUpperCase() || 'FILE'}
                </div>
            </div>
        </div>
    )
}

// --- HELPER COMPONENT: VIDEO PLAYER ---
function VideoPlayer({ 
    stream, 
    isMirrored = false, 
    style = {}, 
    muted = false,
    onVideoSize
}: { 
    stream: MediaStream | null, 
    isMirrored?: boolean, 
    style?: React.CSSProperties, 
    muted?: boolean,
    onVideoSize?: (width: number, height: number) => void
}) {
    const videoRef = React.useRef<HTMLVideoElement>(null)
    
    React.useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream
        } else if (videoRef.current) {
            videoRef.current.srcObject = null
        }
    }, [stream])
    
    // Monitor video dimensions
    React.useEffect(() => {
        const video = videoRef.current
        if (!video || !onVideoSize) return

        const handleResize = () => {
            if (video.videoWidth && video.videoHeight) {
                onVideoSize(video.videoWidth, video.videoHeight)
            }
        }

        video.addEventListener("loadedmetadata", handleResize)
        video.addEventListener("resize", handleResize)
        
        // Polling in case resize event doesn't fire on stream changes
        const interval = setInterval(handleResize, 1000)

        return () => {
            video.removeEventListener("loadedmetadata", handleResize)
            video.removeEventListener("resize", handleResize)
            clearInterval(interval)
        }
    }, [stream, onVideoSize])

    return (
        <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted={muted} 
            style={{ 
                width: "100%", 
                height: "100%", 
                objectFit: "cover", 
                transform: isMirrored ? "scaleX(-1)" : "none", 
                backgroundColor: "#000",
                ...style 
            }} 
        />
    )
}

// --- HELPER COMPONENT: CHAT INPUT BAR ---
interface ChatInputProps {
    value: string
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    onSend: () => void
    onStop?: () => void
    onEndCall: () => void
    onFileSelect: () => void
    onScreenShare?: () => void
    onReport?: () => void
    placeholder?: string
    showEndCall?: boolean
    attachments: Attachment[]
    onRemoveAttachment: (id: string) => void
    isLoading?: boolean
    isScreenSharing?: boolean
}

function ChatInput({ 
    value, 
    onChange, 
    onSend, 
    onStop,
    onEndCall, 
    onFileSelect, 
    onScreenShare,
    onReport,
    placeholder = "Ask anything", 
    showEndCall = true,
    attachments = [],
    onRemoveAttachment,
    isLoading = false,
    isScreenSharing = false
}: ChatInputProps) {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const [showMenu, setShowMenu] = React.useState(false)
    const menuRef = React.useRef<HTMLDivElement>(null)
    const [canShareScreen, setCanShareScreen] = React.useState(false)

    React.useEffect(() => {
        // Check if screen sharing is supported
        // @ts-ignore
        if (typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
            setCanShareScreen(true)
        }
    }, [])

    // Auto-resize logic to mimic Gemini's behavior
    React.useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "24px" // Reset to calculate correct scrollHeight
            const scrollHeight = textareaRef.current.scrollHeight
            // Expand up to ~148px (approx 6 lines)
            textareaRef.current.style.height = Math.min(scrollHeight, 148) + "px"
        }
    }, [value])

    // Close menu when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                // Check if the click was on the upload button (to prevent immediate toggle off)
                const uploadBtn = document.getElementById("upload-trigger-btn")
                if (uploadBtn && uploadBtn.contains(event.target as Node)) {
                    return
                }
                setShowMenu(false)
            }
        }
        if (showMenu) {
            document.addEventListener("mousedown", handleClickOutside)
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside)
        }
    }, [showMenu])

    const hasContent = value.trim() || attachments.length > 0

    return (
        <div data-layer="flexbox" className="Flexbox" style={{width: '100%', maxWidth: 728, position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 0, paddingLeft: 24, paddingRight: 24, boxSizing: "border-box", pointerEvents: "auto"}}>
            {/* CONVERSATION ACTIONS MENU */}
            {showMenu && (
                <div ref={menuRef} style={{ position: "absolute", bottom: "100%", left: 28, marginBottom: -28, zIndex: 100 }}>
                    <div data-layer="conversation actions" className="ConversationActions" style={{width: 196, padding: 10, background: '#353535', boxShadow: '0px 4px 24px rgba(0, 0, 0, 0.08)', borderRadius: 28, outline: '0.33px rgba(255, 255, 255, 0.10) solid', outlineOffset: '-0.33px', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'flex-start', gap: 4, display: 'inline-flex'}}>
                        
                        {/* Add files & photos */}
                        <div 
                            data-layer="add files/photos" 
                            className="AddFilesPhotos" 
                            onClick={(e) => {
                                e.stopPropagation()
                                onFileSelect()
                                setShowMenu(false)
                            }}
                            style={{alignSelf: 'stretch', height: 36, paddingLeft: 10, paddingRight: 10, borderRadius: 28, justifyContent: 'flex-start', alignItems: 'center', gap: 12, display: 'inline-flex', cursor: "pointer", transition: "background 0.2s"}}
                            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.12)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        >
                            <div data-svg-wrapper data-layer="center icon flexbox..." className="CenterIconFlexbox" style={{width: 15, display: "flex", justifyContent: "center"}}>
                                <svg width="15" height="20" viewBox="0 0 15 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1.93164 5.93275L2.06777 13.2728C2.19283 20.22 13.1986 20.7001 13.069 13.4695L12.9062 4.36756C12.8215 -0.346883 5.35316 -0.672557 5.4411 4.23404L5.60198 13.205C5.64692 15.686 9.5765 15.8573 9.5309 13.2754L9.37197 5.84873" stroke="white" strokeWidth="1.38172" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </div>
                            <div data-layer="Add files & photos..." className="AddFilesPhotosText" style={{flex: '1 1 0', justifyContent: 'center', display: 'flex', flexDirection: 'column', color: 'white', fontSize: 14, fontFamily: 'Inter', fontWeight: '400', lineHeight: "19.32px", wordWrap: 'break-word'}}>Add files & photos</div>
                        </div>

                        {/* Share screen */}
                        {canShareScreen && (
                            <div 
                                data-layer="share screen" 
                                className="ShareScreen" 
                                onClick={(e) => {
                                    e.stopPropagation()
                                    if (onScreenShare) onScreenShare()
                                    setShowMenu(false)
                                }}
                                style={{alignSelf: 'stretch', height: 36, paddingLeft: 10, paddingRight: 10, background: isScreenSharing ? 'rgba(255, 255, 255, 0.2)' : 'transparent', borderRadius: 28, justifyContent: 'flex-start', alignItems: 'center', gap: 12, display: 'inline-flex', cursor: "pointer", transition: "background 0.2s"}}
                                onMouseEnter={(e) => !isScreenSharing && (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
                                onMouseLeave={(e) => !isScreenSharing && (e.currentTarget.style.background = "transparent")}
                            >
                                <div data-svg-wrapper data-layer="share icon" className="ShareIcon">
                                    <svg width="17" height="16" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M0.703125 11.4881V12.4219C0.703125 13.1678 0.999441 13.8832 1.52689 14.4106C2.05433 14.9381 2.7697 15.2344 3.51562 15.2344H12.8906C13.6365 15.2344 14.3519 14.9381 14.8794 14.4106C15.4068 13.8832 15.7031 13.1678 15.7031 12.4219V11.4844M8.20312 11.0156V0.703125M8.20312 0.703125L11.4844 3.98438M8.20312 0.703125L4.92188 3.98438" stroke="white" strokeWidth="1.40625" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                </div>
                                <div data-layer="Share screen..." className="ShareScreenText" style={{flex: '1 1 0', justifyContent: 'center', display: 'flex', flexDirection: 'column', color: 'white', fontSize: 14, fontFamily: 'Inter', fontWeight: '400', lineHeight: "19.32px", wordWrap: 'break-word'}}>
                                    {isScreenSharing ? "Stop sharing" : "Share screen"}
                                </div>
                            </div>
                        )}

                        <div data-layer="separator" className="Separator" style={{alignSelf: 'stretch', marginLeft: 4, marginRight: 4, height: 1, position: 'relative', background: 'rgba(255, 255, 255, 0.10)', borderRadius: 4}} />

                        {/* Report */}
                        <div 
                            data-layer="report." 
                            className="Report" 
                            onClick={(e) => {
                                e.stopPropagation()
                                if (onReport) onReport()
                                setShowMenu(false)
                            }}
                            style={{alignSelf: 'stretch', height: 36, paddingLeft: 10, paddingRight: 10, borderRadius: 28, justifyContent: 'flex-start', alignItems: 'center', gap: 12, display: 'inline-flex', cursor: "pointer", transition: "background 0.2s"}}
                            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(251, 106, 106, 0.12)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        >
                            <div data-svg-wrapper data-layer="flag icon" className="FlagIcon">
                                <svg width="17" height="19" viewBox="0 0 17 19" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M0.703125 17.5785V12.5976M0.703125 12.5976C6.1575 8.33194 10.2488 16.8632 15.7031 12.5976V1.93444C10.2488 6.20007 6.1575 -2.33118 0.703125 1.93444V12.5976Z" stroke="#FB6A6A" strokeOpacity="0.95" strokeWidth="1.40625" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </div>
                            <div data-layer="Report..." className="ReportText" style={{flex: '1 1 0', justifyContent: 'center', display: 'flex', flexDirection: 'column', color: 'rgba(251.18, 105.83, 105.83, 0.95)', fontSize: 14, fontFamily: 'Inter', fontWeight: '400', lineHeight: "19.32px", wordWrap: 'break-word'}}>Report</div>
                        </div>

                    </div>
                </div>
            )}

          <div data-layer="overlay" className="Overlay" style={{width: "100%", padding: "24px 0 16px 0", background: 'linear-gradient(180deg, rgba(33, 33, 33, 0) 0%, #212121 35%)', justifyContent: 'center', alignItems: 'flex-end', gap: 10, display: 'flex'}}>
            
            {/* INPUT BOX */}
            <div data-layer="input-box" className="InputBox" style={{
                flex: '1 1 0', 
                minHeight: 56, 
                maxHeight: 384, 
                padding: 10, 
                background: '#303030', 
                overflow: 'visible',
                borderRadius: 28, 
                display: 'flex', 
                flexDirection: 'column', // Stack attachments above input row
                justifyContent: 'flex-end',
                gap: 16,
                pointerEvents: "auto"
            }}>
              
              {/* ATTACHMENTS ROW */}
              {attachments.length > 0 && (
                  <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      width: '100%'
                  }}>
                      {attachments.map((att) => (
                          <React.Fragment key={att.id}>
                              {att.type === 'image' || att.type === 'video' ? (
                                <div style={{
                                    position: 'relative',
                                    width: 56,
                                    height: 56,
                                    flexShrink: 0,
                                    borderRadius: 12, 
                                    overflow: 'hidden',
                                    display: 'flex',
                                    background: 'transparent',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    {/* Remove Button */}
                                    <div 
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            if(onRemoveAttachment) onRemoveAttachment(att.id)
                                        }}
                                        style={{
                                            position: "absolute",
                                            right: 3,
                                            top: 3,
                                            width: 18,
                                            height: 18,
                                            borderRadius: 9,
                                            background: "#FFFFFF", 
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            cursor: "pointer",
                                            border: "none",
                                            zIndex: 10
                                        }}
                                    >
                                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M1 1L9 9M9 1L1 9" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    </div>

                                    {/* Thumbnail / Icon */}
                                    {att.previewUrl && (
                                        <img 
                                            src={att.previewUrl} 
                                            alt={att.name}
                                            style={{
                                                width: 56,
                                                height: 56,
                                                borderRadius: 12,
                                                objectFit: 'cover',
                                                display: 'block'
                                            }}
                                        />
                                    )}
                                </div>
                              ) : (
                                   <FileAttachment 
                                        name={att.name} 
                                        type={att.mimeType} 
                                        onRemove={() => onRemoveAttachment && onRemoveAttachment(att.id)}
                                   />
                              )}
                          </React.Fragment>
                      ))}
                  </div>
              )}

              {/* INPUT ROW: [Plus] [Text] [Send] */}
              <div style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 12,
                  width: '100%'
              }}>
                  {/* UPLOAD ICON (Now toggles Menu) */}
                  <div 
                    id="upload-trigger-btn"
                    data-svg-wrapper 
                    data-layer="upload-button" 
                    className="UploadButton" 
                    onClick={(e) => {
                        e.stopPropagation()
                        if (attachments.length < 10) {
                             setShowMenu(prev => !prev)
                        }
                    }}
                    style={{
                      cursor: (attachments.length >= 10) ? "not-allowed" : "pointer", 
                      opacity: (attachments.length >= 10) ? 0.3 : 0.65,
                      pointerEvents: (attachments.length >= 10) ? "none" : "auto",
                      width: 36,
                      height: 36,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 0 // Aligned with send button
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 5V19M5 12H19" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>

                  {/* TEXT INPUT */}
                  <div data-layer="textarea-wrapper" className="TextAreaWrapper" style={{flex: '1 1 0', alignSelf: 'stretch', display: 'flex', alignItems: 'center', paddingTop: 6, paddingBottom: 6}}>
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={onChange}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault()
                                if (hasContent && !isLoading) onSend()
                            }
                        }}
                        placeholder={placeholder}
                        disabled={false}
                        className="ChatTextInput" 
                        style={{
                            flex: '1 1 0', 
                            color: 'white', 
                            fontSize: 16, 
                            fontFamily: 'Inter', 
                            fontWeight: '400', 
                            lineHeight: '24px', 
                            background: 'transparent', 
                            border: 'none', 
                            outline: 'none', 
                            resize: 'none',
                            height: 24,
                            padding: 0, 
                            margin: 0,
                            width: '100%'
                        }}
                    />
                  </div>

                  {/* SEND / STOP BUTTON */}
                  <div 
                    data-svg-wrapper 
                    data-layer="send-button" 
                    className="SendButton" 
                    onClick={() => {
                        if (isLoading && onStop) {
                            onStop()
                        } else if (hasContent) {
                            onSend()
                        }
                    }}
                    style={{
                      cursor: "pointer", 
                      display: hasContent ? "block" : "none",
                      opacity: 1,
                      width: 36,
                      height: 36
                    }}
                  >
                    {isLoading ? (
                        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect width="36" height="36" rx="18" fill="white" fillOpacity="0.95"/>
                            <rect x="12" y="12" width="12" height="12" rx="2" fill="black" fillOpacity="0.95"/>
                        </svg>
                    ) : (
                        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect width="36" height="36" rx="18" fill="white" fillOpacity="0.95"/>
                            <path fillRule="evenodd" clipRule="evenodd" d="M14.5611 18.1299L16.8709 15.8202V23.3716C16.8709 23.9948 17.3762 24.5 17.9994 24.5C18.6226 24.5 19.1278 23.9948 19.1278 23.3716V15.8202L21.4375 18.1299C21.8782 18.5706 22.5927 18.5706 23.0334 18.1299C23.4741 17.6893 23.4741 16.9748 23.0334 16.5341L17.9994 11.5L12.9653 16.5341C12.5246 16.9748 12.5246 17.6893 12.9653 18.1299C13.406 18.5706 14.1204 18.5706 14.5611 18.1299Z" fill="black" fillOpacity="0.95"/>
                        </svg>
                    )}
                  </div>
              </div>

            </div>

            {/* END CALL BUTTON */}
            {showEndCall && (
              <div data-svg-wrapper data-layer="end call button." className="EndCallButton" onClick={onEndCall} style={{cursor: "pointer", flexShrink: 0, pointerEvents: "auto"}}>
                <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="56" height="56" rx="28" fill="#EC1313"/>
                <g transform="translate(17.5, 23)">
                  <path fillRule="evenodd" clipRule="evenodd" d="M10.0238 6.15427e-07C13.4809 0.00106797 17.0396 1.07344 19.4144 3.07617L19.641 3.27246L19.8129 3.44531C20.193 3.86925 20.4321 4.44154 20.5619 5.01758C20.7128 5.68736 20.7333 6.43445 20.6117 7.12598C20.4913 7.81029 20.2208 8.49784 19.7377 8.99121C19.23 9.50959 18.5253 9.77083 17.6781 9.62598L17.6771 9.625C17.0576 9.51856 16.052 9.42599 15.2572 9.11231C14.8416 8.94822 14.4265 8.70597 14.1107 8.32715C13.7865 7.93804 13.6006 7.44499 13.5853 6.84863C13.5729 6.36452 13.2765 5.94847 12.6654 5.625C12.0488 5.29868 11.1923 5.11979 10.306 5.12305C9.41899 5.12637 8.57444 5.31144 7.97987 5.63867C7.39421 5.96113 7.12804 6.36719 7.14002 6.84082C7.15406 7.39768 6.99962 7.86763 6.71131 8.24805C6.43154 8.61707 6.05354 8.86532 5.67616 9.04199C5.29889 9.21854 4.88865 9.33849 4.51405 9.43359C4.30609 9.48639 4.1304 9.52723 3.9662 9.56543L3.48475 9.68359C2.6791 9.90064 1.96126 9.73436 1.39491 9.31055C0.850256 8.90287 0.482228 8.28739 0.264048 7.64648C0.0442707 7.00068 -0.0404776 6.28152 0.0179545 5.61035C0.0757894 4.94623 0.27954 4.27344 0.693736 3.76856L0.89979 3.52637C3.0747 1.06993 6.56949 -0.000937214 10.0238 6.15427e-07Z" fill="white" fillOpacity="0.95"/>
                </g>
                </svg>
              </div>
            )}

          </div>
        </div>
    )
}

// --- HELPER COMPONENT: DEBUG CONSOLE ---
function DebugConsole({ logs }: { logs: string[] }) {
    const scrollRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [logs])

    return (
        <div style={{
            position: "absolute",
            top: 10,
            left: 10,
            right: 10,
            height: 150,
            background: "rgba(0,0,0,0.8)",
            color: "#0f0",
            fontFamily: "monospace",
            fontSize: 12,
            padding: 8,
            overflowY: "auto",
            zIndex: 9999,
            pointerEvents: "none",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.2)"
        }} ref={scrollRef}>
            {logs.map((log, i) => (
                <div key={i} style={{ marginBottom: 4 }}>{log}</div>
            ))}
        </div>
    )
}

/**
 * OmegleMentorshipUI
 * Main component handling video streaming, real-time signaling, and AI-assisted chat.
 */
export default function OmegleMentorshipUI(props: Props) {
    const { geminiApiKey, systemPrompt, accentColor, model = "gemini-2.5-flash-lite", debugMode = false } = props

    // --- STATE: WEBRTC & CONNECTIVITY ---
    // status: tracks the lifecycle of the connection (idle -> searching -> connected)
    const [status, setStatus] = React.useState("idle")
    const [ready, setReady] = React.useState(false) // Tracks if external scripts are loaded
    const [isScreenSharing, setIsScreenSharing] = React.useState(false)
    const isScreenSharingRef = React.useRef(false)
    React.useEffect(() => { isScreenSharingRef.current = isScreenSharing }, [isScreenSharing])

    // --- STATE: DEBUGGING ---
    // Toggle this via the 'Debug Mode' property in Framer to see on-screen logs.
    // Useful for mobile debugging where browser console isn't easily accessible.
    const [logs, setLogs] = React.useState<string[]>([])
    
    // Helper for standardized console logging
    // Use this wrapper instead of console.log to ensure output appears in the UI debug console
    const log = (msg: string) => {
        console.log(`[Curastem Mentorship] ${msg}`)
        if (debugMode) {
            setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`])
        }
    }

    /**
     * User's session role.
     * student: "Get free help" user seeking guidance.
     * mentor:  "Volunteer" user providing guidance.
     */
    const [role, setRole] = React.useState<"student" | "mentor" | null>(null)
    const roleRef = React.useRef(role)
    React.useEffect(() => { roleRef.current = role }, [role])

    // --- REFS: DOM & PERSISTENT OBJECTS ---
    const [localStream, setLocalStream] = React.useState<MediaStream | null>(null)
    const [remoteStream, setRemoteStream] = React.useState<MediaStream | null>(null)
    const localStreamRef = React.useRef<MediaStream | null>(null) // Keep ref for PeerJS calls
    const screenStreamRef = React.useRef<MediaStream | null>(null)
    const remoteStreamRef = React.useRef<MediaStream | null>(null)
    const [remoteScreenStream, setRemoteScreenStream] = React.useState<MediaStream | null>(null)
    const screenCallRef = React.useRef<any>(null)
    const mqttClient = React.useRef<any>(null)
    const peerInstance = React.useRef<any>(null)
    const activeCall = React.useRef<any>(null)
    const statusRef = React.useRef(status)
    React.useEffect(() => { statusRef.current = status }, [status])
    
    // Unique session ID for the user
    const myId = React.useRef("user_" + Math.random().toString(36).substr(2, 6))

    // --- STATE: AI CHAT (GEMINI) ---
    const [messages, setMessages] = React.useState<Message[]>([])
    const [inputText, setInputText] = React.useState("")
    const [isLoading, setIsLoading] = React.useState(false)
    const abortControllerRef = React.useRef<AbortController | null>(null)

    // --- STATE: FILE UPLOADS ---
    const [attachments, setAttachments] = React.useState<Attachment[]>([])
    const fileInputRef = React.useRef<HTMLInputElement | null>(null)

    // --- STATE: RESPONSIVE UI ---
    // Initialize height from localStorage if available, else default to 300 (will be auto-sized for new users)
    const [chatHeight, setChatHeight] = React.useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("omeg_chat_height")
            if (saved) return Number(saved)
        }
        return 300
    })
    
    // Save height preference whenever it changes
    React.useEffect(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem("omeg_chat_height", String(chatHeight))
        }
    }, [chatHeight])

    const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 })
    const [sharedScreenSize, setSharedScreenSize] = React.useState<{ width: number, height: number } | null>(null)
    const isDragging = React.useRef(false)
    const dragStartY = React.useRef(0)
    const dragStartHeight = React.useRef(0)
    const containerRef = React.useRef<HTMLDivElement>(null)
    const rafRef = React.useRef<number | null>(null)
    const hasInitialResized = React.useRef(false)

    // Detect mobile for capture attribute
    const isMobile = React.useMemo(() => {
        if (typeof window === "undefined") return false
        return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    }, [])

    const generateVideoThumbnail = async (file: File): Promise<string> => {
        return new Promise((resolve) => {
            try {
                const url = URL.createObjectURL(file)
                const video = document.createElement("video")
                video.src = url
                video.muted = true
                video.playsInline = true as any
                const capture = () => {
                    const canvas = document.createElement("canvas")
                    const w = 320
                    const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w))
                    canvas.width = w
                    canvas.height = h
                    const ctx = canvas.getContext("2d")
                    if (ctx) {
                        ctx.drawImage(video, 0, 0, w, h)
                        const dataUrl = canvas.toDataURL("image/jpeg", 0.8)
                        try { URL.revokeObjectURL(url) } catch {}
                        resolve(dataUrl)
                    } else {
                        resolve("")
                    }
                }
                video.onloadedmetadata = () => { video.currentTime = 1.0 }
                video.onseeked = () => capture()
                video.onerror = () => {
                    try { URL.revokeObjectURL(url) } catch {}
                    resolve("")
                }
            } catch {
                resolve("")
            }
        })
    }

    // --- EFFECT: RESPONSIVE LAYOUT ENGINE ---
    // Uses ResizeObserver to track container dimensions for aspect-ratio calculations.
    React.useLayoutEffect(() => {
        if (!containerRef.current) return
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerSize({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height
                })
            }
        })
        observer.observe(containerRef.current)
        return () => observer.disconnect()
    }, [])

    // --- EFFECT: CALCULATE MAXIMUM CHAT HEIGHT ---
    // For new users (no localStorage history), maximize chat height so videos/cards are at the top.
    React.useEffect(() => {
        if (containerSize.width === 0 || containerSize.height === 0) return
        
        // Check if we already have a saved preference (Returning User)
        const hasSavedPreference = typeof window !== "undefined" && localStorage.getItem("omeg_chat_height")
        
        if (hasSavedPreference || hasInitialResized.current) return

        const isMobile = containerSize.width < 768
        
        // Calculate item dimensions based on available width
        const availableWidth = isMobile 
            ? (containerSize.width - 32) 
            : (containerSize.width - 32 - 8) / 2
        const targetRatio = 1.55
        const itemHeight = availableWidth / targetRatio
        
        // Calculate total item area height
        const totalItemHeight = isMobile 
            ? (itemHeight * 2) + 8  // 2 items stacked with 8px gap
            : itemHeight              // items side by side
        
        // Calculate maximum chat height
        // Total height - top padding - item height - drag bar height
        const maxChatHeight = containerSize.height - 16 - totalItemHeight - 24
        
        // Auto-maximize for new users
        setChatHeight(Math.max(100, maxChatHeight))
        hasInitialResized.current = true
        
    }, [containerSize])

    const handleRoleSelect = (selectedRole: "student" | "mentor") => {
        if (typeof window !== "undefined") {
            window.location.hash = `#${selectedRole}`
        }
        setRole(selectedRole)
        // Removed setChatHeight(300) to persist user preference
    }

    // --- EFFECT: DETECT URL HASH AND SET ROLE ---
    /**
     * Synchronizes internal role state with the URL hash on mount.
     * #student -> Set as seeker/student.
     * #mentor  -> Set as volunteer/mentor.
     */
    React.useEffect(() => {
        if (typeof window === "undefined") return
        
        const hash = window.location.hash.toLowerCase()
        if (hash === "#student") { // student = get free help
            setRole("student")
            log("Auto-detected role: Student")
        } else if (hash === "#mentor") { // mentor = volunteer
            setRole("mentor")
            log("Auto-detected role: Mentor")
        }
    }, [])

    // --- EFFECT: AUTO-START WHEN ROLE IS DETECTED ---
    /**
     * Automatically triggers the camera and matching process once a role
     * has been assigned (via URL hash or manual selection).
     */
    React.useEffect(() => {
        if (role && ready && status === "idle") {
            log(`Auto-starting as ${role}...`)
            startChat()
        }
    }, [role, ready])

    // --- EFFECT: INITIALIZATION ---
    // Loads required external dependencies and handles component teardown.
    React.useEffect(() => {
        const loadDependencies = async () => {
            // @ts-ignore - window.mqtt and window.Peer are added via script tags
            if (!window.mqtt || !window.Peer) {
                await loadScript(MQTT_SCRIPT)
                await loadScript(PEER_SCRIPT)
            }
            setReady(true)
            log("System initialized and ready.")
        }
        loadDependencies()
        return () => cleanup()
    }, [])

    /**
     * Dynamically injects a script tag into the document head.
     */
    const loadScript = (src: string) => {
        return new Promise((resolve) => {
            const s = document.createElement("script")
            s.src = src
            s.onload = resolve
            document.body.appendChild(s)
        })
    }

    /**
     * Resets all connections and stops media tracks.
     */
    const cleanup = () => {
        if (localStreamRef.current)
            localStreamRef.current.getTracks().forEach((t) => t.stop())
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach((t) => t.stop())
            screenStreamRef.current = null
        }
        if (activeCall.current) activeCall.current.close()
        if (screenCallRef.current) {
            screenCallRef.current.close()
            screenCallRef.current = null
        }
        if (peerInstance.current) peerInstance.current.destroy()
        if (mqttClient.current) mqttClient.current.end()
        setStatus("idle")
        setRole(null)
        setIsScreenSharing(false)
        setLocalStream(null)
        setRemoteStream(null)
        setRemoteScreenStream(null)
        if (typeof window !== "undefined") {
            window.location.hash = ""
        }
    }

    // --- SCREEN SHARING LOGIC ---
    
    const toggleScreenShare = async () => {
        if (isScreenSharing) {
            // STOP SHARING
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(t => t.stop())
                screenStreamRef.current = null
            }
            if (screenCallRef.current) {
                screenCallRef.current.close()
                screenCallRef.current = null
            }
            setIsScreenSharing(false)
        } else {
            // START SHARING
            try {
                // Check if screen sharing is supported
                // @ts-ignore
                if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                    alert("Screen sharing is not supported on this device or browser.")
                    return
                }

                // @ts-ignore
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                    video: true,
                    audio: false // Screen audio is tricky on mobile, keeping it simple for now
                })
                screenStreamRef.current = screenStream
                const screenTrack = screenStream.getVideoTracks()[0]

                // Handle system stop (e.g. browser "Stop sharing" button)
                screenTrack.onended = () => {
                     setIsScreenSharing(false)
                     screenStreamRef.current = null
                     if (screenCallRef.current) {
                        screenCallRef.current.close()
                        screenCallRef.current = null
                     }
                }

                // If connected, start a second call for the screen
                if (activeCall.current && activeCall.current.peer) {
                     // PeerJS call object has .peer property which is the remote ID
                     const peerId = activeCall.current.peer
                     log(`Starting screen share call to ${peerId}...`)
                     const call = peerInstance.current.call(peerId, screenStream, {
                        metadata: { type: 'screen' }
                     })
                     call.on('error', (err: any) => log(`Sender Screen Call Error: ${err}`))
                     screenCallRef.current = call
                }
                
                setIsScreenSharing(true)
            } catch (err: any) {
                console.error("Screen share error:", err)
                if (err.name === 'NotAllowedError') {
                    // User cancelled or permission denied
                } else {
                    alert(`Screen share failed: ${err.message || err}`)
                }
            }
        }
    }

    const handleReport = () => {
        // Just close the menu for now
        // alert("Report feature is not yet implemented.")
    }

    const getCurrentStream = () => {
        // Deprecated helper in favor of dual-call strategy
        return localStreamRef.current
    }

    // --- WEBRTC CORE LOGIC ---

    /**
     * Initializes the user's camera/microphone and starts the PeerJS session.
     */
    const startChat = async () => {
        if (!role) {
            log("Cannot start chat without a role.")
            return
        }
        setStatus("searching")
        log("Requesting media permissions...")

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
            })
            localStreamRef.current = stream
            setLocalStream(stream)

            initPeerJS()
        } catch (err: any) {
            log(`Media Error: ${err.message}`)
            setStatus("idle")
        }
    }

    /**
     * Initializes PeerJS for P2P video communication.
     */
    const initPeerJS = () => {
        log("Establishing PeerJS connection...")
        // @ts-ignore
        const peer = new window.Peer(myId.current, {
            config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
        })
        peerInstance.current = peer

        peer.on("open", (id: string) => {
            log(`P2P Identity assigned: ${id}`)
            initMQTT() // Start looking for partners after P2P is ready
        })

        peer.on("call", (call: any) => {
            const incomingPeerId = call.peer
            const activePeerId = activeCall.current?.peer

            // Check for screen share metadata OR if we are already connected to this peer (assume secondary stream)
            // Note: Mobile browsers might strip metadata or handle connections differently, so we also rely on ID matching.
            const isScreenShare = 
                (call.metadata && call.metadata.type === 'screen') || 
                (statusRef.current === "connected" && incomingPeerId && activePeerId && incomingPeerId === activePeerId)

            if (isScreenShare) {
                log(`Incoming SCREEN SHARE detected from ${incomingPeerId} (Metadata: ${JSON.stringify(call.metadata)})`)
                call.answer() // Answer without sending a stream back
                
                call.on("stream", (remoteStream: any) => {
                    log("Screen share stream received")
                    setRemoteScreenStream(remoteStream)
                })
                call.on("close", () => {
                    log("Screen share ended")
                    setRemoteScreenStream(null)
                })
                call.on("error", (e: any) => log(`Screen Call Error: ${e}`))
                return
            }

            if (statusRef.current === "connected") {
                log(`Rejecting incoming call from ${incomingPeerId} while connected to ${activePeerId}`)
                return
            }
            
            log("Incoming call detected. Auto-answering...")
            call.answer(localStreamRef.current)
            handleCall(call)
        })

        peer.on("error", (e: any) => log(`P2P Error: ${e.type}`))
    }

    /**
     * Configures the active P2P call and handles media streams.
     */
    const handleCall = (call: any) => {
        activeCall.current = call
        setStatus("connected")
        if (mqttClient.current) mqttClient.current.end() // Stop signaling once connected

        call.on("stream", (remoteStreamIn: any) => {
            log("Remote stream received. Synchronizing video...")
            remoteStreamRef.current = remoteStreamIn
            setRemoteStream(remoteStreamIn)
        })

        call.on("close", () => {
            log("Session terminated by remote peer.")
            cleanup()
        })
    }

    /**
     * Initializes MQTT signaling for the matchmaking lobby.
     */
    const initMQTT = () => {
        log("Connecting to matchmaking lobby...")
        // @ts-ignore
        const client = window.mqtt.connect(MQTT_SERVER)
        mqttClient.current = client

        client.on("connect", () => {
            log(`Connected to lobby as ${roleRef.current || "unspecified"}. Searching for ${roleRef.current === "student" ? "mentor" : roleRef.current === "mentor" ? "student" : "partner"}...`)
            client.subscribe(TOPIC_LOBBY)

            // Periodic heartbeat to broadcast presence to other users
            const heartbeat = setInterval(() => {
                if (statusRef.current === "connected" || !client.connected) {
                    clearInterval(heartbeat)
                    return
                }
                client.publish(
                    TOPIC_LOBBY,
                    JSON.stringify({ 
                        id: myId.current,
                        role: roleRef.current // Include role in broadcast
                    })
                )
            }, 2000)
        })

        client.on("message", (topic: string, msg: any) => {
            if (statusRef.current === "connected") return

            const data = JSON.parse(msg.toString())
            if (data.id === myId.current) return

            // Role-based matching: only connect with opposite roles
            const currentRole = roleRef.current
            if (currentRole) {
                if (!data.role) {
                    log(`Skipping peer ${data.id} (peer has no role)`)
                    return
                }
                const oppositeRole = currentRole === "student" ? "mentor" : "student"
                if (data.role !== oppositeRole) {
                    log(`Skipping peer ${data.id} (incompatible role: ${data.role})`)
                    return
                }
            }

            // Simple deterministic handshake: user with lexicographically larger ID initiates the call
            if (myId.current > data.id) {
                log(`Handshaking with ${data.role || "peer"}: ${data.id}`)
                const call = peerInstance.current.call(
                    data.id,
                    localStreamRef.current
                )
                handleCall(call)
            } else {
                log(`Waiting for handshake from ${data.role || "peer"}: ${data.id}`)
            }
        })
    }

    // --- FILE UPLOAD HANDLERS ---

    const handleFileSelect = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click()
        }
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files: File[] = Array.from(e.target.files || [])
        if (files.length === 0) return

        if (attachments.length + files.length > 10) {
            alert("Maximum 10 attachments allowed.")
            if (fileInputRef.current) fileInputRef.current.value = ""
            return
        }

        const newAttachments: Attachment[] = []

        for (const file of files) {
            if (file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
                alert(`File ${file.name} exceeds ${MAX_UPLOAD_SIZE_MB}MB limit.`)
                continue
            }

            const id = Math.random().toString(36).substr(2, 9)
            const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file"
            
            let previewUrl = ""
            if (type === "image") {
                previewUrl = URL.createObjectURL(file)
            }

            newAttachments.push({
                id,
                file,
                type,
                previewUrl,
                name: file.name,
                mimeType: file.type
            })
        }
        
        setAttachments(prev => [...prev, ...newAttachments])
        
        if (fileInputRef.current) fileInputRef.current.value = ""
        
        // Handle video thumbnails
        newAttachments.forEach(att => {
            if (att.type === 'video') {
                generateVideoThumbnail(att.file).then(url => {
                    setAttachments(prev => prev.map(p => p.id === att.id ? { ...p, previewUrl: url } : p))
                })
            }
        })
    }

    const handleRemoveAttachment = (id: string) => {
        setAttachments(prev => {
            const att = prev.find(a => a.id === id)
            if (att && att.previewUrl && att.type === 'image') {
                URL.revokeObjectURL(att.previewUrl)
            }
            return prev.filter(a => a.id !== id)
        })
        if (fileInputRef.current) fileInputRef.current.value = ""
    }

    // --- AI CHAT (GEMINI) LOGIC ---
    
    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
        }
        setIsLoading(false)
    }

    /**
     * Handles message delivery to the Google Gemini API.
     */
    const handleSendMessage = async () => {
        if (!inputText.trim() && attachments.length === 0) return
        if (!geminiApiKey) {
            setMessages(prev => [...prev, { role: "model", text: "Please provide a Gemini API Key in the properties panel." }])
            return
        }

        const textToSend = inputText
        const attachmentsToSend = [...attachments]

        // Build user message for display
        const userMsg: Message = { 
            role: "user", 
            text: textToSend,
            attachments: attachmentsToSend.map(a => ({
                type: a.type,
                url: a.previewUrl, // For images/videos
                name: a.name,
                mimeType: a.mimeType
            }))
        }
        setMessages(prev => [...prev, userMsg])
        setInputText("")
        setAttachments([])
        if (fileInputRef.current) fileInputRef.current.value = ""
        setIsLoading(true)

        // Abort previous if any
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        const controller = new AbortController()
        abortControllerRef.current = controller

        try {
            // Build API payload
            let userContent: any = []

            if (textToSend.trim()) {
                userContent.push({ text: textToSend })
            }

            for (const att of attachmentsToSend) {
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader()
                    reader.onload = () => {
                        const result = reader.result as string
                        resolve(result.substring(result.indexOf(",") + 1))
                    }
                    reader.onerror = reject
                    reader.readAsDataURL(att.file)
                })

                userContent.push({
                    inlineData: {
                        mimeType: att.file.type || "application/octet-stream",
                        data: base64
                    }
                })
            }

            // Construct conversation history
            const history = messages.map(m => ({
                role: m.role === "user" ? "user" : "model",
                parts: [{ text: m.text }]
            }))

            const payload: any = {
                contents: [
                    ...history,
                    { role: "user", parts: userContent }
                ]
            }

            // Add system instruction if present
            if (systemPrompt.trim()) {
                payload.systemInstruction = {
                    parts: [{ text: systemPrompt }]
                }
            }

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                }
            )

            const data = await response.json()
            
            if (!response.ok) {
                const errorMsg = data?.error?.message || response.statusText
                console.error("Gemini API Error:", data)
                setMessages(prev => [...prev, { role: "model", text: `Error: ${errorMsg}` }])
                return
            }

            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                const aiText = data.candidates[0].content.parts[0].text
                setMessages(prev => [...prev, { role: "model", text: aiText }])
            } else {
                setMessages(prev => [...prev, { role: "model", text: "Error: No response from Gemini." }])
            }
        } catch (error: any) {
            if (error.name === 'AbortError') {
                return // Request cancelled
            }
            console.error("Network Error:", error)
            setMessages(prev => [...prev, { role: "model", text: `Error connecting to Gemini: ${error.message}` }])
        } finally {
            setIsLoading(false)
            abortControllerRef.current = null
        }
    }

    // --- DRAG-TO-RESIZE LOGIC ---

    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault()
        isDragging.current = true
        dragStartY.current = e.clientY
        dragStartHeight.current = chatHeight
        
        window.addEventListener("pointermove", handlePointerMove)
        window.addEventListener("pointerup", handlePointerUp)
    }

    const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging.current) return
        e.preventDefault()

        // Batch updates into animation frames for 60fps performance
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        
        rafRef.current = requestAnimationFrame(() => {
            const deltaY = dragStartY.current - e.clientY
            const newHeight = dragStartHeight.current + deltaY
            
            const containerHeight = containerRef.current?.clientHeight || window.innerHeight
            const minHeight = 100 
            
            // Calculate dynamic max height based on content
            let maxHeight = containerHeight - 100 // Default: leave 100px for video

            // If screen sharing is active, constrain chat height more aggressively
            // to ensure video remains visible and usable
            if (isScreenSharing || !!remoteScreenStream) {
                const topRowHeight = isMobileLayout ? 100 : 140
                const chromeHeight = 24 + 16 + topRowHeight + 8 // Handle, Pads, TopRow, Gap
                const minVideoHeight = 200 // Ensure at least 200px vertical space for screen share
                maxHeight = containerHeight - chromeHeight - minVideoHeight
            }

            setChatHeight(Math.max(minHeight, Math.min(newHeight, maxHeight)))
        })
    }

    const handlePointerUp = () => {
        isDragging.current = false
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
    }

    // --- UI DIMENSION CALCULATIONS ---
    
    // Detect mobile vs desktop based on container width
    const isMobileLayout = containerSize.width < 768

    // Calculate dynamic size for screen share container to match aspect ratio
    const screenShareContainerStyle = React.useMemo(() => {
        if (!sharedScreenSize || containerSize.width === 0 || containerSize.height === 0) {
            return { flex: 1, width: "100%" }
        }

        // Available space calculation
        // Total Height - Chat - DragHandle(24) - Pads(Top 16 + Bottom 0) - TopRow(100/140) - Gap(8)
        const topRowHeight = isMobileLayout ? 100 : 140
        const chromeHeight = chatHeight + 24 + 16 + topRowHeight + 8
        const availableHeight = Math.max(100, containerSize.height - chromeHeight)
        const availableWidth = Math.max(100, containerSize.width - 32) // 16px padding on each side

        const videoRatio = sharedScreenSize.width / sharedScreenSize.height
        const containerRatio = availableWidth / availableHeight

        let finalW, finalH

        if (containerRatio > videoRatio) {
            // Container is wider than video -> constrain by height
            finalH = availableHeight
            finalW = availableHeight * videoRatio
        } else {
            // Container is taller than video -> constrain by width
            finalW = availableWidth
            finalH = availableWidth / videoRatio
        }

        return {
            width: finalW,
            height: finalH,
            flex: "none" // Disable flex growing to enforce size
        }
    }, [containerSize, chatHeight, isMobileLayout, sharedScreenSize])

    // Calculates the ideal dimensions for the video containers while preserving aspect ratio.
    const videoSectionHeight = containerSize.height - chatHeight - 40
    const targetRatio = 1.55
    
    let finalWidth = 0
    let finalHeight = 0
    
    if (isMobileLayout) {
        // MOBILE: Vertical layout - videos stacked, each takes full width
        const availableWidth = containerSize.width - 32 // 16px padding on each side
        const videoHeight = availableWidth / targetRatio
        const totalVideoHeight = (videoHeight * 2) + 8 // 2 videos + 8px gap
        
        if (totalVideoHeight <= videoSectionHeight) {
            // Videos fit at full width
            finalWidth = availableWidth
            finalHeight = videoHeight
        } else {
            // Scale down to fit height
            const scaledHeight = (videoSectionHeight - 8) / 2 // subtract gap, divide by 2 videos
            finalHeight = scaledHeight
            finalWidth = scaledHeight * targetRatio
        }
    } else {
        // DESKTOP: Horizontal layout - videos side by side
        const availableWidthPerVideo = (containerSize.width - 32 - 8) / 2 // padding + gap
        const widthByHeight = videoSectionHeight * targetRatio
        const heightByWidth = availableWidthPerVideo / targetRatio
        
        // Choose the bounding dimension to prevent overflow and maintain ratio
        if (containerSize.width > 0 && containerSize.height > 0) {
            if (widthByHeight <= availableWidthPerVideo) {
                 finalHeight = videoSectionHeight
                 finalWidth = widthByHeight
            } else {
                 finalWidth = availableWidthPerVideo
                 finalHeight = heightByWidth
            }
        }
    }

    // --- MARKDOWN STYLES ---
    const markdownStyles = `
        .chat-markdown-table {
            width: 100%;
            border-collapse: collapse;
            margin: 1em 0;
            font-size: 16px;
        }
        .chat-markdown-table th,
        .chat-markdown-table td {
            border-bottom: 1px solid rgba(255,255,255,0.1);
            padding: 8px 12px;
            text-align: left;
            color: rgba(255,255,255,0.95);
        }
        .chat-markdown-table th {
            font-weight: 600;
        }
        .chat-markdown-code-block {
            background: rgba(0,0,0,0.2);
            border: 1px solid rgba(255,255,255,0.1);
            color: rgba(255,255,255,0.9);
            padding: 12px;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
            font-size: 0.9em;
            margin: 1em 0;
            white-space: pre;
        }
        .chat-markdown-inline-code {
            background: rgba(255,255,255,0.1);
            padding: 2px 4px;
            border-radius: 4px;
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
            font-size: 0.9em;
            color: #FFD700;
        }
        .chat-markdown-blockquote {
            border-left: 4px solid ${accentColor};
            padding-left: 16px;
            margin: 1em 0;
            opacity: 0.8;
            font-style: italic;
        }
        .chat-markdown-hr {
            border: 0;
            height: 1px;
            background: rgba(255,255,255,0.1);
            margin: 1.5em 0;
        }
        @keyframes pulseStar {
            0% { opacity: 0.5; transform: scale(0.85); }
            50% { opacity: 1; transform: scale(1.0); }
            100% { opacity: 0.5; transform: scale(0.85); }
        }
    `

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                background: "#212121",
                color: "white",
                fontFamily: "Inter, sans-serif",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                position: "relative"
            }}
        >
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                style={{ display: "none" }}
                onChange={handleFileChange}
            />

            {/* DEBUG CONSOLE OVERLAY */}
            {debugMode && <DebugConsole logs={logs} />}

            {/* 1. CONTENT RENDERING LAYER (Unified for Cards & Videos) */}
            <style>{markdownStyles}</style>
            {(isScreenSharing || !!remoteScreenStream) ? (
                // --- SCREEN SHARE LAYOUT (FOCUS ON CONTENT) ---
                <div style={{
                    flex: "1 1 0",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8, // Reduced gap
                    paddingTop: 16, 
                    paddingLeft: 16,
                    paddingRight: 16,
                    paddingBottom: 0,
                    boxSizing: "border-box",
                    minHeight: 0,
                    alignItems: "center",
                    justifyContent: "flex-start" // Anchor cameras to top
                }}>
                    {/* TOP ROW: CAMERAS (Horizontal) */}
                    <div style={{
                        display: "flex",
                        gap: 8, // Reduced gap
                        height: isMobileLayout ? 100 : 140, 
                        width: "100%",
                        justifyContent: "center",
                        flexShrink: 0
                    }}>
                        {/* CAMERA 1: Left (Student Position) */}
                        <div style={{ 
                            height: "100%", 
                            aspectRatio: "4/3", 
                            borderRadius: 16, 
                            overflow: "hidden", 
                            background: "#2E2E2E",
                            position: "relative",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
                        }}>
                            <VideoPlayer 
                                // If I am Student -> Local. If Mentor -> Remote.
                                stream={role === "student" ? localStream : remoteStream} 
                                isMirrored={role === "student"} 
                                muted={role === "student"} // Mute my own camera
                            />
                        </div>

                        {/* CAMERA 2: Right (Mentor Position) */}
                        <div style={{ 
                            height: "100%", 
                            aspectRatio: "4/3", 
                            borderRadius: 16, 
                            overflow: "hidden", 
                            background: "#2E2E2E",
                            position: "relative",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
                        }}>
                             <VideoPlayer 
                                // If I am Student -> Remote. If Mentor -> Local.
                                stream={role === "mentor" ? localStream : remoteStream} 
                                isMirrored={role === "mentor"} 
                                muted={role === "mentor"} // Mute my own camera
                            />
                        </div>
                    </div>

                    {/* MAIN AREA: SCREEN SHARE */}
                    <div style={{
                        flex: 1, // Take up all remaining space
                        width: "100%",
                        overflow: "hidden",
                        background: "transparent",
                        position: "relative",
                        display: "flex",
                        alignItems: "center", // Center video vertically in available space
                        justifyContent: "center"
                    }}>
                        {/* Wrapper to enforce aspect ratio */}
                        <div style={{
                            position: "relative",
                            // Use calculated dimensions if available, otherwise 100%
                            ...screenShareContainerStyle,
                            // Ensure it never exceeds the parent flex container
                            maxWidth: "100%",
                            maxHeight: "100%",
                            borderRadius: 14, // Added rounded corners
                            overflow: "hidden"
                        }}>
                            <VideoPlayer 
                                stream={remoteScreenStream || screenStreamRef.current} 
                                isMirrored={false} 
                                muted={!remoteScreenStream} // Unmute only if it's a remote screen share
                                style={{ 
                                    width: "100%", 
                                    height: "100%", 
                                    objectFit: 'contain' 
                                }}
                                onVideoSize={(w, h) => setSharedScreenSize({ width: w, height: h })}
                            />
                        </div>
                    </div>
                </div>
            ) : (
                // --- STANDARD LAYOUT (SPLIT VIEW) ---
                <div
                    style={{
                        flex: "1 1 0",
                        width: "100%",
                        display: "flex",
                        flexDirection: isMobileLayout ? "column" : "row",
                        gap: 8,
                        paddingTop: 16,
                        paddingLeft: 16,
                        paddingRight: 16,
                        paddingBottom: 0,
                        alignItems: (!isMobileLayout) ? "flex-end" : "center", 
                        justifyContent: "center",
                        position: "relative",
                        minHeight: 0,
                        flexWrap: "nowrap",
                        overflow: "hidden",
                        boxSizing: "border-box"
                    }}
                >
                    {/* ITEM 1: Student Card OR Left Video */}
                    <div
                        style={{
                            width: finalWidth,
                            height: finalHeight,
                            borderRadius: 32,
                            background: (!role && status === "idle") ? "#0B87DA" : "#2E2E2E",
                            overflow: "hidden",
                            position: "relative",
                            flexShrink: 0,
                            cursor: (!role && status === "idle") ? "pointer" : "default",
                            display: "flex",
                            flexDirection: "column",
                        }}
                        onClick={() => (!role && status === "idle") && handleRoleSelect("student")}
                    >
                        {(!role && status === "idle") ? (
                            <div style={{ padding: isMobileLayout ? 48 : 96, display: "flex", flexDirection: "column", gap: 24, height: "100%" }}>
                                <div style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '24px', fontWeight: '600', lineHeight: '1.2' }}>Get free help</div>
                                <div style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '15px', fontWeight: '400', lineHeight: '1.4', opacity: 0.9 }}>I'm a student looking for a mentor</div>
                            </div>
                        ) : (
                            role === "student" ? (
                                // --- LOCAL USER (STUDENT) ---
                                <VideoPlayer stream={localStream} isMirrored={true} muted={true} />
                            ) : (
                                // --- REMOTE USER (STUDENT) ---
                                status === "connected" ? (
                                    <VideoPlayer stream={remoteStream} isMirrored={false} />
                                ) : (
                                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255, 255, 255, 0.45)", fontSize: 15 }}>Searching for student...</div>
                                )
                            )
                        )}
                    </div>

                    {/* ITEM 2: Mentor Card OR Right Video */}
                    <div
                        style={{
                            width: finalWidth,
                            height: finalHeight,
                            borderRadius: 32,
                            background: "#2E2E2E",
                            overflow: "hidden",
                            position: "relative",
                            flexShrink: 0,
                            cursor: (!role && status === "idle") ? "pointer" : "default",
                            display: "flex",
                            flexDirection: "column",
                        }}
                        onClick={() => (!role && status === "idle") && handleRoleSelect("mentor")}
                    >
                        {(!role && status === "idle") ? (
                            <div style={{ padding: isMobileLayout ? 48 : 96, display: "flex", flexDirection: "column", gap: 24, height: "100%" }}>
                                <div style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '24px', fontWeight: '600', lineHeight: '1.2' }}>Volunteer</div>
                                <div style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '15px', fontWeight: '400', lineHeight: '1.4', opacity: 0.9 }}>I want to offer free advice</div>
                            </div>
                        ) : (
                            role === "mentor" ? (
                                // --- LOCAL USER (MENTOR) ---
                                <VideoPlayer stream={localStream} isMirrored={true} muted={true} />
                            ) : (
                                // --- REMOTE USER (MENTOR) ---
                                status === "connected" ? (
                                    <VideoPlayer stream={remoteStream} isMirrored={false} />
                                ) : (
                                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255, 255, 255, 0.45)", fontSize: 15 }}>Searching for mentor...</div>
                                )
                            )
                        )}
                    </div>
                </div>
            )}

            {/* 2. DRAG HANDLE (Chat Drawer Control) */}
            <div
                onPointerDown={handlePointerDown}
                style={{
                    height: 24,
                    width: "100%",
                    maxWidth: 728,
                    margin: "0 auto",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "ns-resize",
                    flexShrink: 0,
                    touchAction: "none",
                    zIndex: 25,
                }}
            >
                <div
                    style={{
                        width: 32,
                        height: 4,
                        borderRadius: 2,
                        background: "rgba(255,255,255,0.2)"
                    }}
                />
            </div>

            {/* 3. AI CHAT HISTORY LAYER */}
            <div 
                style={{
                    height: chatHeight,
                    width: "100%",
                    maxWidth: 728,
                    margin: "0 auto",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <div
                    style={{
                        flex: 1,
                        width: "100%",
                        padding: "0 24px",
                        paddingBottom: 90,
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                    }}
                >
                    {messages.map((msg, idx) => (
                         <div key={idx} style={{ 
                             display: "flex", 
                             justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                             width: "100%"
                         }}>
                             <div style={{ 
                                 maxWidth: msg.role === "user" ? "80%" : "100%", 
                                 width: msg.role === "user" ? "auto" : "100%",
                                 display: "flex",
                                 flexDirection: "column",
                                 gap: 8,
                                 alignItems: msg.role === "user" ? "flex-end" : "flex-start"
                             }}>
                                {/* Attachments rendering */}
                                {msg.role === "user" && msg.attachments && msg.attachments.length > 0 && (() => {
                                    const mediaAttachments = msg.attachments.filter(a => a.type === 'image' || a.type === 'video')
                                    const fileAttachments = msg.attachments.filter(a => a.type !== 'image' && a.type !== 'video')

                                    return (
                                        <>
                                            {/* 1. Media Grid (Images/Videos) */}
                                            {mediaAttachments.length > 0 && (
                                                <div style={{ 
                                                    marginBottom: 4,
                                                    width: "100%",
                                                    display: mediaAttachments.length === 1 ? "flex" : "grid",
                                                    justifyContent: "flex-end",
                                                    gridTemplateColumns: mediaAttachments.length === 1 
                                                        ? "none"
                                                        : (mediaAttachments.length === 2 || mediaAttachments.length === 4) 
                                                            ? "repeat(2, 96px)" 
                                                            : "repeat(3, 96px)",
                                                    gap: 8,
                                                }}>
                                                    {mediaAttachments.map((att, i) => (
                                                        <React.Fragment key={i}>
                                                            {mediaAttachments.length === 1 ? (
                                                                // Single Item: specialized display
                                                                att.url ? (
                                                                    <img 
                                                                        src={att.url} 
                                                                        alt="Uploaded" 
                                                                        style={{
                                                                            maxHeight: 128,
                                                                            width: "auto",
                                                                            maxWidth: "100%",
                                                                            borderRadius: 16, 
                                                                            display: 'block',
                                                                            objectFit: "contain"
                                                                        }}
                                                                    />
                                                                ) : null
                                                            ) : (
                                                                // Grid Item: 96x96 square
                                                                <div style={{
                                                                    width: 96,
                                                                    height: 96,
                                                                    borderRadius: 12,
                                                                    overflow: "hidden",
                                                                    position: "relative",
                                                                    background: "rgba(255,255,255,0.05)"
                                                                }}>
                                                                    {att.url && (
                                                                        <img 
                                                                            src={att.url} 
                                                                            alt="Uploaded" 
                                                                            style={{
                                                                                width: "100%",
                                                                                height: "100%",
                                                                                objectFit: "cover",
                                                                                display: "block"
                                                                            }}
                                                                        />
                                                                    )}
                                                                </div>
                                                            )}
                                                        </React.Fragment>
                                                    ))}
                                                </div>
                                            )}

                                            {/* 2. File Stack (Always Vertical) */}
                                            {fileAttachments.length > 0 && (
                                                <div style={{ 
                                                    width: "100%",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    alignItems: "flex-end",
                                                    gap: 8,
                                                    marginBottom: 4
                                                }}>
                                                    {fileAttachments.map((att, i) => (
                                                        <FileAttachment 
                                                            key={i}
                                                            name={att.name || "File"} 
                                                            type={att.mimeType || ""} 
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    )
                                })()}
                                
                                {/* Text content */}
                                {msg.text && (
                                    <div style={{ 
                                        padding: msg.role === "user" ? "10px 16px" : "0", 
                                        borderRadius: msg.role === "user" ? 20 : 0,
                                        background: msg.role === "user" ? "rgba(255, 255, 255, 0.08)" : "transparent",
                                        color: "rgba(255,255,255,0.95)",
                                        lineHeight: 1.6,
                                        fontSize: 16,
                                        alignSelf: msg.role === "user" ? "flex-end" : "flex-start"
                                    }}>
                                        {msg.role === "user" 
                                            ? msg.text 
                                            : renderSimpleMarkdown(
                                                msg.text, 
                                                { fontSize: 16, color: "rgba(255,255,255,0.95)", lineHeight: 1.6 },
                                                { color: "#4DA6FF", textDecoration: "underline" }
                                              )
                                        }
                                    </div>
                                )}
                             </div>
                         </div>
                    ))}
                    {isLoading && (
                        <div style={{ paddingLeft: 8, paddingBottom: 8 }}>
                            <div style={{ animation: "pulseStar 1.5s infinite ease-in-out", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 20 20"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <g clipPath="url(#clipLoadAnimMentorship)">
                                        <path
                                            d="M9.291 1.32935C9.59351 0.762163 10.4065 0.762164 10.709 1.32935L13.4207 6.41384C13.4582 6.48418 13.5158 6.54176 13.5861 6.57927L18.6706 9.29099C19.2378 9.59349 19.2378 10.4065 18.6706 10.709L13.5861 13.4207C13.5158 13.4582 13.4582 13.5158 13.4207 13.5862L10.709 18.6706C10.4065 19.2378 9.59351 19.2378 9.291 18.6706L6.57927 13.5862C6.54176 13.5158 6.48417 13.4582 6.41384 13.4207L1.32934 10.709C0.762155 10.4065 0.762157 9.59349 1.32935 9.29099L6.41384 6.57927C6.48417 6.54176 6.54176 6.48418 6.57927 6.41384L9.291 1.32935Z"
                                            fill="white"
                                        />
                                    </g>
                                    <defs>
                                        <clipPath id="clipLoadAnimMentorship">
                                            <rect
                                                width="20"
                                                height="20"
                                                fill="white"
                                            />
                                        </clipPath>
                                    </defs>
                                </svg>
                            </div>
                        </div>
                    )}
                </div>

                {/* 4. CHAT INPUT INTERFACE */}
                <div
                    style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        width: "100%",
                        display: "flex",
                        justifyContent: "center",
                        zIndex: 20,
                        pointerEvents: "none", // Let clicks pass through outside the input
                    }}
                >
                    <ChatInput 
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onSend={handleSendMessage}
                        onStop={handleStop}
                        onEndCall={cleanup}
                        onFileSelect={handleFileSelect}
                        onScreenShare={toggleScreenShare}
                        onReport={handleReport}
                        placeholder="Ask anything"
                        showEndCall={status !== "idle"}
                        attachments={attachments}
                        onRemoveAttachment={handleRemoveAttachment}
                        isLoading={isLoading}
                        isScreenSharing={isScreenSharing}
                    />
                </div>
            </div>

        </div>
    )
}

// --- FRAMER PROPERTY CONTROLS ---
addPropertyControls(OmegleMentorshipUI, {
    geminiApiKey: {
        type: ControlType.String,
        title: "Gemini API Key",
        description: "Enter your API key from Google AI Studio.",
        defaultValue: "",
        obscured: true,
    },
    model: {
        type: ControlType.String,
        title: "AI Model",
        defaultValue: "gemini-2.5-flash-lite",
        description: "Model ID (e.g., gemini-2.5-flash-lite",
    },
    systemPrompt: {
        type: ControlType.String,
        title: "System Prompt",
        defaultValue: "You are a helpful mentor assistant from Curastem.",
        displayTextArea: true,
    },
    accentColor: {
        type: ControlType.Color,
        title: "Accent Color",
        defaultValue: "#0099FF",
    },
    debugMode: {
        type: ControlType.Boolean,
        title: "Debug Mode",
        defaultValue: false,
        description: "Enables an on-screen console overlay for debugging mobile connections.",
    },
})
