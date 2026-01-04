import * as React from "react"
import { addPropertyControls, ControlType, RenderTarget } from "framer"
import { motion, AnimatePresence } from "framer-motion"
// @ts-ignore
import { Tldraw, exportToBlob } from "https://esm.sh/tldraw@2.1.0?external=react,react-dom"

// -----------------------------------------------------------------------------
// Constants for Gemini Live
// -----------------------------------------------------------------------------
const SUGGESTION_MODEL_ID = "gemini-2.5-flash-lite"
const MODEL_OUTPUT_SAMPLE_RATE = 24000
const INPUT_TARGET_SAMPLE_RATE = 16000

// -----------------------------------------------------------------------------
// Audio Processing Helpers for Live API
// -----------------------------------------------------------------------------

function highPassFilter(audioData: Float32Array, sampleRate: number, cutoffFreq: number = 80): Float32Array {
    const RC = 1.0 / (cutoffFreq * 2 * Math.PI)
    const dt = 1.0 / sampleRate
    const alpha = RC / (RC + dt)
    
    const filtered = new Float32Array(audioData.length)
    filtered[0] = audioData[0]
    
    for (let i = 1; i < audioData.length; i++) {
        filtered[i] = alpha * (filtered[i - 1] + audioData[i] - audioData[i - 1])
    }
    
    return filtered
}

function normalizeAudio(audioData: Float32Array): Float32Array {
    let maxAmp = 0
    for (let i = 0; i < audioData.length; i++) {
        const amp = Math.abs(audioData[i])
        if (amp > maxAmp) maxAmp = amp
    }
    
    if (maxAmp === 0) return audioData
    
    // Normalize to 0.7 to leave headroom and avoid clipping
    const normalized = new Float32Array(audioData.length)
    const targetLevel = 0.7
    const gain = targetLevel / maxAmp
    
    for (let i = 0; i < audioData.length; i++) {
        normalized[i] = audioData[i] * gain
    }
    
    return normalized
}

function detectVoiceActivity(audioData: Float32Array, threshold: number): boolean {
    let sumSquares = 0
    let zeroCrossings = 0
    
    for (let i = 0; i < audioData.length; i++) {
        sumSquares += audioData[i] * audioData[i]
        
        if (i > 0 && audioData[i] * audioData[i - 1] < 0) {
            zeroCrossings++
        }
    }
    
    const rms = Math.sqrt(sumSquares / audioData.length)
    const zcr = zeroCrossings / audioData.length
    
    return rms > threshold && zcr > 0.01 && zcr < 0.5
}

function base64ToFloat32Array(base64: string): Float32Array {
    const binaryString = atob(base64)
    const len = binaryString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }
    const int16 = new Int16Array(bytes.buffer)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768
    }
    return float32
}

function float32ToBase64(float32: Float32Array): string {
    const int16 = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]))
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const bytes = new Uint8Array(int16.buffer)
    let binary = ""
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

// -----------------------------------------------------------------------------
// Shared UI Components
// -----------------------------------------------------------------------------

interface TooltipProps {
    children: React.ReactNode
    style?: React.CSSProperties
}

const Tooltip = ({ children, style }: TooltipProps) => (
    <div style={{
        position: "absolute",
        background: "#000000",
        color: "white",
        padding: "4px 12px",
        borderRadius: "28px",
        fontSize: "12px",
        fontWeight: 600,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 10,
        boxShadow: "0px 4px 24px rgba(0, 0, 0, 0.08)",
        userSelect: "none",
        WebkitUserSelect: "none",
        ...style
    }}>
        {children}
    </div>
)

function downsampleBuffer(
    buffer: Float32Array,
    inputRate: number,
    outputRate: number
): Float32Array {
    if (outputRate === inputRate) return buffer
    
    const sampleRateRatio = inputRate / outputRate
    const newLength = Math.round(buffer.length / sampleRateRatio)
    const result = new Float32Array(newLength)
    
    for (let i = 0; i < newLength; i++) {
        const srcIndex = i * sampleRateRatio
        const srcIndexInt = Math.floor(srcIndex)
        const fraction = srcIndex - srcIndexInt
        
        let sum = 0
        let count = 0
        const windowSize = Math.ceil(sampleRateRatio)
        
        for (let j = 0; j < windowSize && srcIndexInt + j < buffer.length; j++) {
            sum += buffer[srcIndexInt + j]
            count++
        }
        
        const averaged = count > 0 ? sum / count : 0
        
        if (srcIndexInt + 1 < buffer.length && fraction > 0) {
            result[i] = averaged * (1 - fraction * 0.5) + buffer[srcIndexInt + 1] * (fraction * 0.5)
        } else {
            result[i] = averaged
        }
    }
    
    return result
}

function isHoverCapable() {
    if (typeof window === "undefined") return false
    return window.matchMedia("(hover: hover)").matches
}

// --- SHARED STYLES / STYLE GUIDE ---
// Use for all colors and styles

const darkColors = {
    background: "#212121",
    surface: "#303030",
    surfaceHighlight: "#3D3D3D",
    surfaceMenu: "#353535",
    surfaceModal: "#1E1E1E",
    card: "#2E2E2E",
    
    text: {
        primary: "rgba(255, 255, 255, 0.95)",
        secondary: "rgba(255, 255, 255, 0.65)",
        tertiary: "rgba(255, 255, 255, 0.45)",
        link: "#4DA6FF"
    },
    
    border: {
        subtle: "rgba(255, 255, 255, 0.1)",
    },
    
    state: {
        hover: "rgba(255, 255, 255, 0.12)",
        destructive: "#EC1313", // Red
        accent: "#0B87DA", // Blue, default student card color
        overlay: "rgba(0, 0, 0, 0.7)",
    },
    
    file: {
        pdf: "#EA4335",
        excel: "#34A853",
        ppt: "#FBBC04",
        default: "#4285F4"
    }
}

const lightColors = {
    background: "#FFFFFF",
    surface: "#f6f6f6",
    surfaceHighlight: "#E2E8F0",
    surfaceMenu: "#f6f6f6",
    surfaceModal: "#FFFFFF",
    card: "#FFFFFF",
    
    text: {
        primary: "rgba(0, 0, 0, 0.95)",
        secondary: "rgba(0, 0, 0, 0.65)",
        tertiary: "rgba(0, 0, 0, 0.45)",
        link: "#0099FF"
    },
    
    border: {
        subtle: "rgba(0, 0, 0, 0.1)",
    },
    
    state: {
        hover: "rgba(0, 0, 0, 0.05)",
        destructive: "#EF4444", // Red
        accent: "#0EA5E9", // Sky Blue
        overlay: "rgba(255, 255, 255, 0.8)",
    },
    
    file: {
        pdf: "#EA4335",
        excel: "#34A853",
        ppt: "#FBBC04",
        default: "#4285F4"
    }
}

const colors = darkColors

const getStyles = (theme: typeof darkColors) => ({
    flexCenter: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    } as React.CSSProperties,
    flexColumn: {
        display: "flex",
        flexDirection: "column",
    } as React.CSSProperties,
    fullSize: {
        width: "100%",
        height: "100%",
    } as React.CSSProperties,
    menuItem: {
        alignSelf: 'stretch',
        height: 36,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 28,
        justifyContent: 'flex-start',
        alignItems: 'center',
        gap: 8,
        display: 'flex',
        cursor: "pointer",
        transition: "background 0.2s",
        background: "transparent",
        color: theme.text.primary,
    } as React.CSSProperties,
    menuItemHover: {
        background: theme.state.hover
    } as React.CSSProperties,
    menuItemDestructiveHover: {
        background: "rgba(251, 106, 106, 0.12)" // Keep consistent red tint
    } as React.CSSProperties,
    videoCardSmall: {
        height: "100%", 
        aspectRatio: "4/3", 
        borderRadius: 16, 
        overflow: "hidden", 
        background: theme.card,
        position: "relative",
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
    } as React.CSSProperties,
    textEllipsis: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    } as React.CSSProperties,
    removeBtn: {
        width: 18,
        height: 18,
        borderRadius: 9,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        border: "none",
        zIndex: 10
    } as React.CSSProperties
})

const styles = getStyles(colors)

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

// User abuse guardrails
// These are designed to prevent abuse and ensure the API is used responsibly
const MAX_INPUT_LENGTH = 1000 // Limit input characters
const MESSAGE_RATE_LIMIT_MS = 1000 // 1 second between messages
const API_TIMEOUT_MS = 30000 // 30 seconds timeout
const MAX_HISTORY_MESSAGES = 20 // Limit history context
const DAILY_MESSAGE_LIMIT = 250 // Limit messages per day

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

const FileAttachment = React.memo(function FileAttachment({ name, type, onRemove }: FileAttachmentProps) {
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
})

// --- HELPER COMPONENT: VIDEO PLAYER ---
const VideoPlayer = React.memo(function VideoPlayer({ 
    stream, 
    isMirrored = false, 
    style = {}, 
    muted = false,
    onVideoSize,
    placeholder,
    themeColors = darkColors
}: { 
    stream: MediaStream | null, 
    isMirrored?: boolean, 
    style?: React.CSSProperties, 
    muted?: boolean,
    onVideoSize?: (width: number, height: number) => void,
    placeholder?: string,
    themeColors?: typeof darkColors
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

    // Use theme surface color for placeholder background, black for video
    const containerBackground = !stream && placeholder ? themeColors.surface : "#000"
    const isLightMode = themeColors.background === "#FFFFFF"
    const placeholderTextColor = isLightMode ? "rgba(0, 0, 0, 0.45)" : "rgba(255, 255, 255, 0.45)"

    return (
        <div style={{ width: "100%", height: "100%", background: containerBackground, position: "relative", ...style }}>
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
                    display: stream ? "block" : "none"
                }} 
            />
            {!stream && placeholder && (
                <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: placeholderTextColor,
                    fontSize: 14,
                    padding: 8,
                    textAlign: "center"
                }}>
                    {placeholder}
                </div>
            )}
        </div>
    )
})

// --- HELPER COMPONENT: DOC EDITOR ---
interface DocEditorProps {
    content: string
    onChange: (content: string) => void
    settings: { fontStyle: 'serif' | 'sans', fontSize: number, h1Size: number, h2Size: number, pSize: number }
    onSettingsChange: (settings: { fontStyle: 'serif' | 'sans', fontSize: number, h1Size: number, h2Size: number, pSize: number }) => void
    themeColors?: typeof darkColors
    isMobileLayout?: boolean
    remoteCursor?: { x: number, y: number, color: string } | null
    onCursorMove?: (x: number, y: number) => void
}


const ToolbarButton = React.memo(({ 
    id, 
    icon, 
    onClick, 
    tooltip, 
    isActive = false,
    isHovered,
    onHoverChange
}: { 
    id: string, 
    icon: React.ReactNode, 
    onClick: (e: React.MouseEvent) => void, 
    tooltip: string, 
    isActive?: boolean,
    isHovered: boolean,
    onHoverChange: (isHovered: boolean) => void
}) => (
    <button 
        className={id}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        style={{
            width: 40, 
            height: 40, 
            background: isActive ? '#E5E5E5' : '#F6F6F6', 
            borderRadius: 35, 
            justifyContent: 'center', 
            alignItems: 'center', 
            display: 'flex', 
            cursor: 'pointer', 
            position: 'relative',
            border: 'none',
            padding: 0
        }}
        type="button"
        aria-label={tooltip}
        aria-pressed={isActive}
    >
        {icon}
        {isHovered && (
            <Tooltip style={{ top: "100%", left: "50%", transform: "translate(-50%, 8px)", zIndex: 100 }}>{tooltip}</Tooltip>
        )}
    </button>
))

// --- P2P Helper Functions ---
function getCaretCharacterOffsetWithin(element: HTMLElement): number {
    let caretOffset = 0;
    const doc = element.ownerDocument || document;
    const win = doc.defaultView || window;
    const sel = win.getSelection();
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        caretOffset = preCaretRange.toString().length;
    }
    return caretOffset;
}

function setCaretPosition(element: HTMLElement, offset: number) {
    const createRange = (node: Node, chars: { count: number }, range?: Range): Range | undefined => {
        if (!range) {
            range = document.createRange();
            range.selectNode(node);
            range.setStart(node, 0);
        }

        if (chars.count === 0) {
            range.setEnd(node, chars.count);
        }

        if (node && chars.count > 0) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent && node.textContent.length < chars.count) {
                    chars.count -= node.textContent.length;
                } else {
                    range.setEnd(node, chars.count);
                    chars.count = 0;
                }
            } else {
                for (let lp = 0; lp < node.childNodes.length; lp++) {
                    range = createRange(node.childNodes[lp], chars, range);
                    if (chars.count === 0) {
                        break;
                    }
                }
            }
        }
        return range;
    }
    
    if (offset >= 0) {
        const selection = window.getSelection();
        const range = createRange(element, { count: offset });
        if (range) {
            range.collapse(false);
            selection?.removeAllRanges();
            selection?.addRange(range);
        }
    }
}

const DocEditor = React.memo(function DocEditor({ content, onChange, settings, onSettingsChange, themeColors = lightColors, isMobileLayout = false, remoteCursor, onCursorMove }: DocEditorProps) {
    const editorRef = React.useRef<HTMLDivElement>(null)
    const containerRef = React.useRef<HTMLDivElement>(null)
    const linkDropdownRef = React.useRef<HTMLDivElement>(null)
    const savedSelectionRef = React.useRef<Range | null>(null)
    
    const [selectedFontSize, setSelectedFontSize] = React.useState(settings.pSize)
    const [fontSizeInput, setFontSizeInput] = React.useState(settings.pSize.toString())
    const [isEditingFontSize, setIsEditingFontSize] = React.useState(false)
    const [showLinkDropdown, setShowLinkDropdown] = React.useState(false)
    const [isLinkActive, setIsLinkActive] = React.useState(false)
    const [hoveredToolbarItem, setHoveredToolbarItem] = React.useState<string | null>(null)

    // CSS Variables for performance
    const styleVariables = React.useMemo(() => ({
        '--doc-h1-size': `${settings.h1Size}px`,
        '--doc-h2-size': `${settings.h2Size}px`,
        '--doc-p-size': `${settings.pSize}px`,
        '--doc-font-serif': '"Times New Roman", serif',
        '--doc-font-sans': 'Inter, sans-serif',
        '--doc-accent': '#0099FF',
        '--doc-current-font': settings.fontStyle === 'serif' ? 'var(--doc-font-serif)' : 'var(--doc-font-sans)'
    } as React.CSSProperties), [settings.h1Size, settings.h2Size, settings.pSize, settings.fontStyle])

    // --- Core Editor Logic ---
    
    // Sync content to parent
    const handleInput = React.useCallback(() => {
        if (editorRef.current) {
            const html = editorRef.current.innerHTML
            if (html !== content) {
                onChange(html)
            }
        }
    }, [onChange, content])

    // Initialize content
    React.useEffect(() => {
        if (editorRef.current && editorRef.current.innerHTML !== content) {
            const editor = editorRef.current;
            // Preserves cursor position if focused
            if (document.activeElement === editor) {
                 const currentOffset = getCaretCharacterOffsetWithin(editor);
                 editor.innerHTML = content;
                 setCaretPosition(editor, currentOffset);
            } else {
                 editor.innerHTML = content;
            }
        }
    }, [content])

    // --- Selection Management ---

    const saveSelection = React.useCallback(() => {
        const selection = window.getSelection()
        if (selection && selection.rangeCount > 0) {
            savedSelectionRef.current = selection.getRangeAt(0).cloneRange()
        }
    }, [])

    const restoreSelection = React.useCallback(() => {
        if (savedSelectionRef.current && editorRef.current) {
            const selection = window.getSelection()
            if (selection) {
                selection.removeAllRanges()
                selection.addRange(savedSelectionRef.current)
            }
            editorRef.current.focus()
        }
    }, [])

    // --- Formatting Logic ---

    const getSelectionInfo = React.useCallback(() => {
        const selection = window.getSelection()
        if (!selection || !selection.rangeCount) return { tag: 'P', size: settings.pSize }
        
        let node = selection.anchorNode
        while (node && node !== editorRef.current) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = (node as HTMLElement).tagName
                if (tag === 'H1') return { tag: 'H1', size: settings.h1Size }
                if (tag === 'H2') return { tag: 'H2', size: settings.h2Size }
                if (['P', 'LI', 'DIV'].includes(tag)) return { tag: 'P', size: settings.pSize }
            }
            node = node.parentNode
        }
        return { tag: 'P', size: settings.pSize }
    }, [settings, editorRef])

    const updateFontSize = React.useCallback((newSize: number) => {
        const size = Math.max(8, Math.min(72, newSize))
        restoreSelection()
        
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed) {
            document.execCommand('styleWithCSS', false, 'true')
            // Using execCommand fontSize is tricky as it uses 1-7 scale.
            // Better to use span wrapping for precision.
            const span = document.createElement("span")
            span.style.fontSize = `${size}px`
            const range = selection.getRangeAt(0)
            const content = range.extractContents()
            span.appendChild(content)
            range.insertNode(span)
            
        } else {
            // Update Category Setting
            const info = getSelectionInfo()
            if (info.tag === 'H1') onSettingsChange({ ...settings, h1Size: size })
            else if (info.tag === 'H2') onSettingsChange({ ...settings, h2Size: size })
            else onSettingsChange({ ...settings, pSize: size })
        }
        
        handleInput()
        saveSelection()
        setSelectedFontSize(size)
        if (!isEditingFontSize) setFontSizeInput(size.toString())
    }, [handleInput, saveSelection, restoreSelection, getSelectionInfo, settings, onSettingsChange, isEditingFontSize])

    const handleSmartFormat = React.useCallback((command: string) => {
        restoreSelection()
        const selection = window.getSelection()
        if (!selection || !editorRef.current) return

        if (selection.isCollapsed) {
            const range = selection.getRangeAt(0)
            let node = range.commonAncestorContainer as HTMLElement | null
            while (node && node !== editorRef.current) {
                if (['P', 'LI', 'H1', 'H2', 'DIV'].includes(node.nodeName.toUpperCase())) break
                node = node.parentElement
            }

            if (node && node !== editorRef.current) {
                const newRange = document.createRange()
                newRange.selectNodeContents(node)
                selection.removeAllRanges()
                selection.addRange(newRange)
                document.execCommand(command, false)
                selection.collapseToEnd()
            }
        } else {
            document.execCommand(command, false)
        }
        handleInput()
        saveSelection()
    }, [restoreSelection, handleInput, saveSelection])

    const handleFormat = React.useCallback((command: string, value?: string) => {
        restoreSelection()
        document.execCommand(command, false, value)
        handleInput()
        saveSelection()
    }, [restoreSelection, handleInput, saveSelection])

    // --- Markdown Shortcuts ---

    const handleMarkdownShortcuts = React.useCallback((e: React.KeyboardEvent) => {
        if (!editorRef.current || e.key !== ' ') return
        
        const selection = window.getSelection()
        if (!selection || !selection.rangeCount) return
        
        const range = selection.getRangeAt(0)
        let node = range.startContainer
        let blockElement = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Node
        
        while (blockElement && blockElement !== editorRef.current) {
            const tag = (blockElement as HTMLElement).tagName
            if (tag && ['P', 'DIV', 'H1', 'H2', 'LI'].includes(tag.toUpperCase())) break
            blockElement = blockElement.parentElement
        }
        
        if (!blockElement || blockElement === editorRef.current) blockElement = node
        
        const fullText = (blockElement.textContent || '').trim()
        
        if (fullText === '##') {
            e.preventDefault()
            if (blockElement.nodeType === Node.ELEMENT_NODE) (blockElement as HTMLElement).textContent = ''
            document.execCommand('formatBlock', false, 'h2')
            handleInput()
            saveSelection()
        } else if (fullText === '#') {
            e.preventDefault()
            if (blockElement.nodeType === Node.ELEMENT_NODE) (blockElement as HTMLElement).textContent = ''
            document.execCommand('formatBlock', false, 'h1')
            handleInput()
            saveSelection()
        } else if (fullText === '-') {
            e.preventDefault()
            if (blockElement.nodeType === Node.ELEMENT_NODE) (blockElement as HTMLElement).textContent = ''
            document.execCommand('insertUnorderedList', false)
            handleInput()
            saveSelection()
        }
    }, [handleInput, saveSelection])

    // --- Event Listeners ---

    // Selection Change Listener
    React.useEffect(() => {
        let rafId: number
        const handleSelectionChange = () => {
            cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                const selection = window.getSelection()
                if (!selection || !selection.rangeCount) return
                
                const anchor = selection.anchorNode
                if (!editorRef.current?.contains(anchor)) return

                saveSelection()
                
                let linkFound = false
                let size = 0
                
                let node: Node | null = anchor
                while (node && node !== editorRef.current) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as HTMLElement
                        const tag = el.tagName
                        
                        if (tag === 'A') linkFound = true
                        
                        if (!size && el.style.fontSize) {
                            const parsed = parseFloat(el.style.fontSize)
                            if (!isNaN(parsed)) size = Math.round(parsed)
                        }
                        
                        if (!size) {
                             if (tag === 'H1') size = settings.h1Size
                             else if (tag === 'H2') size = settings.h2Size
                             else if (['P', 'LI', 'DIV'].includes(tag)) size = settings.pSize
                        }
                    }
                    node = node.parentNode
                }
                
                setIsLinkActive(linkFound)
                if (!size) size = settings.pSize
                
                setSelectedFontSize(size)
                if (!isEditingFontSize) setFontSizeInput(size.toString())
            })
        }
        document.addEventListener('selectionchange', handleSelectionChange)
        return () => {
            document.removeEventListener('selectionchange', handleSelectionChange)
            cancelAnimationFrame(rafId)
        }
    }, [isEditingFontSize, saveSelection, settings])

    // Keyboard Shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (document.activeElement !== editorRef.current) return
            const cmd = e.metaKey || e.ctrlKey
            
            if (cmd) {
                switch(e.key.toLowerCase()) {
                    case 'k': e.preventDefault(); setShowLinkDropdown(true); break;
                    case 'b': e.preventDefault(); handleSmartFormat('bold'); break;
                    case 'i': e.preventDefault(); document.execCommand('italic'); handleInput(); break;
                    case 'z': 
                        e.preventDefault(); 
                        document.execCommand(e.shiftKey ? 'redo' : 'undo'); 
                        handleInput(); 
                        break;
                }
            } else if (e.shiftKey) {
                 if (e.key === '8') { e.preventDefault(); handleFormat('insertUnorderedList'); }
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [handleSmartFormat, handleFormat, handleInput])


    // Outside Click for Link Dropdown
    React.useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (linkDropdownRef.current && !linkDropdownRef.current.contains(e.target as Node)) {
                setShowLinkDropdown(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // --- Link Handling ---
    const handleInsertLink = (url: string) => {
        if (!url || !url.trim()) return
        restoreSelection()
        const selection = window.getSelection()
        if (selection && selection.isCollapsed) {
             document.execCommand('createLink', false, url)
        } else {
             document.execCommand('createLink', false, url)
        }
        handleInput()
        saveSelection()
        setShowLinkDropdown(false)
    }

    const handleRemoveLink = () => {
        restoreSelection()
        document.execCommand('unlink')
        handleInput()
        saveSelection()
        setShowLinkDropdown(false)
    }

    // --- File Export ---
    const downloadDoc = () => {
        let filename = "Note.doc"
        if (editorRef.current) {
            const text = editorRef.current.innerText.trim()
            const firstLine = text.split('\n')[0].trim()
            if (firstLine) {
                filename = `${firstLine.replace(/\s+/g, '_')}.doc`
            }
        }
        
        const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Document</title><style>@page{size:8.5in 11in;margin:0.5in;}body{font-family:${settings.fontStyle === 'serif' ? '"Times New Roman", serif' : 'Inter, sans-serif'};font-size:${settings.pSize}pt;}</style></head><body>`
        const footer = "</body></html>"
        const sourceHTML = header + content + footer
        const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML)
        const link = document.createElement("a")
        link.href = source
        link.download = filename
        link.click()
    }


    const handleEditorPointerMove = React.useCallback((e: React.PointerEvent) => {
        if (!onCursorMove || !containerRef.current) return
        
        const rect = containerRef.current.getBoundingClientRect()
        // Calculate relative position (0-1) within the full viewport container
        const x = (e.clientX - rect.left) / rect.width
        const y = (e.clientY - rect.top) / rect.height
        
        onCursorMove(x, y)
    }, [onCursorMove])

    return (
        <div 
            className="DocEditor" 
            ref={containerRef}
            onPointerMove={handleEditorPointerMove}
            onPointerLeave={() => onCursorMove?.(-1, -1)}
            style={{ ...styleVariables, width: '100%', height: '100%', position: 'relative', background: 'white', color: 'rgba(0, 0, 0, 0.95)', display: 'flex', flexDirection: 'column' }}
        >
            {/* Toolbar */}
            <div className="ToolbarContainer" style={{
                position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', 
                zIndex: 100, width: '100%', maxWidth: 1800, 
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                paddingLeft: 12, paddingRight: 12
            }}>
                <div className="Left" style={{
                     maxWidth: 808.89, background: '#F6F6F6', borderRadius: 31.11, justifyContent: 'flex-start', alignItems: 'center', gap: 4, display: 'flex', flexWrap: 'wrap', alignContent: 'center'
                }}>
                    {/* Font Size Control */}
                    <div style={{ height: 40, paddingLeft: 8, paddingRight: 4, background: '#F6F6F6', borderRadius: 35, justifyContent: 'center', alignItems: 'center', gap: 4, display: 'flex' }}>
                        <div 
                            onClick={() => updateFontSize(selectedFontSize - 1)}
                            onMouseDown={(e) => e.preventDefault()}
                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                            <svg width="16" height="40" viewBox="0 0 16 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ pointerEvents: 'none' }}>
                                <path d="M2 20H14" stroke="black" strokeOpacity="0.95" strokeWidth="1.23935" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                        <div style={{ width: 24, textAlign: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column', color: 'rgba(0, 0, 0, 0.95)', fontSize: 14, fontFamily: 'Inter', fontWeight: '400', lineHeight: '19.32px', wordWrap: 'break-word' }}>
                             <input 
                                type="number" 
                                value={fontSizeInput}
                                onChange={(e) => { setFontSizeInput(e.target.value); const v = parseInt(e.target.value); if(!isNaN(v)) updateFontSize(v); }}
                                onFocus={() => setIsEditingFontSize(true)}
                                onBlur={() => { setIsEditingFontSize(false); setFontSizeInput(selectedFontSize.toString()) }}
                                style={{ width: '100%', opacity: 0, position: 'absolute', cursor: 'text' }}
                            />
                            {fontSizeInput}
                        </div>
                        <div 
                            onClick={() => updateFontSize(selectedFontSize + 1)}
                            onMouseDown={(e) => e.preventDefault()}
                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                            <svg width="16" height="40" viewBox="0 0 16 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ pointerEvents: 'none' }}>
                                <path d="M14 20H8M8 20H2M8 20V14M8 20V26" stroke="black" strokeOpacity="0.95" strokeWidth="1.28" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                    </div>

                    {/* Bold */}
                    <ToolbarButton 
                        id="bold" 
                        onClick={() => handleSmartFormat('bold')} 
                        tooltip="Bold (⌘+B)"
                        icon={<div style={{fontWeight: 700, fontSize: 17.50, lineHeight: '24.15px'}}>B</div>}
                        isHovered={hoveredToolbarItem === 'bold'}
                        onHoverChange={(hovered) => setHoveredToolbarItem(hovered ? 'bold' : null)}
                    />

                    {/* Italic */}
                    <ToolbarButton 
                        id="italic" 
                        onClick={() => handleFormat('italic')} 
                        tooltip="Italic (⌘+I)"
                        icon={
                            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M20.2782 10.5H14.1671M17.8338 21.5H11.7227M17.5282 10.5L14.7782 21.5" stroke="black" strokeOpacity="0.95" strokeWidth="1.32" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        }
                        isHovered={hoveredToolbarItem === 'italic'}
                        onHoverChange={(hovered) => setHoveredToolbarItem(hovered ? 'italic' : null)}
                    />

                    {/* List */}
                    <ToolbarButton 
                        id="list" 
                        onClick={() => handleFormat('insertUnorderedList')} 
                        tooltip="Bullet List"
                        icon={
                            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect width="40" height="40" rx="20" fill="#F6F6F6"/>
                                <path d="M12.5 15.2857C12.5 15.1152 12.5677 14.9517 12.6883 14.8311C12.8088 14.7106 12.9724 14.6429 13.1429 14.6429H14C14.1705 14.6429 14.334 14.7106 14.4546 14.8311C14.5751 14.9517 14.6429 15.1152 14.6429 15.2857C14.6429 15.4562 14.5751 15.6197 14.4546 15.7403C14.334 15.8608 14.1705 15.9286 14 15.9286H13.1429C12.9724 15.9286 12.8088 15.8608 12.6883 15.7403C12.5677 15.6197 12.5 15.4562 12.5 15.2857ZM15.9286 15.2857C15.9286 15.1152 15.9963 14.9517 16.1169 14.8311C16.2374 14.7106 16.4009 14.6429 16.5714 14.6429H26.8571C27.0276 14.6429 27.1912 14.7106 27.3117 14.8311C27.4323 14.9517 27.5 15.1152 27.5 15.2857C27.5 15.4562 27.4323 15.6197 27.3117 15.7403C27.1912 15.8608 27.0276 15.9286 26.8571 15.9286H16.5714C16.4009 15.9286 16.2374 15.8608 16.1169 15.7403C15.9963 15.6197 15.9286 15.4562 15.9286 15.2857ZM12.5 20C12.5 19.8295 12.5677 19.666 12.6883 19.5454C12.8088 19.4249 12.9724 19.3571 13.1429 19.3571H14C14.1705 19.3571 14.334 19.4249 14.4546 19.5454C14.5751 19.666 14.6429 19.8295 14.6429 20C14.6429 20.1705 14.5751 20.334 14.4546 20.4546C14.334 20.5751 14.1705 20.6429 14 20.6429H13.1429C12.9724 20.6429 12.8088 20.5751 12.6883 20.4546C12.5677 20.334 12.5 20.1705 12.5 20ZM15.9286 20C15.9286 19.8295 15.9963 19.666 16.1169 19.5454C16.2374 19.4249 16.4009 19.3571 16.5714 19.3571H26.8571C27.0276 19.3571 27.1912 19.4249 27.3117 19.5454C27.4323 19.666 27.5 19.8295 27.5 20C27.5 20.1705 27.4323 20.334 27.3117 20.4546C27.1912 20.5751 27.0276 20.6429 26.8571 20.6429H16.5714C16.4009 20.6429 16.2374 20.5751 16.1169 20.4546C15.9963 20.334 15.9286 20.1705 15.9286 20ZM12.5 24.7143C12.5 24.5438 12.5677 24.3803 12.6883 24.2597C12.8088 24.1392 12.9724 24.0714 13.1429 24.0714H14C14.1705 24.0714 14.334 24.1392 14.4546 24.2597C14.5751 24.3803 14.6429 24.5438 14.6429 24.7143C14.6429 24.8848 14.5751 25.0483 14.4546 25.1689C14.334 25.2894 14.1705 25.3571 14 25.3571H13.1429C12.9724 25.3571 12.8088 25.2894 12.6883 25.1689C12.5677 25.0483 12.5 24.8848 12.5 24.7143ZM15.9286 24.7143C15.9286 24.5438 15.9963 24.3803 16.1169 24.2597C16.2374 24.1392 16.4009 24.0714 16.5714 24.0714H26.8571C27.0276 24.0714 27.1912 24.1392 27.3117 24.2597C27.4323 24.3803 27.5 24.5438 27.5 24.7143C27.5 24.8848 27.4323 25.0483 27.3117 25.1689C27.1912 25.2894 27.0276 25.3571 26.8571 25.3571H16.5714C16.4009 25.3571 16.2374 25.2894 16.1169 25.1689C15.9963 25.0483 15.9286 24.8848 15.9286 24.7143Z" fill="black" fillOpacity="0.95"/>
                            </svg>
                        }
                        isHovered={hoveredToolbarItem === 'list'}
                        onHoverChange={(hovered) => setHoveredToolbarItem(hovered ? 'list' : null)}
                    />

                    {/* Link */}
                    <div ref={linkDropdownRef} style={{ position: 'relative' }}>
                        <ToolbarButton 
                            id="link" 
                            onClick={() => setShowLinkDropdown(!showLinkDropdown)} 
                            tooltip="Link (⌘+K)"
                            isActive={showLinkDropdown || isLinkActive}
                            icon={
                                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect width="40" height="40" rx="20" fill="#F6F6F6"/>
                                    <path d="M23.4335 20.9139L25.548 18.7993C26.7844 17.563 26.8124 15.5859 25.6102 14.3837C24.408 13.1815 22.4309 13.2095 21.1946 14.4459L19.08 16.5604M20.9458 23.4016L18.8288 25.5099C17.5911 26.7438 15.6737 26.8912 14.4106 25.5721C13.1481 24.2536 13.2364 22.4003 14.474 21.1664L16.5911 19.0581M17.3741 22.6198L22.6517 17.3422" stroke="black" strokeOpacity="0.95" strokeWidth="1.13455" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            }
                            isHovered={hoveredToolbarItem === 'link'}
                            onHoverChange={(hovered) => setHoveredToolbarItem(hovered ? 'link' : null)}
                        />
                        {showLinkDropdown && (
                             <div style={{
                                position: 'absolute', top: '120%', left: 0, 
                                background: 'white', border: '1px solid #eee', borderRadius: 12, 
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: 8, minWidth: 220, zIndex: 200
                             }}>
                                <input 
                                    autoFocus
                                    placeholder="Paste URL..."
                                    className="link-input"
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleInsertLink((e.target as HTMLInputElement).value) }}
                                    style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', marginBottom: 4 }}
                                />
                                {isLinkActive && (
                                    <button onClick={handleRemoveLink} style={{ width: '100%', padding: '6px', background: '#ffebee', color: '#d32f2f', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                                        Remove Link
                                    </button>
                                )}
                             </div>
                        )}
                    </div>
                </div>

                {/* Download */}
                <div onClick={downloadDoc} style={{ 
                    height: 40, paddingLeft: 14, paddingRight: 14, background: '#0099FF', borderRadius: 35, 
                    justifyContent: 'center', alignItems: 'center', gap: 8, display: 'flex', cursor: 'pointer'
                }}>
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ pointerEvents: 'none' }}>
                        <path d="M0.699219 10.3485V11.1839C0.699219 11.8512 0.96431 12.4912 1.43618 12.963C1.90804 13.4349 2.54803 13.7 3.21535 13.7H11.6024C12.2698 13.7 12.9097 13.4349 13.3816 12.963C13.8535 12.4912 14.1186 11.8512 14.1186 11.1839V10.3452M7.4089 0.699997V9.9258M7.4089 9.9258L10.3444 6.99032M7.4089 9.9258L4.47341 6.99032" stroke="white" strokeOpacity="0.95" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {!isMobileLayout && <div style={{ justifyContent: 'center', display: 'flex', flexDirection: 'column', color: 'rgba(255, 255, 255, 0.95)', fontSize: 14, fontFamily: 'Inter', fontWeight: '600', lineHeight: '19.32px', wordWrap: 'break-word', pointerEvents: 'none' }}>Download</div>}
                </div>
            </div>

            {/* Content Area */}
            <div 
                style={{ flex: 1, overflowY: 'auto', padding: '60px 20px 20px', display: 'flex', justifyContent: 'center', position: 'relative' }}
            >
                <div style={{ width: '100%', maxWidth: 600, position: 'relative' }}>
                     <div 
                        ref={editorRef}
                        contentEditable
                        onInput={handleInput}
                        onBlur={() => {
                            if (editorRef.current && editorRef.current.innerHTML !== content) {
                                editorRef.current.innerHTML = content
                            }
                        }}
                        onKeyDown={handleMarkdownShortcuts}
                        onPaste={(e) => {
                             e.preventDefault();
                             const text = e.clipboardData.getData('text/plain');
                             document.execCommand('insertText', false, text);
                        }}
                        style={{ 
                            outline: 'none', minHeight: '80vh', 
                            fontSize: 'var(--doc-p-size)', 
                            fontFamily: 'var(--doc-current-font)',
                            lineHeight: 1.6,
                            position: 'relative',
                            zIndex: 1
                        }}
                    />
                </div>
            </div>
            
            <style>{`
                .DocEditor h1 { font-size: var(--doc-h1-size); font-weight: 700; margin-top: 1em; margin-bottom: 0.5em; }
                .DocEditor h2 { font-size: var(--doc-h2-size); font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #000; margin-top: 1.2em; margin-bottom: 0.5em; }
                .DocEditor ul, .DocEditor ol { padding-left: 24px; margin: 12px 0; }
                .DocEditor a { color: var(--doc-accent); text-decoration: underline; cursor: pointer; }
            `}</style>
            
            {remoteCursor && remoteCursor.x >= 0 && remoteCursor.x <= 1 && remoteCursor.y >= 0 && (
                <LiveCursor x={remoteCursor.x} y={remoteCursor.y} color={remoteCursor.color} />
            )}
        </div>
    )
})

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
    isWhiteboardOpen?: boolean
    toggleWhiteboard?: () => void
    isDocOpen?: boolean
    toggleDoc?: () => void
    isConnected?: boolean
    isMobileLayout?: boolean
    isLiveMode?: boolean
    onPasteFile?: (files: File[]) => void
    onConnectWithAI?: () => void
    themeColors?: typeof darkColors
}

const ChatInput = React.memo(function ChatInput({ 
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
    isScreenSharing = false,
    isWhiteboardOpen = false,
    toggleWhiteboard,
    isDocOpen = false,
    toggleDoc,
    isConnected = false,
    isMobileLayout = false,
    isLiveMode = false,
    onPasteFile,
    onConnectWithAI,
    themeColors = darkColors
}: ChatInputProps) {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const [isAiTooltipHovered, setIsAiTooltipHovered] = React.useState(false)
    const [isAddFilesTooltipHovered, setIsAddFilesTooltipHovered] = React.useState(false)
    const [isEndCallTooltipHovered, setIsEndCallTooltipHovered] = React.useState(false)
    const [showGradient, setShowGradient] = React.useState(true)

    // Handle gradient animation when transitioning into/out of doc editor
    React.useEffect(() => {
        setShowGradient(false) // Instantly hide gradient
        const timeout = setTimeout(() => {
            setShowGradient(true) // Show gradient after 0.2s
        }, 200)
        return () => clearTimeout(timeout)
    }, [isDocOpen, isWhiteboardOpen])

    const [showMenu, setShowMenu] = React.useState(false)
    const [selectedMenuIndex, setSelectedMenuIndex] = React.useState(-1)
    const menuRef = React.useRef<HTMLDivElement>(null)
    const [canShareScreen, setCanShareScreen] = React.useState(false)

    // Create local styles with themeColors
    const localStyles = React.useMemo(() => getStyles(themeColors), [themeColors])

    // Reset selection when menu opens/closes
    React.useEffect(() => {
        if (!showMenu) setSelectedMenuIndex(-1)
    }, [showMenu])

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items
        if (!items) return

        const files: File[] = []
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile()
                if (file) files.push(file)
            }
        }

        if (files.length > 0) {
            e.preventDefault()
            onPasteFile?.(files)
        }
    }

    React.useEffect(() => {
        // Focus cursor on mount if not in canvas
        if (RenderTarget.current() !== RenderTarget.canvas) {
            textareaRef.current?.focus()

            // Global key listener for typing
            const handleGlobalKeyDown = (e: KeyboardEvent) => {
                // Ignore if focus is already on an input or textarea
                const active = document.activeElement
                const isInputActive =
                    active?.tagName === "INPUT" ||
                    active?.tagName === "TEXTAREA" ||
                    active?.getAttribute("contenteditable") === "true"

                if (!isInputActive && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    textareaRef.current?.focus()
                }
            }

            window.addEventListener("keydown", handleGlobalKeyDown)
            return () => window.removeEventListener("keydown", handleGlobalKeyDown)
        }
    }, [])

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

    const menuItems = React.useMemo(() => {
        const items = [
            {
                id: 'files',
                label: 'Add files & photos',
                icon: (
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3.19141 4.59193L3.29675 10.2717C3.39352 15.6476 11.9099 16.019 11.8096 10.4239L11.6836 3.38078C11.6181 -0.267308 5.83901 -0.519317 5.90706 3.27745L6.03155 10.2193C6.06633 12.1391 9.10707 12.2717 9.07179 10.2737L8.94881 4.52691" stroke={themeColors.text.primary} strokeWidth="1.06918" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                ),
                onClick: () => {
                    onFileSelect()
                    setShowMenu(false)
                },
                className: "AddFilesPhotos",
                isDestructive: false
            }
        ]

        if (canShareScreen) {
            items.push({
                id: 'share',
                label: isScreenSharing ? 'Stop sharing' : 'Share screen',
                icon: isScreenSharing ? (
                     <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M14 2L2 14M2 2L14 14" stroke="#FB6A6A" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                ) : (
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M0.75 10.6674V11.5078C0.75 12.1791 1.01668 12.823 1.49139 13.2977C1.96609 13.7724 2.60992 14.0391 3.28125 14.0391H11.7188C12.3901 14.0391 13.0339 13.7724 13.5086 13.2977C13.9833 12.823 14.25 12.1791 14.25 11.5078V10.6641M7.5 10.2422V0.960938M7.5 0.960938L10.4531 3.91406M7.5 0.960938L4.54688 3.91406" stroke={themeColors.text.primary} strokeWidth="1.26562" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                ),
                onClick: () => {
                    if (onScreenShare) onScreenShare()
                    setShowMenu(false)
                },
                className: "ShareScreen",
                isDestructive: isScreenSharing
            })
        }

        items.push({
            id: 'whiteboard',
            label: isWhiteboardOpen ? 'Stop whiteboard' : 'Whiteboard',
            icon: isWhiteboardOpen ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 2L2 14M2 2L14 14" stroke="#FB6A6A" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7.7678 12.938C7.38383 13.3223 5.11119 15.1876 4.47671 15.0968L1.08753 14.6089L0.602849 11.2417C0.511562 10.6074 2.37678 8.33438 2.76073 7.95043M7.7678 12.938L14.6179 6.08488C15.0023 5.70053 15.1668 5.12791 15.0754 4.49297C14.9841 3.85804 14.6442 3.2128 14.1306 2.69921L13.0021 1.57C12.7477 1.31548 12.4582 1.10098 12.1503 0.93875C11.8423 0.776525 11.5218 0.669761 11.2073 0.62456C10.8927 0.579359 10.5901 0.596608 10.3169 0.675321C10.0436 0.754034 9.80508 0.892667 9.61484 1.0833L2.76073 7.95043M7.7678 12.938L2.76073 7.95043" stroke={themeColors.text.primary} strokeOpacity="0.95" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            ),
            onClick: () => {
                if (toggleWhiteboard) toggleWhiteboard()
                setShowMenu(false)
            },
            className: "Whiteboard",
            isDestructive: isWhiteboardOpen
        })

        items.push({
            id: 'doc',
            label: isDocOpen ? 'Close notes' : 'Notes',
            icon: isDocOpen ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 2L2 14M2 2L14 14" stroke="#FB6A6A" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            ) : (
                <svg width="16" height="12" viewBox="0 0 16 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0.599609 11.0021L8.48004 11.0018M0.599609 5.64345H15.0996M0.599609 0.599976H15.0996" stroke={themeColors.text.primary} strokeOpacity="0.95" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            ),
            onClick: () => {
                if (toggleDoc) toggleDoc()
                setShowMenu(false)
            },
            className: "Doc",
            isDestructive: isDocOpen
        })

        if (isConnected && !isLiveMode) {
            items.push({
                id: 'report',
                label: 'Report user',
                icon: (
                     <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1.38867 14.375V10.3166M1.38867 10.3166C5.83286 6.84096 9.16639 13.7922 13.6106 10.3166V1.62832C9.16639 5.10392 5.83286 -1.84728 1.38867 1.62832V10.3166Z" stroke="#FB6A6A" strokeOpacity="0.95" strokeWidth="1.1458" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                ),
                onClick: () => {
                    if (onReport) onReport()
                    setShowMenu(false)
                },
                className: "Report",
                isDestructive: true,
                hasSeparator: true
            })
        }

        return items
    }, [canShareScreen, isScreenSharing, isWhiteboardOpen, isDocOpen, isConnected, isLiveMode, onFileSelect, onScreenShare, toggleWhiteboard, toggleDoc, onReport, themeColors])

    return (
        <div data-layer="flexbox" className="Flexbox" style={{width: '100%', maxWidth: 728, position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 0, paddingLeft: isMobileLayout ? 16 : 24, paddingRight: isMobileLayout ? 16 : 24, boxSizing: "border-box", pointerEvents: "auto"}}>
                {/* CONVERSATION QUICK ACTIONS MENU */}
            <style>{`
                .ChatTextInput::placeholder {
                    color: ${themeColors.text.secondary};
                }
                .ChatTextInput::-webkit-input-placeholder {
                    color: ${themeColors.text.secondary};
                }
                .ChatTextInput::-moz-placeholder {
                    color: ${themeColors.text.secondary};
                }
                .ChatTextInput:-ms-input-placeholder {
                    color: ${themeColors.text.secondary};
                }
            `}</style>
            {showMenu && (
                <>
                {isMobileLayout && (
                    <div 
                        style={{
                            position: "fixed",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: "rgba(0, 0, 0, 0.7)",
                            zIndex: 1004,
                            pointerEvents: "auto"
                        }}
                        onClick={() => setShowMenu(false)}
                    />
                )}
                <div ref={menuRef} style={{ 
                    position: isMobileLayout ? "fixed" : "absolute", 
                    bottom: isMobileLayout ? 0 : "100%", 
                    left: isMobileLayout ? 0 : 28, 
                    right: isMobileLayout ? 0 : "auto", 
                    marginBottom: isMobileLayout ? 0 : -28, 
                    zIndex: isMobileLayout ? 1005 : 100, 
                    pointerEvents: "auto" 
                }}>
                    <div data-layer="conversation actions" className="ConversationActions" style={{
                        width: isMobileLayout ? "auto" : 196, 
                        padding: 10, 
                        background: themeColors.surfaceMenu, 
                        boxShadow: '0px 4px 24px rgba(0, 0, 0, 0.08)', 
                        borderRadius: isMobileLayout ? "36px 36px 0px 0px" : 28, 
                        outline: `0.33px ${themeColors.border.subtle} solid`, 
                        outlineOffset: '-0.33px', 
                        flexDirection: 'column', 
                        justifyContent: 'flex-start', 
                        alignItems: 'flex-start', 
                        gap: 4, 
                        display: 'flex',
                    }}>
                        {menuItems.map((item, index) => (
                            <React.Fragment key={item.id}>
                                {item.hasSeparator && (
                                    <div data-layer="separator" className="Separator" style={{alignSelf: 'stretch', marginLeft: 4, marginRight: 4, marginTop: 2, marginBottom: 2, height: 1, position: 'relative', background: themeColors.border.subtle, borderRadius: 4}} />
                                )}
                                <div 
                                    className={item.className}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        item.onClick()
                                    }}
                                    style={{
                                        ...localStyles.menuItem,
                                        height: isMobileLayout ? 44 : 36,
                                        ...(index === selectedMenuIndex ? (item.isDestructive ? localStyles.menuItemDestructiveHover : localStyles.menuItemHover) : {})
                                    }}
                                    onMouseEnter={() => {
                                        if (isMobileLayout) return
                                        setSelectedMenuIndex(index)
                                    }}
                                    onMouseLeave={(e) => {
                                        // Keep selection on mouse leave to support keyboard resumption
                                        // e.currentTarget.style.background = "transparent" // Removed to let React control style
                                    }}
                                >
                                    <div data-svg-wrapper className="Icon" style={{width: 15, display: "flex", justifyContent: "center"}}>
                                        {item.icon}
                                    </div>
                                    <div className="Label" style={{flex: '1 1 0', justifyContent: 'center', display: 'flex', flexDirection: 'column', color: item.isDestructive ? '#FB6A6A' : themeColors.text.primary, fontSize: 14, fontFamily: 'Inter', fontWeight: '400', lineHeight: "19.32px", wordWrap: 'break-word'}}>
                                        {item.label}
                                    </div>
                                </div>
                            </React.Fragment>
                        ))}
                    </div>
                </div>
                </>
            )}

          <div 
            data-layer="overlay" 
            className="Overlay" 
            style={{
                width: "100%", 
                padding: "24px 0 16px 0", 
                background: showGradient ? ((isDocOpen || isWhiteboardOpen) ? `linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, ${themeColors.background} 35%)` : `linear-gradient(180deg, rgba(33, 33, 33, 0) 0%, ${themeColors.background} 35%)`) : 'transparent',
                justifyContent: 'center',
                alignItems: 'flex-end',
                gap: 10,
                display: 'flex',
                transition: showGradient ? 'background 0.2s ease' : 'none'
            }}
          >
            
            {/* INPUT BOX */}
            <div data-layer="input-box" className="InputBox" style={{
                flex: '1 1 0', 
                minHeight: 56, 
                maxHeight: 384, 
                padding: 10, 
                background: themeColors === lightColors ? themeColors.background : ((isDocOpen || isWhiteboardOpen) ? 'transparent' : themeColors.surface), 
                outline: (isDocOpen || isWhiteboardOpen) ? `0.33px ${themeColors.border.subtle} solid` : 'none',
                outlineOffset: (isDocOpen || isWhiteboardOpen) ? '-0.33px' : 0,
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
                  gap: 8,
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
                    onMouseEnter={() => isHoverCapable() && setIsAddFilesTooltipHovered(true)}
                    onMouseLeave={() => setIsAddFilesTooltipHovered(false)}
                    style={{
                      cursor: (attachments.length >= 10) ? "not-allowed" : "pointer", 
                      opacity: (attachments.length >= 10) ? 0.3 : 0.95,
                      pointerEvents: (attachments.length >= 10) ? "none" : "auto",
                      width: 36,
                      height: 36,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 0, // Aligned with send button
                      position: "relative"
                    }}
                  >
                    {!showMenu && isAddFilesTooltipHovered && (
                        <Tooltip style={{
                            bottom: "100%",
                            left: "50%",
                            transform: isMobileLayout ? "translate(-25%, -17px)" : "translate(-50%, -17px)",
                        }}>
                            Add files and more
                        </Tooltip>
                    )}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 5V19M5 12H19" stroke={themeColors.text.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>

                  {/* TEXT INPUT */}
                  <div data-layer="textarea-wrapper" className="TextAreaWrapper" style={{flex: '1 1 0', alignSelf: 'stretch', display: 'flex', alignItems: 'center', paddingTop: 6, paddingBottom: 6}}>
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(e) => {
                            onChange(e)
                            // Auto-open menu on trigger
                            const val = e.target.value
                            if (val.endsWith('/') || val.endsWith('@')) {
                                setShowMenu(true)
                                setSelectedMenuIndex(0) // Default to first option
                            } else if (showMenu) {
                                // Close if continuing to type something else without selecting
                                setShowMenu(false)
                            }
                        }}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                            if (showMenu) {
                                if (e.key === "ArrowUp") {
                                    e.preventDefault()
                                    setSelectedMenuIndex(prev => {
                                        if (prev === -1) return menuItems.length - 1
                                        return prev <= 0 ? menuItems.length - 1 : prev - 1
                                    })
                                    return
                                }
                                if (e.key === "ArrowDown") {
                                    e.preventDefault()
                                    setSelectedMenuIndex(prev => {
                                        if (prev === -1) return 0
                                        return prev === menuItems.length - 1 ? 0 : prev + 1
                                    })
                                    return
                                }
                                if (e.key === "Enter") {
                                    e.preventDefault()
                                    const index = selectedMenuIndex === -1 ? 0 : selectedMenuIndex
                                    if (menuItems[index]) {
                                        menuItems[index].onClick()
                                    }
                                    return
                                }
                                if (e.key === "Escape") {
                                    e.preventDefault()
                                    setShowMenu(false)
                                    return
                                }
                            }

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
                            color: themeColors.text.primary, 
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
                            <rect width="36" height="36" rx="18" fill={themeColors.text.primary} fillOpacity="0.95"/>
                            <rect x="12" y="12" width="12" height="12" rx="2" fill={themeColors.background} fillOpacity="0.95"/>
                        </svg>
                    ) : (
                        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect width="36" height="36" rx="18" fill={themeColors.text.primary} fillOpacity="0.95"/>
                            <path fillRule="evenodd" clipRule="evenodd" d="M14.5611 18.1299L16.8709 15.8202V23.3716C16.8709 23.9948 17.3762 24.5 17.9994 24.5C18.6226 24.5 19.1278 23.9948 19.1278 23.3716V15.8202L21.4375 18.1299C21.8782 18.5706 22.5927 18.5706 23.0334 18.1299C23.4741 17.6893 23.4741 16.9748 23.0334 16.5341L17.9994 11.5L12.9653 16.5341C12.5246 16.9748 12.5246 17.6893 12.9653 18.1299C13.406 18.5706 14.1204 18.5706 14.5611 18.1299Z" fill={themeColors.background} fillOpacity="0.95"/>
                        </svg>
                    )}
                  </div>

                  {/* START LIVE AI CALL BUTTON (When idle and no input) */}
                  {!hasContent && !showEndCall && onConnectWithAI && (
                      <div 
                        data-svg-wrapper 
                        data-layer="start ai live call" 
                        className="StartAiLiveCall"
                        onClick={onConnectWithAI}
                        onMouseEnter={() => isHoverCapable() && setIsAiTooltipHovered(true)}
                        onMouseLeave={() => setIsAiTooltipHovered(false)}
                        style={{
                            cursor: "pointer", 
                            width: 36,
                            height: 36,
                            display: "block",
                            position: "relative"
                        }}
                      >
                          {isAiTooltipHovered && (
                              <Tooltip style={{
                                  bottom: "100%",
                                  left: "50%",
                                  transform: isMobileLayout ? "translate(-70%, -17px)" : "translate(-50%, -17px)",
                              }}>
                                  Connect with AI
                              </Tooltip>
                          )}
                          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M17.3619 10.1964C17.6342 9.68595 18.3658 9.68595 18.6381 10.1964L21.0786 14.7725C21.1124 14.8358 21.1642 14.8876 21.2275 14.9213L25.8036 17.3619C26.314 17.6341 26.314 18.3658 25.8036 18.6381L21.2275 21.0787C21.1642 21.1124 21.1124 21.1642 21.0786 21.2275L18.6381 25.8036C18.3658 26.3141 17.6342 26.3141 17.3619 25.8036L14.9213 21.2275C14.8876 21.1642 14.8358 21.1124 14.7725 21.0787L10.1964 18.6381C9.68594 18.3658 9.68594 17.6341 10.1964 17.3619L14.7725 14.9213C14.8358 14.8876 14.8876 14.8358 14.9213 14.7725L17.3619 10.1964Z" fill={themeColors.text.primary} fillOpacity="0.95"/>
                          </svg>
                      </div>
                  )}
              </div>

            </div>

            {/* END CALL BUTTON */}
            {showEndCall && (
              <div 
                  data-svg-wrapper 
                  data-layer="end call button." 
                  className="EndCallButton" 
                  onClick={onEndCall} 
                  onMouseEnter={() => isHoverCapable() && setIsEndCallTooltipHovered(true)}
                  onMouseLeave={() => setIsEndCallTooltipHovered(false)}
                  style={{
                      cursor: "pointer", 
                      flexShrink: 0, 
                      pointerEvents: "auto",
                      position: "relative"
                  }}
              >
                {isEndCallTooltipHovered && (
                    <Tooltip style={{
                        bottom: "100%",
                        left: "50%",
                        transform: isMobileLayout ? "translate(-50%, -4px)" : "translate(-50%, -4px)",
                    }}>
                        End call
                    </Tooltip>
                )}
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
})

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

// --- HELPER COMPONENT: REPORT MODAL ---
interface ReportModalProps {
    isOpen: boolean
    onClose: () => void
    onSubmit: (reason: string) => void
}

function ReportModal({ isOpen, onClose, onSubmit }: ReportModalProps) {
    const [selected, setSelected] = React.useState<string | null>(null)
    const [hoveredRow, setHoveredRow] = React.useState<string | null>(null)
    
    const reasons = [
        "Violence & self-harm",
        "Sexual exploitation & abuse",
        "Child/teen exploitation",
        "Bullying & harassment",
        "Spam, fraud & deception",
        "Privacy violation",
        "Intellectual property",
        "Age-inappropriate content",
        "Something else"
    ]

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose()
    }

    if (!isOpen) return null

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0, 0, 0, 0.8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10000,
                padding: 24,
            }}
            onClick={handleBackdropClick}
        >
            <div
                style={{
                    width: "100%",
                    maxWidth: 400,
                    background: "#1E1E1E",
                    borderRadius: 28,
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                    border: "1px solid rgba(255,255,255,0.05)"
                }}
            >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ color: "white", fontSize: 18, fontWeight: "600" }}>Report user</div>
                    <button 
                        onClick={onClose}
                        style={{ 
                            background: "transparent", 
                            border: "none", 
                            color: "white", 
                            cursor: "pointer", 
                            padding: 0,
                            opacity: 0.8,
                            marginTop: -4
                        }}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                </div>

                <div style={{ color: "white", fontSize: 16, fontWeight: "500", marginTop: 4 }}>Why are you reporting this user?</div>

                {/* Options List */}
                <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
                    {reasons.map((reason) => (
                        <div 
                            key={reason}
                            onClick={() => setSelected(reason)}
                            onMouseEnter={() => setHoveredRow(reason)}
                            onMouseLeave={() => setHoveredRow(null)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "8px 0",
                                cursor: "pointer",
                            }}
                        >
                            <div style={{
                                width: 16,
                                height: 16,
                                borderRadius: "50%",
                                border: `0.33px solid ${selected === reason ? "white" : "rgba(255,255,255,0.65)"}`,
                                background: hoveredRow === reason ? "rgba(255, 255, 255, 0.24)" : "transparent",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxSizing: "border-box"
                            }}>
                                {selected === reason && (
                                    <div style={{ 
                                        width: 7, 
                                        height: 7, 
                                        borderRadius: "50%", 
                                        background: "white" 
                                    }} />
                                )}
                            </div>
                            <div style={{ 
                                color: "white", 
                                fontSize: 16, 
                                fontWeight: "400",
                                opacity: 0.95 
                            }}>{reason}</div>
                        </div>
                    ))}
                </div>

                {/* Footer / Submit */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                    <button 
                        disabled={!selected}
                        onClick={() => selected && onSubmit(selected)}
                        style={{
                            padding: "10px 12px",
                            borderRadius: 28,
                            background: selected ? "white" : "rgba(255, 255, 255, 0.5)",
                            color: selected ? "black" : "rgba(255,255,255,0.5)",
                            border: "none",
                            fontSize: 14,
                            fontWeight: "500",
                            cursor: selected ? "pointer" : "default",
                            boxSizing: "border-box"
                        }}
                    >
                        Submit
                    </button>
                </div>
            </div>
        </div>
    )
}

// --- HELPER: PII & SAFETY FILTER ---
function sanitizeMessage(text: string): string {
    let sanitized = text
    
    // Helper to replace match with exact length of asterisks
    const replaceWithStars = (match: string) => "*".repeat(match.length)

    // 1. Social Security Numbers (XXX-XX-XXXX)
    sanitized = sanitized.replace(/\b\d{3}-\d{2}-\d{4}\b/g, replaceWithStars)

    // 2. Phone Numbers (US formats)
    sanitized = sanitized.replace(/\b(\+?\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, replaceWithStars)

    // 3. Emails
    sanitized = sanitized.replace(/\b[\w\.-]+@[\w\.-]+\.\w{2,}\b/gi, replaceWithStars)

    // 4. Addresses & Zip Codes
    // Addresses
    sanitized = sanitized.replace(/\b\d+\s+[A-Za-z0-9\s]+\s+(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Way|Place|Pl\.?|Square|Sq\.?)\b/gi, replaceWithStars)
    // Zip codes
    sanitized = sanitized.replace(/\b\d{5}(?:-\d{4})?\b/g, replaceWithStars)

    // 5. Credit/Debit Cards (13-19 digits, possibly with spaces or dashes)
    sanitized = sanitized.replace(/\b(?:\d[ -]*?){13,16}\b/g, replaceWithStars)

    // 6. Gift Card & Financial Scams
    sanitized = sanitized.replace(/\b(gift\s?card|steam\s?card|google\s?play\s?card|amazon\s?card|itunes\s?card|vanilla\s?visa|apple\s?card|xbox\s?card|playstation\s?card|target\s?card|walmart\s?card|sephora\s?card|ebay\s?card)\b/gi, replaceWithStars)
    sanitized = sanitized.replace(/\b(western\s?union|moneygram|wire\s?transfer|bitcoin\s?atm|crypto\s?wallet|cash\s?app|venmo|zelle|paypal)\b/gi, replaceWithStars)
    sanitized = sanitized.replace(/(send\s?money|verify\s?your\s?account|account\s?suspended|claim\s?your\s?prize|you(?:'ve| have)\s?won)/gi, replaceWithStars)

    // 7. Links (Standard URLs & Evasions)
    // Allow .gov and .edu URLs by temporarily masking them
    const whitelistRegex = /\b([a-zA-Z0-9.-]+\.(?:gov|edu)(?:\/[^\s]*)?)\b/gi
    const whitelistedUrls: string[] = []
    sanitized = sanitized.replace(whitelistRegex, (match) => {
        whitelistedUrls.push(match)
        return `__WHITELIST_URL_${whitelistedUrls.length - 1}__`
    })

    sanitized = sanitized.replace(/(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi, replaceWithStars)
    sanitized = sanitized.replace(/\b\w+\s*([(\[{]\s*)?(\.|dot|\(\))\s*([)\]}]\s*)?(com|net|org|io|co|me|xyz|biz|info|ai|gg|tv|app|dev|ly|link|top|club|online|site|store|ru|su|cn|tk|ml|cf|ga|finance|trade|exchange|wallet|token|support|help|verify|secure|live|stream|click|buzz|gd)\b/gi, replaceWithStars)
    sanitized = sanitized.replace(/\b\w+dot(com|net|org|io|co|me|xyz|biz|info|ai|gg|tv|app|dev|ly|link|top|club|online|site|store|ru|su|cn|tk|ml|cf|ga|finance|trade|exchange|wallet|token|support|help|verify|secure|live|stream|click|buzz|gd)\b/gi, replaceWithStars)

    // Restore whitelisted URLs
    sanitized = sanitized.replace(/__WHITELIST_URL_(\d+)__/g, (_, index) => whitelistedUrls[parseInt(index)])


    // 8. Safety & Profanity Filter
    const badWords = [
        "amateur", "anus", "ass", "balls", "barely legal", "bj", "blowjob", "boobs", "bondage",
        "boner", "breasts", "bukkake", "bush", "busty", "cam girl", "catfish", "climax", "clit", "clitoris",
        "cock", "cocksucker", "cp", "creampie", "cum", "cumshot", "curvy", "deepthroat", "dick", "dickhead",
        "dickwad", "dickweed", "dildo", "dilf", "dom", "dp", "dripping", "ejaculate", "ejaculation",
        "erection", "erotic", "escort", "exhibitionist", "explicit", "facial", "fetish",
        "fingering", "foreplay", "gangbang", "groomer", "grooming", "handjob", "hard on", "hardcore",
        "hentai", "hj", "hooker", "horny", "incest", "jacking", "jerking", "jizz", "kink", "labia",
        "lolita", "masturbate", "masturbation", "masturbating", "masochist", "milf", "molest", "molested",
        "molester", "molesting", "moan", "necrophilia", "nude", "nudes", "nudity", "nsfw", "onlyfans",
        "oral", "orgasm", "pedo", "pedophile", "penetrate", "penetration", "penis", "precum", "prostitute",
        "pubes", "pubic", "pounding", "pussy", "rape", "raped", "rapist", "raping", "rectum", "revenge porn",
        "rimjob", "rimming", "sack", "sadist", "scat", "scrotum", "semen", "sex", "sext", "sexting",
        "sexy", "softcore", "sperm", "squirt", "stalker", "stalking", "stripper", "sub", "teen", "testicles",
        "thicc", "thot", "threesome", "thrust", "tits", "titties", "twerk", "underage", "vagina", "vibrator", "voyeur",
        "wanking", "watersports", "xxx", "zoophilia",
        
        // Profanity / Vulgar Language
        "fuck", "fucking", "fucked", "fucker", "motherfucker", "motherfucking",
        "shit", "shitting", "shitted", "shithead", "shitty", "bullshit",
        "bitch", "bitching", "bitched", "bitchy",
        "asshole", "cunt", "whore", "slut", "hoe", 
        
        // Self-Harm / Violence
        "suicide", "kill yourself", "die", "kys",
        
        // Grooming / Predator Keywords
        "asl", "meetup", "open bob", "send pic", "take it off",
        
        // Security / Phishing Prevention
        "account number", "amino", "apple", "badoo", "bumble", "cash app", "chatroulette", "discord", "facebook", "fb", "gmail", "google", "microsoft",
        "fortnite", "grindr", "hinge", "hoop", "instagram", "kik", "line", "liveme", "meetme", "messenger",
        "minecraft", "monkey", "password", "passwords", "paypal", "pin", "reddit", "roblox", "signal",
        "skype", "snap", "snapchat", "ssn", "telegram", "tiktok", "tinder", "twitch", "twitter", "wechat",
        "user name", "username", "venmo", "viber", "wechat", "whisper", "wink", "x app", "youtube", "yubo", "zelle", "bank", "bank account",
        // General Insults / Name Calling
        "dumb", "stupid", "idiot", "loser", "ugly", "fat", "fatty", "gross", "creep", "weirdo", 
        "annoying", "pathetic", "worthless", "trash", "garbage", "scum", "filth",
        "moron", "imbecile", "dunce", "fool", "clown", "joke",
        
        // Racial/Ethnic Slurs
        "beaner", "border hopper", "bumpkin", "camel jockey", "chink", "cholo", "coon", "cracker", "dune coon",
        "ghetto", "gook", "greaser", "gypsy", "gyp", "hayseed", "heeb", "hick", "hillbilly", "honky", "injun", "jap",
        "jungle bunny", "kike", "nigga", "nigger", "nip", "paki", "peckerwood", "pikey",
        "porch monkey", "raghead", "redneck", "redskin", "sand nigger", "slant", "slope",
        "spic", "squaw", "tar baby", "towelhead", "trailer trash", "wetback", "white trash", "yid", "yokel", "zipperhead",
        
        // Homophobic/Transphobic Slurs
        "dyke", "fag", "faggot", "fgt", "fruitcake", "gaylord", "homo",
        "ladyboy", "lezzie", "lesbo", "shemale", "tranny",
        
        // Ableist Slurs
        "cripple", "downie", "downs", "dwarf", "gimp", "imbecile", "lame",
        "midget", "mongoloid", "retard", "spaz", "spastic",
        
        // Slur Euphemisms / Indirect References
        "f word", "f-word", "hard r", "hard r word", "n word", "n-word",
        "r-word", "soft r", "soft r word", "r word",
        
        // Gen Z Derogatory Terms
        "boomer", "karen", "simp", "incel", "cuck", "soyboy",
        
        // Controversial / Political Topics
        "israel", "palestine", "gaza", "hamas", "idf", "zionist", "genocide"
    ]

    const charMap: Record<string, string> = {
        'a': '[a@4*^àáâãäå]',
        'b': '[b8]',
        'c': '[c(k]',
        'e': '[e3*€èéêë]',
        'g': '[g69]',
        'i': '[i1!|*lìíîï]',
        'l': '[l1|]',
        'o': '[o0*òóôõö]',
        's': '[s$5z]',
        't': '[t7+]',
        'u': '[u*vüùúû]',
        'k': '[k]',
    }

    const createSmartPattern = (word: string) => {
        const hasSpace = word.includes(' ')
        if (hasSpace) {
            return word.split('').map((char, index) => {
                if (char === ' ') return '[\\s\\W_]+'
                const lower = char.toLowerCase()
                const chars = charMap[lower] || (lower.match(/[a-z0-9]/i) ? lower : `\\${lower}`)
                return index === word.length - 1 ? chars : `${chars}[\\W_]{0,20}`
            }).join('')
        }
        // Single words: create patterns for normal, spaced-out, dotted, and concatenated
        const normalPattern = word.split('').map((char) => {
            const lower = char.toLowerCase()
            return charMap[lower] || (lower.match(/[a-z0-9]/i) ? lower : `\\${lower}`)
        }).join('')
        
        const spacedPattern = word.split('').map((char, index) => {
            const lower = char.toLowerCase()
            const chars = charMap[lower] || (lower.match(/[a-z0-9]/i) ? lower : `\\${lower}`)
            return index === word.length - 1 ? chars : `${chars}[\\s\\W_]{1,5}`
        }).join('')
        
        // Dotted pattern: catches evasions like "f.aggot" or "f.ucking" with dots/punctuation
        const dottedPattern = word.split('').map((char, index) => {
            const lower = char.toLowerCase()
            const chars = charMap[lower] || (lower.match(/[a-z0-9]/i) ? lower : `\\${lower}`)
            return index === word.length - 1 ? chars : `${chars}[\\W_]{1,3}`
        }).join('')
        
        // Concatenated pattern: matches word when followed by another word char (like "bitch" in "bitchwhore")
        const concatenatedPattern = word.split('').map((char) => {
            const lower = char.toLowerCase()
            return charMap[lower] || (lower.match(/[a-z0-9]/i) ? lower : `\\${lower}`)
        }).join('')
        
        // Dotted concatenated: catches "f.ucking" in "f.uckingb.itchc.unt"
        const dottedConcatenatedPattern = word.split('').map((char, index) => {
            const lower = char.toLowerCase()
            const chars = charMap[lower] || (lower.match(/[a-z0-9]/i) ? lower : `\\${lower}`)
            return index === word.length - 1 ? chars : `${chars}[\\W_]{1,3}`
        }).join('')
        
        return `\\b(?:${normalPattern}\\b|${spacedPattern}\\b|${dottedPattern}\\b|${concatenatedPattern}(?=\\w)|${dottedConcatenatedPattern}(?=\\w))`
    }

    const badPatterns = badWords.map(createSmartPattern)
    const combinedRegex = new RegExp(`(${badPatterns.join('|')})`, 'gi')
    
    sanitized = sanitized.replace(combinedRegex, (match) => {
        return match.split('').map((char, index) => index % 3 === 0 ? char : '*').join('')
    })

    return sanitized
}

// --- HELPER: LIVE CURSOR ---
const RAINBOW_COLORS = [
    "#FF3B30", // Red
    "#FF9500", // Orange
    "#FFCC00", // Yellow
    "#34C759", // Green
    "#32ADE6", // Cyan
    "#007AFF", // Blue
    "#AF52DE", // Purple
    "#FF2D55", // Pink
]

function getRandomRainbowColor() {
    return RAINBOW_COLORS[Math.floor(Math.random() * RAINBOW_COLORS.length)]
}

function LiveCursor({ x, y, color }: { x: number, y: number, color: string }) {
    return (
        <div
            style={{
                position: "absolute",
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                pointerEvents: "none",
                zIndex: 9999,
            }}
        >
            <svg 
                width="32" 
                height="32" 
                viewBox="0 0 28 28" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
                style={{
                    transform: "rotate(-16deg)", // Slight left tilt
                }}
            >
                <path d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z" fill={color} stroke="white" strokeWidth="1.5"/>
            </svg>
        </div>
    )
}


// --- HELPER COMPONENT: MESSAGE BUBBLE (MEMOIZED) ---
const MessageBubble = React.memo(({ 
    msg, 
    isMobileLayout,
    id,
    isLast,
    themeColors = darkColors
}: { 
    msg: Message, 
    isMobileLayout: boolean,
    id?: string,
    isLast?: boolean,
    themeColors?: typeof darkColors
}) => {
    // Memoize base styles to avoid recreation
    const baseTextStyle = React.useMemo(() => ({ 
        fontSize: 16, 
        color: themeColors.text.primary, 
        lineHeight: 1.6 
    }), [themeColors])

    const linkStyle = React.useMemo(() => ({ 
        color: themeColors.text.link, 
        textDecoration: "underline" 
    }), [themeColors])

    return (
        <div id={id} style={{ 
            display: "flex", 
            justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            width: "100%",
            scrollMarginTop: 24,
            // FIX: Removed "Snap to Top" min-height logic as it caused excessive scrolling space.
            minHeight: "auto"
        }}>
            <div style={{ 
                maxWidth: (msg.role === "user" || msg.role === "peer") ? "80%" : "100%", 
                width: (msg.role === "user" || msg.role === "peer") ? "auto" : "100%",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: msg.role === "user" ? "flex-end" : "flex-start"
            }}>
                {/* Attachments rendering */}
                {(msg.role === "user" || msg.role === "peer") && msg.attachments && msg.attachments.length > 0 && (() => {
                    const mediaAttachments = msg.attachments.filter(a => a.type === 'image' || a.type === 'video')
                    const fileAttachments = msg.attachments.filter(a => a.type !== 'image' && a.type !== 'video')

                    return (
                        <>
                            {/* 1. Media Grid (Images/Videos) */}
                            {mediaAttachments.length > 0 && (
                                <div style={{ 
                                    display: "grid", 
                                    gridTemplateColumns: mediaAttachments.length === 1 ? "1fr" : "repeat(auto-fit, minmax(96px, 1fr))", 
                                    gap: 4, 
                                    width: "100%",
                                    marginBottom: 4
                                }}>
                                    {mediaAttachments.map((att, i) => (
                                        <React.Fragment key={i}>
                                            {att.type === 'video' ? (
                                                <div style={styles.videoCardSmall}>
                                                    <video 
                                                        src={att.url} 
                                                        controls 
                                                        style={styles.fullSize}
                                                    />
                                                </div>
                                            ) : (
                                                mediaAttachments.length === 1 ? (
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
                                                        background: themeColors.background === "#FFFFFF" ? "rgba(0, 0, 0, 0.05)" : "rgba(255,255,255,0.05)"
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
                                                )
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
                                    alignItems: msg.role === "user" ? "flex-end" : "flex-start",
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
                        padding: msg.role === "user" || msg.role === "peer" ? "6px 16px" : "0", 
                        borderRadius: msg.role === "user" || msg.role === "peer" ? 20 : 0,
                        background: (msg.role === "user" || msg.role === "peer")
                            ? (themeColors.background === "#FFFFFF" ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.08)")
                            : "transparent",
                        color: themeColors.text.primary,
                        lineHeight: 1.6,
                        fontSize: 16,
                        alignSelf: msg.role === "user" ? "flex-end" : "flex-start"
                    }}>
                        {msg.role === "user" || msg.role === "peer"
                            ? msg.text 
                            : renderSimpleMarkdown(
                                msg.text, 
                                baseTextStyle,
                                linkStyle
                              )
                        }
                    </div>
                )}
            </div>
        </div>
    )
})

// --- HELPER COMPONENTS ---

const RoleSelectionButton = React.memo(({ type, isCompact, isMobileLayout, colors }: { type: 'student' | 'mentor', isCompact: boolean, isMobileLayout: boolean, colors: typeof darkColors }) => {
    const isStudent = type === 'student'
    const label = isStudent ? "Get free help" : "Volunteer"
    const desc = isStudent ? "I'm a student looking for a mentor" : "I want to offer free advice"
    const textColor = isStudent ? 'white' : colors.text.primary
    const isLightMode = colors.background === "#FFFFFF"

    if (isCompact) {
        return (
            <div 
                style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    height: '100%', 
                    width: '100%',
                    background: isStudent ? colors.state.accent : (isLightMode ? colors.surface : undefined), // Light mode: use surface color for volunteer tile
                    color: textColor, 
                    fontSize: 15,
                    fontWeight: 600,
                    textAlign: "center",
                    padding: 8
                }}
            >
                {label}
            </div>
        )
    }

    return (
            <div style={{ padding: isMobileLayout ? 48 : 96, display: "flex", flexDirection: "column", gap: 24, height: "100%" }}>
            <div style={{ color: textColor, fontSize: '24px', fontWeight: '600', lineHeight: '1.2' }}>{label}</div>
            <div style={{ color: textColor, fontSize: '15px', fontWeight: '400', lineHeight: '1.4', opacity: 0.9 }}>{desc}</div>
        </div>
    )
})

/**
 * OmegleMentorshipUI
 * Main component handling video streaming, real-time signaling, and AI-assisted chat.
 */

// --- HELPER: MEDIA CAPTURE ---
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const res = reader.result as string
            resolve(res.substring(res.indexOf(",") + 1))
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

const captureVideoFrame = async (streamOrTrack: MediaStream | MediaStreamTrack | null): Promise<Blob | null> => {
    if (!streamOrTrack) return null
    try {
        const track = 'getVideoTracks' in streamOrTrack ? streamOrTrack.getVideoTracks()[0] : streamOrTrack
        if (!track || track.kind !== 'video') return null
        
        // Use ImageCapture if available
        if ('ImageCapture' in window) {
            const imageCapture = new (window as any).ImageCapture(track)
            const bitmap = await imageCapture.grabFrame()
            
            // Resize to max 800px width/height to save bandwidth/processing
            const canvas = document.createElement('canvas')
            const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height))
            canvas.width = bitmap.width * scale
            canvas.height = bitmap.height * scale
            
            const ctx = canvas.getContext('2d')
            if (!ctx) {
                bitmap.close()
                return null
            }
            
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
            bitmap.close() // Important: Release memory
            
            return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7))
        }
        return null
    } catch (e) { 
        return null 
    }
}

export default function OmegleMentorshipUI(props: Props) {
    const { geminiApiKey, systemPrompt, accentColor, model = "gemini-2.5-flash-lite", debugMode = false } = props

    /**
     * User's session role.
     * student: "Get free help" user seeking guidance.
     * mentor:  "Volunteer" user providing guidance.
     */
    const [role, setRole] = React.useState<"student" | "mentor" | null>(null)
    const roleRef = React.useRef(role)
    React.useEffect(() => { roleRef.current = role }, [role])

    // --- STATE: WEBRTC & CONNECTIVITY ---
    // status: tracks the lifecycle of the connection (idle -> searching -> connected)
    const [status, setStatus] = React.useState("idle")
    const [ready, setReady] = React.useState(false) // Tracks if external scripts are loaded
    const [isScreenSharing, setIsScreenSharing] = React.useState(false)
    const [isWhiteboardOpen, setIsWhiteboardOpen] = React.useState(false)
    const [hasWhiteboardStarted, setHasWhiteboardStarted] = React.useState(false)
    
    // --- STATE: DOC EDITOR ---
    const [isDocOpen, setIsDocOpen] = React.useState(false)
    const isDocOpenRef = React.useRef(isDocOpen)
    React.useEffect(() => { isDocOpenRef.current = isDocOpen }, [isDocOpen])
    
    // --- THEME LOGIC ---
    const isLightMode = false // Always dark mode for shell, DocEditor handles its own light theme
    const themeColors = isLightMode ? lightColors : darkColors
    const chatThemeColors = (isDocOpen || isWhiteboardOpen) ? lightColors : themeColors
    // Shadow global styles with themed styles
    const styles = React.useMemo(() => getStyles(themeColors), [themeColors])
    const [docContent, setDocContent] = React.useState(`
<h1>Welcome to your notes 🩵 </h1>
<p>You can start typing or ask AI to write resumes, make study guides, draft messages, and so much more. </p>
    `.trim())
    interface DocSettings {
        fontStyle: 'serif' | 'sans';
        fontSize: number; // Base font size
        h1Size: number;
        h2Size: number;
        pSize: number;
    }

    const [docSettings, setDocSettings] = React.useState<DocSettings>({ 
        fontStyle: 'sans', 
        fontSize: 15,
        h1Size: 24, 
        h2Size: 17,
        pSize: 15 
    })
    const [remoteCursor, setRemoteCursor] = React.useState<{ x: number, y: number, color: string } | null>(null)
    const whiteboardContainerRef = React.useRef<HTMLDivElement>(null)
    const myCursorColor = React.useRef(getRandomRainbowColor())
    const lastCursorUpdate = React.useRef(0)
    const [editor, setEditor] = React.useState<any>(null)
    const editorRef = React.useRef<any>(null)
    React.useEffect(() => { editorRef.current = editor }, [editor])

    // --- LOCATION & SYSTEM PROMPT ENHANCEMENT ---
    interface LocationInfo {
        city?: string
        region?: string
        country?: string
    }

    const [locationInfo, setLocationInfo] = React.useState<LocationInfo | null>(null)

    const getSystemPromptWithContext = React.useCallback(() => {
        // Constraint: Only students or unspecified roles get location/time info
        if (role === "mentor") {
            return systemPrompt || ""
        }

        const now = new Date()
        const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        
        let prompt = systemPrompt || ""
        prompt += `\n\n[System Context]\nCurrent Date: ${dateStr}\nCurrent Time: ${timeStr}`

        if (locationInfo) {
            prompt += `\nLocation: ${locationInfo.city}, ${locationInfo.region}, ${locationInfo.country}`
        }

        return prompt
    }, [systemPrompt, locationInfo, role])

    React.useEffect(() => {
        if (typeof window === "undefined") return

        const fetchLocation = async () => {
             try {
                 const cached = localStorage.getItem("user_location_info")
                 if (cached) {
                     setLocationInfo(JSON.parse(cached))
                     return
                 }
             } catch (e) {}

             try {
                 // Free IP Geolocation API (ipwho.is) - No key required
                 // 5s timeout to prevent hanging
                 const controller = new AbortController()
                 const id = setTimeout(() => controller.abort(), 5000)
                 
                 const res = await fetch("https://ipwho.is/", { signal: controller.signal })
                 clearTimeout(id)

                 if (res.ok) {
                     const data = await res.json()
                     if (data.success !== false) {
                         const info: LocationInfo = {
                             city: data.city,
                             region: data.region,
                             country: data.country
                         }
                         setLocationInfo(info)
                         localStorage.setItem("user_location_info", JSON.stringify(info))
                     }
                 }
             } catch (e) {
                 // Silently fail - optional enhancement allows graceful degradation
             }
        }
        
        fetchLocation()
    }, [])

    const isWhiteboardOpenRef = React.useRef(false)
    const docTimeoutRef = React.useRef<any>(null) // Debounce/Throttle for doc editor
    const lastDocSendTimeRef = React.useRef<number>(0)
    const inputTimeoutRef = React.useRef<any>(null)
    const lastInputSendTimeRef = React.useRef<number>(0)
    const lastAISendTimeRef = React.useRef<number>(0)
    React.useEffect(() => { isWhiteboardOpenRef.current = isWhiteboardOpen }, [isWhiteboardOpen])

    const hasWhiteboardStartedRef = React.useRef(false)
    React.useEffect(() => { hasWhiteboardStartedRef.current = hasWhiteboardStarted }, [hasWhiteboardStarted])

    const pendingSnapshotRef = React.useRef<any>(null)
    const isScreenSharingRef = React.useRef(false)
    React.useEffect(() => { isScreenSharingRef.current = isScreenSharing }, [isScreenSharing])

    // --- VIEWPORT & SCROLL HANDLING ---
    // Fix for iOS Safari keyboard shifting the viewport
    React.useEffect(() => {
        if (typeof window === "undefined" || !window.visualViewport) return

        const handleResize = () => {
            if (containerRef.current && window.visualViewport) {
                // Adjust container height to match visual viewport
                // This prevents the keyboard from pushing content off-screen on iOS Safari
                // We set the height explicitly because 100vh includes the area under the keyboard
                containerRef.current.style.height = `${window.visualViewport.height}px`
                
                // Force scroll to top to counteract any browser auto-scroll behavior
                // when the keyboard opens, keeping the UI anchored correctly
                window.scrollTo(0, 0)
            }
        }

        window.visualViewport.addEventListener("resize", handleResize)
        window.visualViewport.addEventListener("scroll", handleResize)
        
        return () => {
            if (window.visualViewport) {
                window.visualViewport.removeEventListener("resize", handleResize)
                window.visualViewport.removeEventListener("scroll", handleResize)
            }
        }
    }, [])

    // Tldraw sync
    React.useEffect(() => {
        // Inject Tldraw CSS
        const link = document.createElement('link')
        link.href = "https://esm.sh/tldraw@2.1.0/tldraw.css"
        link.rel = "stylesheet"
        document.head.appendChild(link)

        if (!editor) {
             return () => {
                if (document.head.contains(link)) {
                    document.head.removeChild(link)
                }
            }
        }
        
        // Load pending snapshot if exists
        if (pendingSnapshotRef.current) {
            log("Applying pending Tldraw snapshot...")
            try {
                // Same filtering logic as above for pending snapshot
                const snapshot = pendingSnapshotRef.current
                editor.store.mergeRemoteChanges(() => {
                     const records = Object.values(snapshot)
                     const contentRecords = records.filter((r: any) => 
                         r.typeName === 'shape' || 
                         r.typeName === 'asset' || 
                         r.typeName === 'page' ||
                         r.typeName === 'document'
                     )
                     if (contentRecords.length > 0) {
                         editor.store.put(contentRecords)
                     }
                })
                log("Merged pending tldraw snapshot content successfully")
            } catch (e) {
                log(`Error merging pending tldraw snapshot: ${e}`)
            }
            pendingSnapshotRef.current = null
        }
        
        const cleanup = editor.store.listen((update: any) => {
            // Only broadcast local changes (source='user')
            if (update.source === 'user') {
                // Filter changes to exclude presence/camera updates which shouldn't be synced
                // Tldraw v2 uses types like 'instance', 'camera', 'pointer', etc.
                
                const filteredChanges: any = { added: {}, updated: {}, removed: {} }
                let hasChanges = false

                const isSyncable = (typeName: string) => {
                    // Sync content, allow most types but exclude local user state
                    const localTypes = new Set([
                        'instance',
                        'instance_page_state',
                        'user',
                        'user_document',
                        'user_presence',
                        'camera',
                        'pointer'
                    ])
                    return !localTypes.has(typeName)
                }

                // Filter Added
                Object.values(update.changes.added).forEach((record: any) => {
                    if (isSyncable(record.typeName)) {
                        filteredChanges.added[record.id] = record
                        hasChanges = true
                    }
                })

                // Filter Updated
                Object.entries(update.changes.updated).forEach(([id, diff]: [string, any]) => {
                    // diff is [from, to]
                    if (isSyncable(diff[1].typeName)) {
                        filteredChanges.updated[id] = diff
                        hasChanges = true
                    }
                })

                // Filter Removed
                Object.values(update.changes.removed).forEach((record: any) => {
                    if (isSyncable(record.typeName)) {
                        filteredChanges.removed[record.id] = record
                        hasChanges = true
                    }
                })

                if (hasChanges && dataConnectionRef.current && dataConnectionRef.current.open) {
                    // log(`Sending update: ${Object.keys(filteredChanges.added).length} added, ${Object.keys(filteredChanges.updated).length} updated`)
                    dataConnectionRef.current.send({
                        type: 'tldraw-update',
                        payload: filteredChanges
                    })
                }
            }
        })
        
        return () => {
            cleanup()
            if (document.head.contains(link)) {
                document.head.removeChild(link)
            }
        }
    }, [editor])

    // --- STATE: GEMINI LIVE ---
    const [isLiveMode, setIsLiveMode] = React.useState(false)
    const lastLiveUpdateRef = React.useRef(Date.now())

    React.useEffect(() => {
        if (!isLiveMode) return

        const checkTimeUpdate = () => {
            if (typeof window === "undefined") return
            
            const now = Date.now()
            // Update every 10 minutes (600,000ms) as requested
            // Note: We check every minute, but only send if 10m elapsed
            if (now - lastLiveUpdateRef.current > 600000 && liveClientRef.current && liveClientRef.current.readyState === WebSocket.OPEN) {
                lastLiveUpdateRef.current = now
                
                const date = new Date()
                const timeContext = `[System Update] Current Date: ${date.toLocaleDateString()}, Current Time: ${date.toLocaleTimeString()}`
                
                // Send invisible context update to model via clientContent
                liveClientRef.current.send(JSON.stringify({
                    clientContent: {
                        turns: [{
                            role: "user",
                            parts: [{ text: timeContext }]
                        }],
                        turnComplete: true
                    }
                }))
                if (debugMode) log("Sent time update to Gemini Live session")
            }
        }

        const interval = setInterval(checkTimeUpdate, 60000) // Check every minute
        return () => clearInterval(interval)
    }, [isLiveMode, debugMode])

    const [userIsSpeaking, setUserIsSpeaking] = React.useState(false)
    const [isLiveGenerating, setIsLiveGenerating] = React.useState(false)
    
    const liveClientRef = React.useRef<WebSocket | null>(null)
    const liveAudioContextRef = React.useRef<AudioContext | null>(null)
    const liveSourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null)
    const liveProcessorRef = React.useRef<ScriptProcessorNode | null>(null)
    const liveInputStreamRef = React.useRef<MediaStream | null>(null)
    const activeAudioSourcesRef = React.useRef<AudioBufferSourceNode[]>([])
    const liveNextPlayTimeRef = React.useRef<number>(0)
    const transcriptionTimeoutRef = React.useRef<any>(null)
    const silenceTimerRef = React.useRef<any | null>(null)
    const isUserMessageInProgressRef = React.useRef(false)
    const suggestionsGeneratedForTurnRef = React.useRef(false)
    const lastUserSpeechTimeRef = React.useRef(0)
    const userIsSpeakingRef = React.useRef(false)
    const isLiveGeneratingRef = React.useRef(false)



    const stopAllAudio = React.useCallback(() => {
        if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.cancel()
        }
        activeAudioSourcesRef.current.forEach((source) => {
            try {
                source.stop()
            } catch (e) {
                // Ignore
            }
        })
        activeAudioSourcesRef.current = []
        // Reset play time so next audio plays immediately
        if (liveAudioContextRef.current) {
            liveNextPlayTimeRef.current = liveAudioContextRef.current.currentTime + 0.1
        }
    }, [])

    const captureCurrentContext = React.useCallback(async () => {
        try {
            // Priority 1: Screen Share
            if (isScreenSharingRef.current && screenStreamRef.current) {
                const track = screenStreamRef.current.getVideoTracks()[0]
                if (track && track.readyState === "live") {
                    return new Promise<string | null>((resolve) => {
                        const vid = document.createElement('video')
                        vid.muted = true
                        vid.playsInline = true
                        vid.srcObject = screenStreamRef.current
                        vid.onloadedmetadata = () => {
                             vid.play().then(() => {
                                const cvs = document.createElement('canvas')
                                cvs.width = vid.videoWidth
                                cvs.height = vid.videoHeight
                                const ctx = cvs.getContext('2d')
                                ctx?.drawImage(vid, 0, 0)
                                resolve(cvs.toDataURL('image/jpeg', 0.6).split(',')[1])
                                // Cleanup
                                vid.pause()
                                vid.srcObject = null
                                vid.remove()
                            }).catch((e) => {
                                console.warn("Video play failed", e)
                                resolve(null)
                            })
                        }
                        vid.onerror = () => resolve(null)
                    })
                }
            }

            // Priority 2: Whiteboard
            if (isWhiteboardOpenRef.current && whiteboardContainerRef.current) {
                 // Try to find canvas (Tldraw usually renders a canvas)
                 const canvas = whiteboardContainerRef.current.querySelector('canvas')
                 if (canvas) {
                     return canvas.toDataURL('image/jpeg', 0.6).split(',')[1]
                 }
                 // If no canvas (e.g. SVG mode), try exportToBlob if available
                 if (editorRef.current && exportToBlob) {
                     try {
                        // @ts-ignore
                        const shapes = Array.from(editorRef.current.getCurrentPageShapes())
                        if (shapes.length > 0) {
                            const ids = shapes.map((s: any) => s.id)
                            const blob = await exportToBlob({ 
                                editor: editorRef.current, 
                                ids, 
                                format: 'jpeg', 
                                opts: { background: true } 
                            })
                            return new Promise((resolve) => {
                                const reader = new FileReader()
                                reader.onloadend = () => resolve((reader.result as string).split(',')[1])
                                reader.readAsDataURL(blob)
                            })
                        }
                     } catch(e) {}
                 }
            }
        } catch (e) {
            console.error("Capture context error", e)
        }
        return null
    }, [])

    const fetchAiSuggestions = React.useCallback(
        async (lastAiMessageContent: string) => {
            if (!geminiApiKey || !lastAiMessageContent.trim()) {
                return
            }

            // Capture context if available
            const visualContext = await captureCurrentContext()
            
            try {
                const systemInstruction = `You are a helpful AI assistant.
Your goal is to suggest 3 short, relevant follow-up responses the USER might want to say next.
Keep suggestions brief (under 10 words).
Output ONLY a JSON array of strings: ["suggestion 1", "suggestion 2", "suggestion 3"].
Do not include markdown formatting or explanations.`

                const userContent: any[] = [
                    { text: `The AI just said: "${lastAiMessageContent}". What are 3 relevant follow-up things I (the user) might say next?` }
                ]

                if (visualContext) {
                    userContent.push({
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: visualContext
                        }
                    })
                }

                // If document is open, include it for context
                if (isDocOpen) {
                    userContent.push({ text: `Current document content: \n${docContent}` })
                }

                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${SUGGESTION_MODEL_ID}:generateContent?key=${geminiApiKey}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{ role: "user", parts: userContent }],
                            systemInstruction: { parts: [{ text: systemInstruction }] },
                            generationConfig: { responseMimeType: "application/json" }
                        }),
                    }
                )

                if (!response.ok) return

                const data = await response.json()
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text
                if (text) {
                    const parsed = JSON.parse(text)
                    if (Array.isArray(parsed)) {
                        // setSuggestions(parsed.slice(0, 3)) 
                        // Suggestion logic needs to be connected or removed if unused
                    }
                }
            } catch (error) {
                console.error("Suggestion fetch error:", error)
            }
        },
        [geminiApiKey, captureCurrentContext, isDocOpen, docContent]
    )

    const stopLiveSession = React.useCallback(() => {
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
        }
        stopAllAudio()
        if (liveClientRef.current) {
            liveClientRef.current.close()
            liveClientRef.current = null
        }
        if (liveProcessorRef.current) {
            liveProcessorRef.current.disconnect()
            liveProcessorRef.current = null
        }
        if (liveSourceRef.current) {
            liveSourceRef.current.disconnect()
            liveSourceRef.current = null
        }
        if (liveInputStreamRef.current) {
            liveInputStreamRef.current.getTracks().forEach((track) => track.stop())
            liveInputStreamRef.current = null
        }
        
        // Clear local stream if it was set by live session
        if (localStreamRef.current) {
             localStreamRef.current.getTracks().forEach(track => track.stop())
             setLocalStream(null)
             localStreamRef.current = null
        }

        if (liveAudioContextRef.current) {
            liveAudioContextRef.current.close()
            liveAudioContextRef.current = null
        }
        if (transcriptionTimeoutRef.current) {
            clearTimeout(transcriptionTimeoutRef.current)
            transcriptionTimeoutRef.current = null
        }
        setIsLiveMode(false)
        isLiveGeneratingRef.current = false
        setIsLiveGenerating(false)
        userIsSpeakingRef.current = false
        setUserIsSpeaking(false)
        suggestionsGeneratedForTurnRef.current = false
        isUserMessageInProgressRef.current = false
    }, [stopAllAudio])

    const cleanup = React.useCallback(() => {
        const isAiSession = isLiveMode || !!liveClientRef.current

        // Always attempt to stop live session to ensure state is reset
        stopLiveSession()
        
        if (localStreamRef.current)
            localStreamRef.current.getTracks().forEach((t) => t.stop())
        
        // Stop screen share when call ends
        // Manually stop screen share logic here instead of calling function that might not be defined
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach((track: any) => track.stop())
            screenStreamRef.current = null
        }
        if (screenCallRef.current) {
            screenCallRef.current.close()
            screenCallRef.current = null
        }
        setIsScreenSharing(false)
        if (isWhiteboardOpenRef.current) {
             // Re-open whiteboard if it was closed due to screen share
             // But here we are cleaning up everything, so no need.
        }

        if (activeCall.current) activeCall.current.close()
        if (dataConnectionRef.current) dataConnectionRef.current.close()
        
        if (peerInstance.current) peerInstance.current.destroy()
        if (mqttClient.current) mqttClient.current.end()
        
        // Clear state ONLY if it was NOT an AI session (P2P Reset)
        if (!isAiSession) {
            // Clear whiteboard state
            setIsWhiteboardOpen(false)
            setHasWhiteboardStarted(false)
            setEditor(null) 
            setIsDocOpen(false)
            setDocContent(`
<h1>Welcome to your notes 🩵 </h1>
<p>You can start typing or ask AI to write resumes, make study guides, draft messages, and so much more. </p>
            `.trim())

            setMessages([])
            setAttachments([])
            setLogs([])
        }

        setStatus("idle")
        setRole(null)
        setLocalStream(null)
        setRemoteStream(null)
        setRemoteScreenStream(null)
        
        if (typeof window !== "undefined") {
            window.location.hash = ""
        }
    }, [isLiveMode, stopLiveSession])

    const resetSilenceTimer = React.useCallback(() => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = setTimeout(() => {
            log("AI Silence timeout (30s) - hanging up")
            cleanup()
        }, 30000)
    }, [cleanup])

    const startLiveSession = React.useCallback(async () => {
        if (!geminiApiKey) return

        const liveModel = "models/gemini-2.5-flash-native-audio-preview-12-2025"

        try {
            const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`
            const ws = new WebSocket(url)
            liveClientRef.current = ws

            ws.onopen = async () => {
                resetSilenceTimer()
                const currentSystemPrompt = getSystemPromptWithContext()
                // Append doc context if available
                const docContext = isDocOpen ? `\n\n[Current Document Content]:\n${docContent}` : ""
                
                ws.send(
                    JSON.stringify({
                        setup: {
                            model: liveModel,
                            generationConfig: {
                                responseModalities: ["AUDIO"],
                                thinkingConfig: {
                                    thinkingBudget: 0
                                },
                                speechConfig: {
                                    voiceConfig: {
                                        prebuiltVoiceConfig: {
                                            voiceName: "Puck"
                                        }
                                    }
                                }
                            },
                            systemInstruction: {
                                parts: [{ text: currentSystemPrompt + docContext }],
                            },
                            inputAudioTranscription: {},
                            outputAudioTranscription: {},
                        },
                    })
                )

                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
                const audioCtx = new AudioContextClass()
                
                if (audioCtx.state === "suspended") {
                    await audioCtx.resume()
                }

                liveAudioContextRef.current = audioCtx
                liveNextPlayTimeRef.current = audioCtx.currentTime + 0.1

                try {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: {
                            sampleRate: 16000,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true, 
                            autoGainControl: true,
                            latency: 0.01,
                        } as any,
                    })
                    
                    // Set as local stream for UI
                    localStreamRef.current = stream
                    setLocalStream(stream)

                    liveInputStreamRef.current = stream
                    const source = audioCtx.createMediaStreamSource(stream)
                    liveSourceRef.current = source

                    const processor = audioCtx.createScriptProcessor(8192, 1, 1)
                    liveProcessorRef.current = processor

                    let consecutiveSpeechFrames = 0
                    const SPEECH_FRAMES_THRESHOLD = 2

                    processor.onaudioprocess = (e) => {
                        if (!liveClientRef.current) return
                        let inputData = e.inputBuffer.getChannelData(0)

                        // Hardcoded threshold for interruption
                        const interruptionThreshold = 0.01

                        const isSpeaking = detectVoiceActivity(inputData, interruptionThreshold)
                        
                        if (isSpeaking) {
                            consecutiveSpeechFrames++
                            lastUserSpeechTimeRef.current = Date.now()
                            
                            if (consecutiveSpeechFrames >= SPEECH_FRAMES_THRESHOLD && !userIsSpeakingRef.current) {
                                userIsSpeakingRef.current = true
                                setUserIsSpeaking(true)
                                captureCurrentContext().then(b64 => { if (b64 && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "image/jpeg", data: b64 }] } })) } })

                                // CAPTURE CONTEXT IMAGE
                                captureCurrentContext().then(b64 => {
                                    if (b64 && liveClientRef.current && liveClientRef.current.readyState === WebSocket.OPEN) {
                                        liveClientRef.current.send(JSON.stringify({
                                            realtimeInput: {
                                                mediaChunks: [{
                                                    mimeType: "image/jpeg",
                                                    data: b64
                                                }]
                                            }
                                        }))
                                    }
                                })
                            }
                        } else {
                            consecutiveSpeechFrames = 0
                            if (userIsSpeakingRef.current && Date.now() - lastUserSpeechTimeRef.current > 500) {
                                userIsSpeakingRef.current = false
                                setUserIsSpeaking(false)
                            }
                        }

                        const downsampledData = downsampleBuffer(
                            inputData,
                            audioCtx.sampleRate,
                            INPUT_TARGET_SAMPLE_RATE
                        )

                        // HALLUCINATION FIX: Mute audio if no voice detected (Noise Gate)
                        // This prevents background noise from being transcribed as foreign languages
                        if (!userIsSpeakingRef.current && !isSpeaking) {
                            downsampledData.fill(0)
                        }

                        const b64 = float32ToBase64(downsampledData)

                        if (ws.readyState === WebSocket.OPEN && b64.length > 0) {
                            ws.send(
                                JSON.stringify({
                                    realtimeInput: {
                                        mediaChunks: [
                                            {
                                                mimeType: `audio/pcm;rate=${INPUT_TARGET_SAMPLE_RATE}`,
                                                data: b64,
                                            },
                                        ],
                                    },
                                })
                            )
                        }
                    }

                    source.connect(processor)
                    processor.connect(audioCtx.destination)
                } catch (err) {
                    console.error("Audio capture failed", err)
                    stopLiveSession()
                }
            }

            ws.onmessage = async (event) => {
                try {
                    let data
                    if (event.data instanceof Blob) {
                        data = JSON.parse(await event.data.text())
                    } else {
                        data = JSON.parse(event.data)
                    }

                    // Reset silence timer on any AI activity
                    if (data.serverContent?.modelTurn || data.serverContent?.turnComplete) {
                        resetSilenceTimer()
                    }

                    if (data.serverContent?.interrupted) {
                        stopAllAudio()
                        setIsLiveGenerating(false)
                        return
                    }

                    if (data.serverContent?.modelTurn?.parts) {
                        isLiveGeneratingRef.current = true
                        setIsLiveGenerating(true)
                        
                        suggestionsGeneratedForTurnRef.current = false
                        isUserMessageInProgressRef.current = false
                        
                        const parts = data.serverContent.modelTurn.parts
                        for (const part of parts) {
                            if (part.inlineData) {
                                if (
                                    liveAudioContextRef.current &&
                                    part.inlineData.data &&
                                    !data.serverContent?.turnComplete
                                ) {
                                    const audioCtx = liveAudioContextRef.current
                                    const float32 = base64ToFloat32Array(
                                        part.inlineData.data
                                    )
                                    const buffer = audioCtx.createBuffer(
                                        1,
                                        float32.length,
                                        MODEL_OUTPUT_SAMPLE_RATE
                                    )
                                    buffer.copyToChannel(float32, 0)

                                    const source = audioCtx.createBufferSource()
                                    source.buffer = buffer
                                    source.connect(audioCtx.destination)

                                    const now = audioCtx.currentTime
                                    const playTime = Math.max(
                                        now,
                                        liveNextPlayTimeRef.current
                                    )
                                    source.start(playTime)
                                    liveNextPlayTimeRef.current =
                                        playTime + buffer.duration
                                    
                                    activeAudioSourcesRef.current.push(source)
                                    
                                    source.onended = () => {
                                        activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter(s => s !== source)
                                    }
                                }
                            }
                        }
                    }

                    if (data.serverContent?.turnComplete) {
                        isLiveGeneratingRef.current = false
                        setIsLiveGenerating(false)
                        
                        if (transcriptionTimeoutRef.current) {
                            clearTimeout(transcriptionTimeoutRef.current)
                            transcriptionTimeoutRef.current = null
                        }
                        
                        if (!suggestionsGeneratedForTurnRef.current) {
                            setMessages((prev) => {
                                const lastAssistantMsg = [...prev]
                                    .reverse()
                                    .find((m) => m.role === "assistant")
                                
                                if (lastAssistantMsg && lastAssistantMsg.text.trim()) {
                                    fetchAiSuggestions(lastAssistantMsg.text.trim())
                                }
                                return prev
                            })
                        }
                    }

                    if (data.serverContent?.outputTranscription?.text) {
                        const text = data.serverContent.outputTranscription.text
                        
                        if (transcriptionTimeoutRef.current) {
                            clearTimeout(transcriptionTimeoutRef.current)
                        }
                        
                        transcriptionTimeoutRef.current = setTimeout(() => {
                            if (!suggestionsGeneratedForTurnRef.current) {
                                setMessages((prev) => {
                                    const lastAssistantMsg = [...prev]
                                        .reverse()
                                        .find((m) => m.role === "assistant")
                                    
                                    if (lastAssistantMsg && lastAssistantMsg.text.trim()) {
                                        fetchAiSuggestions(lastAssistantMsg.text.trim())
                                        suggestionsGeneratedForTurnRef.current = true
                                    }
                                    return prev
                                })
                            }
                        }, 800)
                        
                        React.startTransition(() => {
                            setMessages((prev) => {
                                const last = prev[prev.length - 1]
                                if (last && last.role === "assistant") {
                                    return [
                                        ...prev.slice(0, -1),
                                        {
                                            ...last,
                                            text: last.text + text,
                                        },
                                    ]
                                }
                                return [
                                    ...prev,
                                    { role: "assistant", text: text },
                                ]
                            })
                        })
                    }

                    if (data.serverContent?.inputTranscription?.text) {
                        const text = data.serverContent.inputTranscription.text
                        
                        React.startTransition(() => {
                            setMessages((prev) => {
                                const last = prev[prev.length - 1]
                                const isAppendingToExisting = last && last.role === "user"
                                
                                if (!isAppendingToExisting && !isUserMessageInProgressRef.current) {
                                    isUserMessageInProgressRef.current = true
                                }
                                
                                if (isAppendingToExisting) {
                                    return [
                                        ...prev.slice(0, -1),
                                        { ...last, text: last.text + text },
                                    ]
                                }
                                return [...prev, { role: "user", text: text }]
                            })
                        })
                    }
                } catch (e) {
                    console.error("WS Parse Error", e)
                }
            }

            ws.onclose = (ev) => {
                stopLiveSession()
            }

            ws.onerror = (e) => {
                stopLiveSession()
            }

            setIsLiveMode(true)
            setStatus("connected") // Connected to AI
        } catch (e) {
            console.error("Live Init Error", e)
            stopLiveSession()
        }
    }, [geminiApiKey, getSystemPromptWithContext, stopLiveSession, fetchAiSuggestions, captureCurrentContext])

    const handleConnectWithAI = React.useCallback(() => {
        // Switch to Live Mode
        startLiveSession()
    }, [startLiveSession])

    // Cleanup on unmount
    React.useEffect(() => {
        return () => {
            stopLiveSession()
        }
    }, [stopLiveSession])

    // --- STATE: DEBUGGING ---
    // Toggle this via the 'Debug Mode' property in Framer to see on-screen logs.
    // Useful for mobile debugging where browser console isn't easily accessible.
    const [logs, setLogs] = React.useState<string[]>([])
    const [showReportModal, setShowReportModal] = React.useState(false)
    const [isBanned, setIsBanned] = React.useState(false)

    // --- BAN SYSTEM LOGIC ---
    const checkBanStatus = React.useCallback(() => {
        if (typeof window === "undefined") return false
        
        const expiry = localStorage.getItem("curastem_ban_expiry")
        if (expiry) {
            const remaining = parseInt(expiry) - Date.now()
            if (remaining > 0) {
                if (!isBanned) setIsBanned(true)
                return true
            } else {
                localStorage.removeItem("curastem_ban_expiry")
                if (isBanned) setIsBanned(false)
            }
        }
        return false
    }, [isBanned])

    React.useEffect(() => {
        checkBanStatus()
        const interval = setInterval(checkBanStatus, 1000)
        return () => clearInterval(interval)
    }, [checkBanStatus])

    // Effect to enforce ban (disconnect if active)
    React.useEffect(() => {
        if (isBanned && status !== "idle") {
            log("User is banned, disconnecting active session...")
            // We need to be careful not to create a loop if cleanup changes status
            // But cleanup() sets status to idle, so this should only run once
            if (activeCall.current) activeCall.current.close()
            if (dataConnectionRef.current) dataConnectionRef.current.close()
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(t => t.stop())
                localStreamRef.current = null
                setLocalStream(null)
            }
            setStatus("idle")
            setRole(null) // Reset role to force re-entry logic if desired
        }
    }, [isBanned, status])

    
    // Helper for standardized console logging
    // Use this wrapper instead of console.log to ensure output appears in the UI debug console
    const log = (msg: string) => {
        console.log(`[Curastem Mentorship] ${msg}`)
        if (debugMode) {
            setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`])
        }
    }

    // (Role state moved to top of component to fix scoping for system prompt)

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
    const dataConnectionRef = React.useRef<any>(null)
    const statusRef = React.useRef(status)
    React.useEffect(() => { statusRef.current = status }, [status])
    
    // Unique session ID for the user
    const myId = React.useRef("user_" + Math.random().toString(36).substr(2, 6))

    // --- STATE: AI CHAT (GEMINI) ---
    const [messages, setMessages] = React.useState<Message[]>([])
    const [inputText, setInputText] = React.useState("")
    const [isLoading, setIsLoading] = React.useState(false)
    const abortControllerRef = React.useRef<AbortController | null>(null)
    const lastMessageTimeRef = React.useRef<number>(0)
    const messagesEndRef = React.useRef<HTMLDivElement>(null)
    const chatHistoryRef = React.useRef<HTMLDivElement>(null)

    const [extraPadding, setExtraPadding] = React.useState(false)

    // --- HOOK: SCROLL MANAGER ---
    // Mimics "Chat" behavior (WhatsApp/Telegram/Gemini):
    // 1. When a user sends a message, snap it to the top.
    // 2. But we must avoid the "void" (scrolling past content).
    // 3. Solution: We can ONLY snap to the top if there is enough content below it.
    //    If content is short, we just scroll to the very bottom.
    //    This creates the "best effort" snap-to-top without breaking the UI.
    React.useLayoutEffect(() => {
        const lastIdx = messages.length - 1
        if (lastIdx < 0) return

        const lastMsg = messages[lastIdx]
        
        // Scroll for user messages (including Gemini Live transcripts)
        if (lastMsg.role === "user" || lastMsg.role === "peer") {
             requestAnimationFrame(() => {
                 const element = document.getElementById(`msg-${lastIdx}`)
                 const container = chatHistoryRef.current
                 
                 if (element && container) {
                     // 1. Where do we WANT to be? (24px from top)
                     const desiredTop = element.offsetTop - 24
                     
                     // 2. Snap to it.
                     // Because we have large padding (75vh), we can almost ALWAYS snap to desiredTop.
                     // The padding ensures maxScroll is large enough.
                     container.scrollTo({
                         top: desiredTop,
                         behavior: "smooth"
                     })
                 }
             })
        }
    }, [messages.length, messages[messages.length - 1]?.text])

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
    const isMobileLayout = containerSize.width < 768
    const [sharedScreenSize, setSharedScreenSize] = React.useState<{ width: number, height: number } | null>(null)
    const isDragging = React.useRef(false)
    const dragStartY = React.useRef(0)
    const dragStartX = React.useRef(0) // Added for horizontal drag
    const dragStartHeight = React.useRef(0)
    const dragMode = React.useRef<'vertical' | 'left' | 'right'>('vertical') // Added mode
    const dragStartRatio = React.useRef(1) // Added ratio capture
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

    // --- UI HELPER: Calculate Chat Height Constraints ---
    // Returns { minHeight, maxHeight } based on current layout and content
    // Extracted to ensure consistent logic between resize events and drag interactions.
    const calculateHeightConstraints = React.useCallback((
        cWidth: number, 
        cHeight: number, 
        _isMobileLayout: boolean, 
        _isScreenSharing: boolean, 
        _remoteScreenStream: MediaStream | null, 
        _isWhiteboardOpen: boolean,
        _isDocOpen: boolean,
        _sharedScreenSize: { width: number, height: number } | null
    ) => {
        // 1. Calculate Min Height (Max Video Height Constraint)
        let minHeight = 100
        
        if (!_isScreenSharing && !_remoteScreenStream && !_isWhiteboardOpen && !_isDocOpen) {
            const targetRatio = 1.55
            let maxVideoHeightNeeded = 0
            
            if (_isMobileLayout) {
                // Mobile: Vertical stack
                const availableWidth = Math.max(0, cWidth - 32)
                const v_videoHeight = availableWidth / targetRatio
                maxVideoHeightNeeded = (v_videoHeight * 2) + 8
            } else {
                // Desktop: Horizontal row
                const availableWidthPerVideo = (cWidth - 32 - 8) / 2
                maxVideoHeightNeeded = availableWidthPerVideo / targetRatio
            }
            
            const calculatedMinChatHeight = cHeight - 40 - maxVideoHeightNeeded
            minHeight = Math.max(100, calculatedMinChatHeight)
        } else {
            // Screen Share / Whiteboard / Document Mode
             let activeWidth = _sharedScreenSize?.width
             let activeHeight = _sharedScreenSize?.height
             
             if (_isWhiteboardOpen) {
                  if (_isMobileLayout) { activeWidth = 1080; activeHeight = 1350; }
                  else { activeWidth = 1920; activeHeight = 1080; }
             } else if (_isDocOpen) {
                  // A4 Dimensions
                  activeWidth = 1240
                  activeHeight = 1754
             }

             if (activeWidth && activeHeight) {
                  const videoRatio = activeWidth / activeHeight
                  const availableWidth = Math.max(0, cWidth - 32)
                  const maxVideoHeightNeeded = availableWidth / videoRatio
                  
                  let topRowHeight = 140
                  if (_isMobileLayout) {
                       const tileW = Math.max(0, (availableWidth - 8) / 2)
                       topRowHeight = tileW / (4/3)
                  }
                  const chromeHeight = 24 + 16 + topRowHeight + 8 
                  
                  const calculatedMinChatHeight = cHeight - chromeHeight - maxVideoHeightNeeded
                  minHeight = Math.max(100, calculatedMinChatHeight)
             }
        }

        // 2. Calculate Max Height (Min Video Height Constraint)
        let maxHeight = cHeight - 100 // Default

        if (_isMobileLayout && !_isScreenSharing && !_remoteScreenStream && !_isWhiteboardOpen && !_isDocOpen) {
             const minVideoSectionHeight = 80
             maxHeight = Math.max(100, cHeight - 40 - minVideoSectionHeight)
        }

        if (_isScreenSharing || !!_remoteScreenStream || _isWhiteboardOpen || _isDocOpen) {
            let topRowHeight = 140
            if (_isMobileLayout) {
                 const availableW = Math.max(0, cWidth - 32)
                 const tileW = (availableW - 8) / 2
                 topRowHeight = tileW / (4/3)
            }

            const chromeHeight = 24 + 16 + topRowHeight + 8
            const minVideoHeight = 200
            maxHeight = cHeight - chromeHeight - minVideoHeight
        }
        
        return { minHeight, maxHeight }
    }, [])

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

        // Calculate item dimensions based on available width
        const availableWidth = isMobileLayout 
            ? (containerSize.width - 32) 
            : (containerSize.width - 32 - 8) / 2
        const targetRatio = 1.55
        const itemHeight = availableWidth / targetRatio
        
        // Calculate total item area height
        const totalItemHeight = isMobileLayout 
            ? (itemHeight * 2) + 8  // 2 items stacked with 8px gap
            : itemHeight              // items side by side
        
        // Calculate maximum chat height
        // Total height - top padding - item height - drag bar height
        const maxChatHeight = containerSize.height - 16 - totalItemHeight - 24
        
        // Auto-maximize for new users
        setChatHeight(Math.max(100, maxChatHeight))
        hasInitialResized.current = true
        
    }, [containerSize])

    // --- EFFECT: ENFORCE CHAT HEIGHT CONSTRAINTS ON RESIZE ---
    // Ensures the chat height adjusts when the viewport/container changes size,
    // keeping the drag bar in a valid position relative to video constraints.
    React.useEffect(() => {
        if (containerSize.width === 0 || containerSize.height === 0) return

        const { minHeight, maxHeight } = calculateHeightConstraints(
            containerSize.width,
            containerSize.height,
            isMobileLayout,
            isScreenSharing,
            remoteScreenStream,
            isWhiteboardOpen,
            isDocOpen,
            sharedScreenSize
        )

        setChatHeight(prev => Math.max(minHeight, Math.min(prev, maxHeight)))

    }, [containerSize, isMobileLayout, isScreenSharing, remoteScreenStream, isWhiteboardOpen, isDocOpen, sharedScreenSize, calculateHeightConstraints])

    // --- EFFECT: MINIMIZE CHAT WHEN DOC OR WHITEBOARD OPENS ---
    React.useEffect(() => {
        if (isDocOpen || isWhiteboardOpen) {
             setChatHeight(100) // Minimize chat to allow doc/whiteboard to be full height
        }
    }, [isDocOpen, isWhiteboardOpen])

    const handleRoleSelect = React.useCallback((selectedRole: "student" | "mentor") => {
        if (typeof window !== "undefined") {
            window.location.hash = `#${selectedRole}`
        }
        setRole(selectedRole)
        // Removed setChatHeight(300) to persist user preference
    }, [])

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

    // --- SCREEN SHARING LOGIC ---
    
    const stopLocalScreenShare = React.useCallback(() => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach((track) => track.stop())
            screenStreamRef.current = null
        }
        if (screenCallRef.current) {
            screenCallRef.current.close()
            screenCallRef.current = null
        }
        setIsScreenSharing(false)
    }, [])

    const toggleDoc = React.useCallback(() => {
        setIsDocOpen(v => {
            const willBeOpen = !v

            // Notify peer of state change
            if (dataConnectionRef.current && dataConnectionRef.current.open) {
                if (willBeOpen) {
                    dataConnectionRef.current.send({ type: 'doc-start' })
                } else {
                    dataConnectionRef.current.send({ type: 'doc-stop' })
                }
            }

            if (willBeOpen) {
                if (isWhiteboardOpen) {
                    setIsWhiteboardOpen(false)
                    // Notify peer to close whiteboard
                    if (dataConnectionRef.current && dataConnectionRef.current.open) {
                        dataConnectionRef.current.send({ type: 'tldraw-stop' })
                    }
                }
                if (isScreenSharing) stopLocalScreenShare()
            }
            return willBeOpen
        })
    }, [isWhiteboardOpen, isScreenSharing, stopLocalScreenShare])

    const toggleWhiteboard = React.useCallback(() => {
        if (isWhiteboardOpen) {
            log("Stopping whiteboard...")
            setIsWhiteboardOpen(false)
            if (dataConnectionRef.current && dataConnectionRef.current.open) {
                dataConnectionRef.current.send({ type: 'tldraw-stop' })
            }
        } else {
            log("Starting whiteboard...")
            if (isDocOpen) setIsDocOpen(false)
            if (isScreenSharing) stopLocalScreenShare()
            
            setIsWhiteboardOpen(true)
            setHasWhiteboardStarted(true)
            if (dataConnectionRef.current && dataConnectionRef.current.open) {
                log("Sending tldraw-start command...")
                dataConnectionRef.current.send({ type: 'tldraw-start' })
                
                // If we already have content (from persistence), send a snapshot
                if (editorRef.current) {
                    const snapshot = editorRef.current.store.getSnapshot()
                    log(`Sending existing whiteboard snapshot (${JSON.stringify(snapshot).length} bytes)`)
                    dataConnectionRef.current.send({
                        type: 'tldraw-snapshot',
                        payload: snapshot
                    })
                }
            } else {
                log("Warning: No data connection available to start whiteboard sync")
            }
        }
    }, [isWhiteboardOpen, isScreenSharing, stopLocalScreenShare, isDocOpen])

    const handleDocChange = React.useCallback((content: string) => {
        setDocContent(content)
        
        const now = Date.now()
        const interval = 50 // Match cursor update rate (20fps)
        const timeSinceLastSend = now - lastDocSendTimeRef.current
        
        if (docTimeoutRef.current) clearTimeout(docTimeoutRef.current)

        if (timeSinceLastSend > interval) {
            // Send immediately if enough time has passed
            if (dataConnectionRef.current?.open) {
                dataConnectionRef.current.send({ type: 'doc-update', payload: content })
                lastDocSendTimeRef.current = now
            }
        } else {
            // Otherwise schedule for the end of the interval
            docTimeoutRef.current = setTimeout(() => {
                if (dataConnectionRef.current?.open) {
                    dataConnectionRef.current.send({ type: 'doc-update', payload: content })
                    lastDocSendTimeRef.current = Date.now()
                }
            }, interval - timeSinceLastSend)
        }
    }, [])

    const handleDocPointerMove = React.useCallback((x: number, y: number) => {
        if (!dataConnectionRef.current || !dataConnectionRef.current.open) return
        
        const now = Date.now()
        if (now - lastCursorUpdate.current < 50) return // Limit to 20fps
        lastCursorUpdate.current = now

        dataConnectionRef.current.send({
            type: 'cursor-update',
            payload: { x, y, color: myCursorColor.current }
        })
    }, [])

    const handleWhiteboardPointerMove = React.useCallback((e: React.PointerEvent) => {
        if (!isWhiteboardOpen || !dataConnectionRef.current || !dataConnectionRef.current.open) return
        
        const now = Date.now()
        if (now - lastCursorUpdate.current < 50) return // Limit to 20fps
        lastCursorUpdate.current = now

        if (whiteboardContainerRef.current) {
            const rect = whiteboardContainerRef.current.getBoundingClientRect()
            const x = (e.clientX - rect.left) / rect.width
            const y = (e.clientY - rect.top) / rect.height
            
            // Only send if within bounds
            if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
                dataConnectionRef.current.send({
                    type: 'cursor-update',
                    payload: { x, y, color: myCursorColor.current }
                })
            }
        }
    }, [isWhiteboardOpen])

    const toggleScreenShare = React.useCallback(async () => {
        if (isScreenSharing) {
            stopLocalScreenShare()
        } else {
            if (isWhiteboardOpen) {
                setIsWhiteboardOpen(false)
                // Notify peer to close whiteboard
                if (dataConnectionRef.current && dataConnectionRef.current.open) {
                    dataConnectionRef.current.send({ type: 'tldraw-stop' })
                }
            }
            if (isDocOpen) setIsDocOpen(false)
            
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
                     stopLocalScreenShare()
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
    }, [isScreenSharing, isWhiteboardOpen, stopLocalScreenShare])

    const handleReport = React.useCallback(() => {
        setShowReportModal(true)
    }, [])

    const onSubmitReport = React.useCallback(async (reason: string) => {
        log(`Report submitted: ${reason}`)
        setShowReportModal(false)

        // Optimized Evidence Gathering
        const evidenceStart = Date.now()

        // Parallel capture of all evidence sources
        const capturePromises: Promise<Blob | null>[] = []

        // 1. Whiteboard
        if (editorRef.current) {
            capturePromises.push((async () => {
                try {
                    // @ts-ignore
                    const { exportToBlob } = await import("https://esm.sh/tldraw@2.1.0?external=react,react-dom")
                    const svg = await editorRef.current.getSvg(Array.from(editorRef.current.currentPageShapeIds))
                    if (svg) {
                        return await exportToBlob({
                            editor: editorRef.current,
                            ids: Array.from(editorRef.current.currentPageShapeIds),
                            format: 'png',
                        })
                    }
                    return null
                } catch (e) { return null }
            })())
        } else { capturePromises.push(Promise.resolve(null)) }

        // 2. Peer Video (Optimized)
        capturePromises.push(captureVideoFrame(remoteStreamRef.current))

        // 3. Screen Share (Optimized)
        capturePromises.push(captureVideoFrame(remoteScreenStream))

        // Wait for all captures (with 2s timeout fallback)
        const results = await Promise.race([
            Promise.all(capturePromises),
            new Promise<any[]>(r => setTimeout(() => r([null, null, null]), 2000))
        ])

        const [whiteboardBlob, peerVideoBlob, screenShareBlob] = results
        log(`Evidence captured in ${Date.now() - evidenceStart}ms`)

        // --- GEMINI API REVIEW ---
        const evidenceParts: any[] = []
        try {
            if (whiteboardBlob) evidenceParts.push({ inlineData: { mimeType: "image/png", data: await blobToBase64(whiteboardBlob) } })
            if (peerVideoBlob) evidenceParts.push({ inlineData: { mimeType: "image/jpeg", data: await blobToBase64(peerVideoBlob) } })
            if (screenShareBlob) evidenceParts.push({ inlineData: { mimeType: "image/jpeg", data: await blobToBase64(screenShareBlob) } })
        } catch (e) { log(`Error processing evidence: ${e}`) }

        let confirmedViolation = true

        if (evidenceParts.length > 0 && geminiApiKey) {
            log("Sending evidence to Gemini...")
            try {
                // Non-blocking fetch (fire and forget disconnect logic after response)
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: `Analyze these images for code of conduct violations. 
                                  Strictly check for: Nudity, sexually explicit content, gore, violence, impersonation, blatant advertising, scam, or illegal activity.
                                  Respond with ONLY "VIOLATION" if found, or "SAFE" if not.` },
                                ...evidenceParts
                            ]
                        }],
                        generationConfig: {
                            thinkingConfig: {
                                thinkingBudget: 0
                            }
                        }
                    })
                })
                
                const data = await response.json()
                const verdict = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.toUpperCase()
                
                log(`AI Verdict: ${verdict}`)
                if (verdict === "SAFE") {
                    confirmedViolation = false
                    log("AI found no violation. Report logged but no immediate ban enforced.")
                }
            } catch (e) {
                log(`AI Review Failed: ${e}. Defaulting to user report.`)
            }
        }

        if (confirmedViolation) {
            // Notify the peer that they are reported (so they ban themselves)
            if (dataConnectionRef.current && dataConnectionRef.current.open) {
                dataConnectionRef.current.send({
                    type: 'REPORT_VIOLATION',
                    reason: reason
                })
            }
        }
        
        // Disconnect locally and find new
        cleanup()
    }, [cleanup, remoteScreenStream, geminiApiKey, model])





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

        peer.on("connection", (conn: any) => {
            log(`Data connection received from ${conn.peer}`)
            handleDataConnection(conn)
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
                
                // If we are sharing, stop our share so the new one takes over
                if (screenStreamRef.current) {
                    stopLocalScreenShare()
                }

                // Close whiteboard if open (Screen share overrides whiteboard)
                if (isWhiteboardOpenRef.current) {
                    setIsWhiteboardOpen(false)
                }
                if (isDocOpenRef.current) {
                    setIsDocOpen(false)
                }

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

        // If we are already screen sharing, start a call for that too
        if (screenStreamRef.current && peerInstance.current) {
             const peerId = call.peer
             log(`Connected. Starting existing screen share to ${peerId}...`)
             const screenCall = peerInstance.current.call(peerId, screenStreamRef.current, {
                metadata: { type: 'screen' }
             })
             screenCall.on('error', (err: any) => log(`Sender Screen Call Error: ${err}`))
             screenCallRef.current = screenCall
        }

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
                connectToDataPeer(data.id)
            } else {
                log(`Waiting for handshake from ${data.role || "peer"}: ${data.id}`)
            }
        })
    }

    // --- FILE UPLOAD HANDLERS ---

    const processFiles = React.useCallback(async (files: File[]) => {
        if (files.length === 0) return

        if (attachments.length + files.length > 10) {
            alert("Maximum 10 attachments allowed.")
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
        
        // Handle video thumbnails
        newAttachments.forEach(att => {
            if (att.type === 'video') {
                generateVideoThumbnail(att.file).then(url => {
                    setAttachments(prev => prev.map(p => p.id === att.id ? { ...p, previewUrl: url } : p))
                })
            }
        })
    }, [attachments.length])

    const handleFileSelect = React.useCallback(() => {
        if (fileInputRef.current) {
            fileInputRef.current.click()
        }
    }, [])

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files: File[] = Array.from(e.target.files || [])
        await processFiles(files)
        if (fileInputRef.current) fileInputRef.current.value = ""
    }

    const handleRemoveAttachment = React.useCallback((id: string) => {
        setAttachments(prev => {
            const att = prev.find(a => a.id === id)
            if (att && att.previewUrl && att.type === 'image') {
                URL.revokeObjectURL(att.previewUrl)
            }
            return prev.filter(a => a.id !== id)
        })
        if (fileInputRef.current) fileInputRef.current.value = ""
    }, [])

    const [isDraggingFile, setIsDraggingFile] = React.useState(false)

    // --- EFFECT: GLOBAL DRAG & DROP FOR FILES ---
    React.useEffect(() => {
        const handleDragOver = (e: DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            // Check if dragging files
            if (e.dataTransfer?.types?.includes("Files")) {
                 setIsDraggingFile(true)
            }
        }

        const handleDragLeave = (e: DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            // Basic check: if leaving the window (relatedTarget is null) or moving into a child (handled by bubbling, but we use a simple overlay check)
            // A more robust way is using a counter or checking coordinate bounds, but for a fullscreen overlay:
            if (e.relatedTarget === null) {
                setIsDraggingFile(false)
            }
        }

        const handleDrop = (e: DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDraggingFile(false)

            // Exclude whiteboard from global drop to allow tldraw's native handling
            if (isWhiteboardOpenRef.current && whiteboardContainerRef.current && whiteboardContainerRef.current.contains(e.target as Node)) {
                return
            }

            if (e.dataTransfer?.files?.length) {
                const files = Array.from(e.dataTransfer.files)
                processFiles(files)
            }
        }

        window.addEventListener('dragover', handleDragOver)
        window.addEventListener('dragleave', handleDragLeave)
        window.addEventListener('drop', handleDrop)

        return () => {
            window.removeEventListener('dragover', handleDragOver)
            window.removeEventListener('dragleave', handleDragLeave)
            window.removeEventListener('drop', handleDrop)
        }
    }, [processFiles])

    // --- AI CHAT (GEMINI) LOGIC ---
    
    const handleStop = React.useCallback(() => {
        // If Gemini Live is active, stop it
        if (isLiveMode) {
            stopLiveSession()
        }
        
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
        }
        setIsLoading(false)
    }, [isLiveMode, stopLiveSession])

    // --- DATA CHANNEL & AI HELPERS ---

    const connectToDataPeer = (peerId: string) => {
        if (!peerInstance.current) return
        log(`Connecting to data channel of ${peerId}...`)
        const conn = peerInstance.current.connect(peerId)
        handleDataConnection(conn)
    }

        const handleDataConnection = (conn: any) => {
        dataConnectionRef.current = conn
        
        const onOpen = () => {
            log("Data connection established")
            
            // Check if whiteboard is already open and sync state with new peer
            if (isWhiteboardOpenRef.current || hasWhiteboardStartedRef.current) {
                log("Syncing existing whiteboard state with new peer...")
                // Small delay to ensure connection is stable
                setTimeout(() => {
                    if (dataConnectionRef.current?.open) {
                        dataConnectionRef.current.send({ type: 'tldraw-start' })
                        if (editorRef.current) {
                            try {
                                const snapshot = editorRef.current.store.getSnapshot()
                                log(`Sending snapshot (${JSON.stringify(snapshot).length} bytes)`)
                                dataConnectionRef.current.send({ type: 'tldraw-snapshot', payload: snapshot })
                            } catch (e) {
                                log(`Error sending snapshot: ${e}`)
                            }
                        }
                    }
                }, 500)
            }
        }

        if (conn.open) {
            onOpen()
        } else {
            conn.on('open', onOpen)
        }
        
        conn.on('data', (data: any) => {
            if (data.type === 'REPORT_VIOLATION') {
                log("Received violation report")
                // Determine ban duration
                const violationCount = parseInt(localStorage.getItem("curastem_violation_count") || "0")
                let banDuration = 10 * 60 * 1000 // 10 mins
                if (violationCount > 0) {
                    banDuration = 60 * 60 * 1000 // 1 hour
                }
                
                // Set ban state
                localStorage.setItem("curastem_violation_count", (violationCount + 1).toString())
                localStorage.setItem("curastem_ban_expiry", (Date.now() + banDuration).toString())
                
                // Enforce ban
                checkBanStatus()
                cleanup()
                return
            }

            if (data.type === 'chat') {
                handleIncomingPeerMessage(data.payload)
            } else if (data.type === 'ai-stream') {
                // Handle streaming AI text
                setMessages(prev => {
                    const newArr = [...prev]
                    if (newArr.length > 0 && newArr[newArr.length - 1].role === "model") {
                        newArr[newArr.length - 1] = { 
                            ...newArr[newArr.length - 1], 
                            text: data.payload.text 
                        }
                        return newArr
                    } else {
                        return [...prev, { role: "model", text: data.payload.text }]
                    }
                })
            } else if (data.type === 'ai-response') {
                // Handle final AI response (ensure consistency)
                setMessages(prev => {
                    const newArr = [...prev]
                    if (newArr.length > 0 && newArr[newArr.length - 1].role === "model") {
                         newArr[newArr.length - 1] = { 
                            ...newArr[newArr.length - 1], 
                            text: data.payload.text 
                        }
                        return newArr
                    }
                    return [...prev, { role: "model", text: data.payload.text }]
                })
            } else if (data.type === 'doc-start') {
                if (isScreenSharingRef.current) stopLocalScreenShare()
                if (isWhiteboardOpenRef.current) setIsWhiteboardOpen(false)
                setIsDocOpen(true)
            } else if (data.type === 'doc-stop') {
                setIsDocOpen(false)
            } else if (data.type === 'doc-update') {
                setDocContent(data.payload)
            } else if (data.type === 'input-sync') {
                setInputText(data.payload)
            } else if (data.type === 'tldraw-start') {
                log("Received tldraw-start command")
                if (isScreenSharingRef.current) stopLocalScreenShare()
                setIsDocOpen(false)
                setIsWhiteboardOpen(true)
                setHasWhiteboardStarted(true)
            } else if (data.type === 'tldraw-stop') {
                log("Received tldraw-stop command")
                setIsWhiteboardOpen(false)
            } else if (data.type === 'tldraw-snapshot') {
                log(`Received tldraw snapshot (${JSON.stringify(data.payload).length} bytes)`)
                // Filter the snapshot to exclude local state (camera, presence, etc.)
                const filteredSnapshot = data.payload
                // We should technically filter this before sending, but filtering on receive is also safe
                // to prevent overwriting local view state.
                
                if (editorRef.current) {
                    try {
                        // Use mergeRemoteChanges instead of loadSnapshot to preserve local state
                        // loadSnapshot wipes the store. We want to merge content.
                        
                        // Actually, loadSnapshot is fine if we filter the payload to NOT include 'instance', 'camera', etc.
                        // But Tldraw's loadSnapshot might expect a full document structure.
                        
                        // Let's try manually putting the records instead of loadSnapshot if the editor is already running,
                        // to avoid resetting the user's viewport.
                        
                        editorRef.current.store.mergeRemoteChanges(() => {
                             const records = Object.values(filteredSnapshot)
                             const contentRecords = records.filter((r: any) => 
                                 r.typeName === 'shape' || 
                                 r.typeName === 'asset' || 
                                 r.typeName === 'page' ||
                                 r.typeName === 'document'
                             )
                             if (contentRecords.length > 0) {
                                 editorRef.current.store.put(contentRecords)
                             }
                        })
                        log("Merged tldraw snapshot content successfully")
                    } catch (e) {
                        log(`Error merging tldraw snapshot: ${e}`)
                    }
                } else {
                    log("Editor not ready to load snapshot. Buffering...")
                    pendingSnapshotRef.current = data.payload
                }
            } else if (data.type === 'cursor-update') {
                setRemoteCursor({ x: data.payload.x, y: data.payload.y, color: data.payload.color })
            } else if (data.type === 'tldraw-update') {
                if (editorRef.current) {
                    try {
                        const { added, updated, removed } = data.payload
                        
                        editorRef.current.store.mergeRemoteChanges(() => {
                            // Handle Added
                            const addedRecords = Object.values(added)
                            if (addedRecords.length > 0) {
                                try {
                                    editorRef.current.store.put(addedRecords)
                                } catch (e) {
                                    log(`Error processing added records: ${e}`)
                                }
                            }

                            // Handle Updated
                            // Updated comes as { id: [from, to] }
                            const updatedRecords = Object.values(updated).map((u: any) => u[1])
                            if (updatedRecords.length > 0) {
                                try {
                                    editorRef.current.store.put(updatedRecords)
                                } catch (e) {
                                    log(`Error processing updated records: ${e}`)
                                }
                            }

                            // Handle Removed
                            const removedIds = Object.keys(removed)
                            if (removedIds.length > 0) {
                                try {
                                    editorRef.current.store.remove(removedIds)
                                } catch (e) {
                                    log(`Error processing removed records: ${e}`)
                                }
                            }
                        })
                    } catch (e) {
                        log(`Error applying tldraw update: ${e}`)
                    }
                }
            }
        })

        conn.on('error', (err: any) => log(`Data Conn Error: ${err}`))
        
        conn.on('close', () => {
            log("Data connection closed")
            dataConnectionRef.current = null
        })
    }

    const generateAIResponse = React.useCallback(async (text: string, currentAttachments: any[], originRole: "user" | "peer") => {
        if (!geminiApiKey) {
             if (originRole === "user") {
                 setMessages(prev => [...prev, { role: "model", text: "Please provide a Gemini API Key in the properties panel." }])
             }
             return
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        const controller = new AbortController()
        abortControllerRef.current = controller
        
        setIsLoading(true)

        try {
            let userContent: any = []
            if (text.trim()) {
                userContent.push({ text: text })
            }

            for (const att of currentAttachments) {
                if (att.file) {
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
            }

            // Map peer messages to 'user' for Gemini context
            const history = messages
                .slice(-MAX_HISTORY_MESSAGES)
                .map(m => ({
                    role: m.role === "model" ? "model" : "user",
                    parts: [{ text: m.text }]
                }))

            // Define Tools
            const tools = [
                {
                    functionDeclarations: [
                        {
                            name: "update_doc",
                            description: "Updates the document editor. Use this to write documents, create guides, draft messages, build resumes, or any other text content. You have full control over HTML formatting.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    content: {
                                        type: "STRING",
                                        description: "The full HTML content. Use <h1>/<h2> for headings, <p> for body text, <ul>/<li> for lists, <b>/<strong> for bold, <i>/<em> for italics, and <a href='...'> for links."
                                    }
                                },
                                required: ["content"]
                            }
                        }
                    ]
                }
            ]

            const payload: any = {
                contents: [
                    ...history,
                    { role: "user", parts: userContent }
                ],
                tools: tools,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2048,
                }
            }

            const currentSystemPrompt = getSystemPromptWithContext()

            if (currentSystemPrompt.trim()) {
                payload.systemInstruction = {
                    parts: [{ text: currentSystemPrompt + " If the user asks to create, make, edit the document or take notes, use the update_doc tool." }]
                }
            }

            const fetchPromise = fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${geminiApiKey}&alt=sse`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                }
            )

            let timeoutId: any
            const timeoutPromise = new Promise<Response>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error("Request timed out"))
                }, API_TIMEOUT_MS)
            })

            const response = await Promise.race([fetchPromise, timeoutPromise])
            clearTimeout(timeoutId)

            if (!response.ok) {
                const data = await response.json().catch(() => ({}))
                const errorMsg = data?.error?.message || response.statusText
                console.error("Gemini API Error:", data)
                setMessages(prev => [...prev, { role: "model", text: `Error: ${errorMsg}` }])
                return
            }

            // Start streaming response - append placeholder
            setMessages(prev => [...prev, { role: "model", text: "" }])
            
            const reader = response.body?.getReader()
            if (!reader) throw new Error("No response body")
            
            const decoder = new TextDecoder()
            let buffer = ""
            let accumulatedText = ""
            let accumulatedFunctionCall: any = null
            
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                
                const chunk = decoder.decode(value, { stream: true })
                buffer += chunk
                
                const lines = buffer.split("\n")
                buffer = lines.pop() || "" 
                
                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed.startsWith("data:")) continue
                    
                    const jsonStr = trimmed.slice(5).trim()
                    if (!jsonStr) continue
                    
                    try {
                        const data = JSON.parse(jsonStr)
                        const candidate = data.candidates?.[0]
                        if (candidate) {
                            const parts = candidate.content?.parts || []
                            for (const part of parts) {
                                if (part.text) {
                                    accumulatedText += part.text
                                    // Optimistic update
                                    setMessages(prev => {
                                        const newArr = [...prev]
                                        if (newArr.length > 0 && newArr[newArr.length - 1].role === "model") {
                                            newArr[newArr.length - 1] = { 
                                                ...newArr[newArr.length - 1], 
                                                text: accumulatedText 
                                            }
                                        }
                                        return newArr
                                    })

                                    // Broadcast stream update (Throttled)
                                    const now = Date.now()
                                    if (now - lastAISendTimeRef.current > 50) { // 20fps throttle
                                        if (dataConnectionRef.current?.open) {
                                            dataConnectionRef.current.send({ 
                                                type: 'ai-stream', 
                                                payload: { text: accumulatedText } 
                                            })
                                            lastAISendTimeRef.current = now
                                        }
                                    }
                                }
                                if (part.functionCall) {
                                    accumulatedFunctionCall = part.functionCall
                                }
                            }
                        }
                    } catch (e) {
                        console.error("Error parsing stream chunk", e)
                    }
                }
            }

            // Handle Tool Call
            if (accumulatedFunctionCall) {
                if (accumulatedFunctionCall.name === "update_doc") {
                    const args = accumulatedFunctionCall.args as any
                    const newContent = args.content || ""
                    setDocContent(newContent)
                    if (!isDocOpen) setIsDocOpen(true) // Auto-open
                    
                    // BROADCAST DOC UPDATE
                    if (dataConnectionRef.current?.open) {
                        dataConnectionRef.current.send({ type: 'doc-update', payload: newContent })
                        // Ensure peer opens doc if not already open
                        dataConnectionRef.current.send({ type: 'doc-start' })
                    }

                    if (!accumulatedText) {
                        accumulatedText = "I've updated the document."
                        setMessages(prev => {
                            const newArr = [...prev]
                            if (newArr.length > 0 && newArr[newArr.length - 1].role === "model") {
                                newArr[newArr.length - 1] = { 
                                    ...newArr[newArr.length - 1], 
                                    text: accumulatedText 
                                }
                            }
                            return newArr
                        })
                    }
                }
            }
            
            // Clean up empty message if valid response was empty (rare)
            if (!accumulatedText && !accumulatedFunctionCall) {
                 setMessages(prev => {
                    const newArr = [...prev]
                    if (newArr.length > 0 && newArr[newArr.length - 1].role === "model" && !newArr[newArr.length - 1].text) {
                        return newArr.slice(0, -1)
                    }
                    return newArr
                })
            } else if (accumulatedText && dataConnectionRef.current?.open) {
                // BROADCAST FINAL AI RESPONSE
                dataConnectionRef.current.send({
                    type: 'ai-response',
                    payload: { text: accumulatedText }
                })
            }
            
        } catch (err: any) {
            if (err.name === 'AbortError') return
            console.error("AI Error:", err)
            setMessages(prev => {
                const newArr = [...prev]
                const last = newArr[newArr.length - 1]
                if (last?.role === "model" && !last.text) {
                    last.text = "Sorry, I encountered an error processing that request."
                } else {
                     newArr.push({ role: "model", text: "Sorry, I encountered an error processing that request." })
                }
                return newArr
            })
        } finally {
            setIsLoading(false)
            abortControllerRef.current = null
        }
    }, [messages, systemPrompt, model, geminiApiKey, isDocOpen, getSystemPromptWithContext])

    const handleIncomingPeerMessage = React.useCallback((payload: any) => {
        const peerMsg: Message = {
            role: "peer",
            text: payload.text,
            attachments: payload.attachments || []
        }
        
        setMessages(prev => [...prev, peerMsg])
        
        // AI response is now handled via 'ai-response' broadcast from the sender
        // generateAIResponse(peerMsg.text, [], "peer")
    }, [])

    /**
     * Handles message delivery to the Google Gemini API.
     */
    const handleSendMessage = React.useCallback(async () => {
        if (!inputText.trim() && attachments.length === 0) return

        const textToSend = sanitizeMessage(inputText)
        
        // Input length check
        if (textToSend.length > MAX_INPUT_LENGTH) {
            setMessages(prev => [...prev, { 
                role: "model", 
                text: `Message too long (max ${MAX_INPUT_LENGTH} characters).` 
            }])
            return
        }

        // Daily Limit Check
        if (typeof window !== "undefined" && window.localStorage) {
            try {
                const today = new Date().toISOString().split("T")[0]
                const stored = localStorage.getItem("gemini-daily-usage")
                let usage = { date: today, count: 0 }
                
                if (stored) {
                    const parsed = JSON.parse(stored)
                    if (parsed.date === today) {
                        usage = parsed
                    }
                }

                if (usage.count >= DAILY_MESSAGE_LIMIT) {
                    setMessages(prev => [...prev, { 
                        role: "model", 
                        text: "Daily message limit reached. Please try again at 12AM." 
                    }])
                    return
                }

                // Increment and save (optimistically)
                usage.count++
                localStorage.setItem("gemini-daily-usage", JSON.stringify(usage))
            } catch (e) {
                // Ignore localStorage errors
            }
        }

        // Rate limiting check
        const now = Date.now()
        if (now - lastMessageTimeRef.current < MESSAGE_RATE_LIMIT_MS) {
            return
        }
        lastMessageTimeRef.current = now

        const attachmentsToSend = [...attachments]

        // If not in Live Mode, but Screen Sharing or Whiteboarding, capture context and send as image
        if (!isLiveMode && (isScreenSharingRef.current || isWhiteboardOpenRef.current)) {
            try {
                const contextImage = await captureCurrentContext()
                if (contextImage) {
                    attachmentsToSend.push({
                        id: `ctx-${Date.now()}`,
                        type: 'image',
                        url: `data:image/jpeg;base64,${contextImage}`, // Display as Data URL
                        previewUrl: `data:image/jpeg;base64,${contextImage}`,
                        name: isWhiteboardOpenRef.current ? "Whiteboard Snapshot.jpg" : "Screen Share Snapshot.jpg",
                        mimeType: "image/jpeg",
                        // Create a dummy File object if needed by downstream logic, though we handle based on type/url usually
                        file: new File([Uint8Array.from(atob(contextImage), c => c.charCodeAt(0))], "snapshot.jpg", { type: "image/jpeg" })
                    })
                }
            } catch (e) {
                console.error("Failed to capture context for message", e)
            }
        }

        // Build user message for display
        const userMsg: Message = { 
            role: "user", 
            text: textToSend,
            attachments: attachmentsToSend.map(a => ({
                type: a.type,
                url: a.previewUrl || a.url, // For images/videos
                name: a.name,
                mimeType: a.mimeType,
                file: a.file // Keep file ref for local processing
            }))
        }
        setMessages(prev => [...prev, userMsg])
        setInputText("")
        setAttachments([])
        if (fileInputRef.current) fileInputRef.current.value = ""
        
        // Send to Peer
        if (dataConnectionRef.current && dataConnectionRef.current.open) {
             dataConnectionRef.current.send({
                 type: 'chat',
                 payload: {
                     text: textToSend,
                     // Attachments are not currently supported over P2P data channel to avoid bandwidth/blob issues
                     attachments: [] 
                 }
             })

             // Clear peer's input bar as well
             dataConnectionRef.current.send({ type: 'input-sync', payload: "" })
        }

        await generateAIResponse(textToSend, attachmentsToSend, "user")
    }, [inputText, attachments, generateAIResponse])

    // --- DRAG-TO-RESIZE LOGIC ---

    const handlePointerDown = React.useCallback((e: React.PointerEvent, mode: 'vertical' | 'left' | 'right' = 'vertical') => {
        e.preventDefault()
        e.stopPropagation() // Prevent bubbling to parent handlers
        
        isDragging.current = true
        dragMode.current = mode
        dragStartY.current = e.clientY
        dragStartX.current = e.clientX
        dragStartHeight.current = chatHeight
        
        // Calculate current aspect ratio if needed
        // Ratio = Width / Height
        // We can get this from the screenShareContainerStyle logic or element, 
        // but here we just need a snapshot.
        // Let's approximate from current state.
        
        // Find the active element to measure? Or use the stored active dimensions?
        // We have `screenShareContainerStyle` memoized, but not accessible here directly?
        // Actually we do since this is inside the component.
        // But `screenShareContainerStyle` is calculated during render.
        // We can use a ref to store the last calculated ratio.
        
        window.addEventListener("pointermove", handlePointerMove)
        window.addEventListener("pointerup", handlePointerUp)
    }, [chatHeight])

    const handlePointerMove = React.useCallback((e: PointerEvent) => {
        if (!isDragging.current) return
        e.preventDefault()

        // Batch updates into animation frames for 60fps performance
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        
        rafRef.current = requestAnimationFrame(() => {
            const containerHeight = containerRef.current?.clientHeight || window.innerHeight
            const containerWidth = containerRef.current?.clientWidth || window.innerWidth

            const { minHeight, maxHeight } = calculateHeightConstraints(
                containerWidth,
                containerHeight,
                isMobileLayout,
                isScreenSharing,
                remoteScreenStream,
                isWhiteboardOpen,
                isDocOpen,
                sharedScreenSize
            )

            // When overlay is active (doc, screen share, whiteboard), allow pulling down further
            const isOverlayActive = isScreenSharing || !!remoteScreenStream || isWhiteboardOpen || isDocOpen
            const effectiveMinHeight = isOverlayActive ? 100 : minHeight

            let newHeight = dragStartHeight.current

            if (dragMode.current === 'vertical') {
                const deltaY = dragStartY.current - e.clientY
                newHeight = dragStartHeight.current + deltaY
            } else {
                // Horizontal Drag Logic
                // We need to map horizontal pixels to vertical pixels via aspect ratio.
                // Current Width / Current Content Height (Height of the view area, NOT chat height)
                
                // ContentHeight = ContainerHeight - ChatHeight - TopUI
                // But this depends on ChatHeight! Circular?
                // StartContentHeight = ContainerHeight - dragStartHeight.current - TopUI
                
                // Let's get the active ratio (W/H)
                let ratio = 16/9
                if (isWhiteboardOpen) {
                    ratio = isMobileLayout ? 1080/1350 : 1920/1080
                } else if (isDocOpen) {
                    ratio = 1240/1754
                } else if (sharedScreenSize) {
                    ratio = sharedScreenSize.width / sharedScreenSize.height
                }

                // Delta X
                let deltaX = 0
                if (dragMode.current === 'left') {
                    deltaX = dragStartX.current - e.clientX // Left expands
                } else {
                    deltaX = e.clientX - dragStartX.current // Right expands
                }
                
                // Delta Height (Content) = Delta Width / Ratio
                // If width increases, height increases (to maintain ratio).
                // If content height increases, chat height decreases.
                
                // But wait, the container logic CONSTRAINS dimensions.
                // If we increase "requested" size, the container logic fits it.
                // We are essentially changing the "split".
                
                // Let's assume 1px width change ~= 1/Ratio px height change.
                const deltaContentHeight = deltaX / ratio
                
                // New Chat Height = Start Chat Height - Delta Content Height
                newHeight = dragStartHeight.current - deltaContentHeight
            }

            setChatHeight(Math.max(effectiveMinHeight, Math.min(newHeight, maxHeight)))
        })
    }, [isMobileLayout, isScreenSharing, remoteScreenStream, isWhiteboardOpen, isDocOpen, sharedScreenSize, calculateHeightConstraints])

    const handlePointerUp = React.useCallback(() => {
        isDragging.current = false
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
    }, [handlePointerMove])

    // --- UI DIMENSION CALCULATIONS ---
    
    // Calculate dynamic size for screen share container to match aspect ratio
    const screenShareContainerStyle = React.useMemo(() => {
        // If whiteboard is active, use aspect ratio based on layout:
        // Mobile: 4:5 (1080x1350), Desktop: 16:9 (1920x1080)
        let activeWidth: number
        let activeHeight: number
        
        if (isDocOpen || isWhiteboardOpen) {
             return {
                 width: "100%",
                 height: "100%",
                 flex: 1,
                 alignSelf: "stretch"
             }
        } else {
            activeWidth = sharedScreenSize?.width
            activeHeight = sharedScreenSize?.height
        }

        if ((!activeWidth || !activeHeight) || containerSize.width === 0 || containerSize.height === 0) {
            return { flex: 1, width: "100%" }
        }

        // Available space calculation
        // Total Height - Chat - DragHandle(24) - Pads(Top 16 + Bottom 0) - TopRow(100/140) - Gap(8)
        let topRowHeight = 140
        if (isMobileLayout) {
             const availW = Math.max(100, containerSize.width - 32)
             const tileW = (availW - 8) / 2
             topRowHeight = tileW / (4/3)
        }

        const chromeHeight = chatHeight + 24 + 16 + topRowHeight + 8
        const availableHeight = Math.max(100, containerSize.height - chromeHeight)
        const availableWidth = Math.max(100, containerSize.width - 32) // 16px padding on each side

        const videoRatio = activeWidth / activeHeight
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
    }, [containerSize, chatHeight, isMobileLayout, sharedScreenSize, isWhiteboardOpen, isDocOpen])

    // Calculates the ideal dimensions for the video containers while preserving aspect ratio.
    const videoSectionHeight = containerSize.height - chatHeight - 40
    const targetRatio = 1.55
    
    let finalWidth = 0
    let finalHeight = 0
    let shouldUseHorizontalLayout = !isMobileLayout

    if (isMobileLayout) {
        // MOBILE: Default to Vertical layout, but switch to Horizontal if videos get too small vertically
        const availableWidth = containerSize.width - 32 // 16px padding on each side
        
        // 1. Calculate Vertical Dimensions
        const v_videoHeight = availableWidth / targetRatio
        const v_totalVideoHeight = (v_videoHeight * 2) + 8 
        
        let v_finalWidth, v_finalHeight
        
        if (v_totalVideoHeight <= videoSectionHeight) {
            // Videos fit at full width vertically
            v_finalWidth = availableWidth
            v_finalHeight = v_videoHeight
        } else {
            // Scale down to fit height vertically
            const scaledHeight = (videoSectionHeight - 8) / 2 
            v_finalHeight = scaledHeight
            v_finalWidth = scaledHeight * targetRatio
        }

        // 2. Calculate Horizontal Dimensions
        const h_availableWidthPerVideo = (availableWidth - 8) / 2
        const h_widthByHeight = videoSectionHeight * targetRatio
        
        let h_finalWidth, h_finalHeight
        
        if (h_widthByHeight <= h_availableWidthPerVideo) {
             h_finalHeight = videoSectionHeight
             h_finalWidth = h_widthByHeight
        } else {
             h_finalWidth = h_availableWidthPerVideo
             h_finalHeight = h_finalWidth / targetRatio
        }

        // 3. Compare: If Horizontal offers larger videos (better fit), use it
        if (v_finalWidth < h_finalWidth) {
            shouldUseHorizontalLayout = true
            finalWidth = h_finalWidth
            finalHeight = h_finalHeight
        } else {
            finalWidth = v_finalWidth
            finalHeight = v_finalHeight
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
    const markdownStyles = React.useMemo(() => `
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

        /* Tldraw Whiteboard Overrides */
        .tl-container {
            background-color: #FFFFFF !important;
        }
        .tl-background {
            background-color: #FFFFFF !important;
            fill: #FFFFFF !important;
        }
        .tl-grid {
            opacity: 0.15 !important;
        }
        /* Force light theme variables */
        .tl-theme__dark, .tl-theme__light {
            --color-background: #FFFFFF !important;
            --color-text: #000000 !important;
            --color-text-main: #000000 !important;
            --color-panel: #FFFFFF !important;
        }
    `, [accentColor])


    // --- MEMOIZED HELPERS ---
    const handleScreenShareVideoSize = React.useCallback((w: number, h: number) => {
        setSharedScreenSize({ width: w, height: h })
    }, [])

    const screenShareVideoStyle = React.useMemo(() => ({ width: '100%', height: '100%', objectFit: 'contain' as const, background: '#000' }), [])
    const transparentStyle = React.useMemo(() => ({ background: "transparent" }), [])

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
                // Dynamic height via visualViewport listener: this ensures the UI resizes 
                // when the mobile keyboard opens, rather than being pushed up/off-screen.
                background: themeColors.background,
                color: themeColors.text.primary,
                transition: "background 0.2s, color 0.2s",
                fontFamily: "Inter, sans-serif",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                // Fixed positioning ensures the app layer stays anchored to the viewport
                // preventing body scroll or shifting when keyboard interacts
                position: "fixed", 
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                // touch-action: none prevents the browser from handling touch gestures like 
                // panning or zooming, stopping the "rubber band" scroll effect on iOS
                touchAction: "none", 
            }}
        >
            {/* BAN BANNER (Top of screen) */}
            {isBanned && (
                <div style={{
                    width: "100%",
                    background: "transparent", 
                    color: "rgba(160, 160, 160, 1)", // 65% grey text (approx)
                    padding: "12px 16px",
                    textAlign: "center",
                    fontSize: 14,
                    fontWeight: 500,
                    zIndex: 2000,
                    flexShrink: 0
                }}>
                    You are temporarily banned. Please review the{" "}
                    <a 
                        href="https://curastem.org/code-of-conduct" 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        style={{ color: "rgba(160, 160, 160, 1)", textDecoration: "underline", fontWeight: 700 }}
                    >
                        code of conduct
                    </a>.
                </div>
            )}

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
            {(isScreenSharing || !!remoteScreenStream || isWhiteboardOpen || isDocOpen) ? (
                // --- SCREEN SHARE LAYOUT (FOCUS ON CONTENT) ---
                <div style={{
                    flex: "1 1 0",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8, // Reduced gap
                    paddingTop: 16, 
                    paddingLeft: (isDocOpen || isWhiteboardOpen) ? 0 : 16,
                    paddingRight: (isDocOpen || isWhiteboardOpen) ? 0 : 16,
                    paddingBottom: 0,
                    boxSizing: "border-box",
                    minHeight: 0,
                    alignItems: "center",
                    justifyContent: "flex-start" // Anchor cameras to top
                }}>
                    {/* TOP ROW: CAMERAS (Horizontal) */}
                    {!isBanned && (
                    <div style={{
                        display: "flex",
                        gap: 8, // Reduced gap
                        height: isMobileLayout ? "auto" : 140, 
                        width: "100%",
                        justifyContent: "center",
                        flexShrink: 0,
                        paddingLeft: (isDocOpen || isWhiteboardOpen) ? 16 : 0,
                        paddingRight: (isDocOpen || isWhiteboardOpen) ? 16 : 0,
                        boxSizing: "border-box"
                    }}>
                        {/* CAMERA 1: Left (Student Position) */}
                        <div style={{ 
                            height: isMobileLayout ? "auto" : "100%", 
                            width: isMobileLayout ? "50%" : "auto",
                            aspectRatio: "4/3", 
                            borderRadius: 16, 
                            overflow: "hidden", 
                            background: (role === "mentor" && !remoteStream) ? themeColors.surface : themeColors.card,
                            position: "relative"
                        }}>
                            {(!role && status === "idle" && !isLiveMode) ? (
                                <div 
                                    style={{ width: '100%', height: '100%' }}
                                    onClick={() => handleRoleSelect("student")}
                                >
                                    <RoleSelectionButton colors={themeColors} type="student" isCompact={true} isMobileLayout={isMobileLayout} />
                                </div>
                            ) : (
                                <VideoPlayer 
                                    // If I am Student -> Local. If Mentor -> Remote.
                                    stream={(role === "student" || isLiveMode) ? localStream : (role === "mentor" ? remoteStream : null)} 
                                    isMirrored={role === "student" || isLiveMode} 
                                    muted={role === "student" || isLiveMode} // Mute my own camera
                                    placeholder={role === "mentor" && !remoteStream ? "Waiting for student..." : undefined}
                                    style={transparentStyle}
                                    themeColors={themeColors}
                                />
                            )}
                        </div>

                        {/* CAMERA 2: Right (Mentor Position) */}
                        <div style={{ 
                            height: isMobileLayout ? "auto" : "100%", 
                            width: isMobileLayout ? "50%" : "auto",
                            aspectRatio: "4/3", 
                            borderRadius: 16, 
                            overflow: "hidden", 
                            background: (role === "student" && !remoteStream) ? themeColors.surface : themeColors.card,
                            position: "relative"
                        }}>
                            {isLiveMode ? (
                                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
                                     <svg
                                        width="48"
                                        height="48"
                                        viewBox="0 0 20 20"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        style={{
                                            animation: userIsSpeaking || isLiveGenerating ? "pulseStar 1.5s infinite ease-in-out" : "none",
                                            transition: "all 0.3s ease",
                                            transform: "scale(0.8)"
                                        }}
                                    >
                                        <path
                                            d="M9.291 1.32935C9.59351 0.762163 10.4065 0.762164 10.709 1.32935L13.4207 6.41384C13.4582 6.48418 13.5158 6.54176 13.5861 6.57927L18.6706 9.29099C19.2378 9.59349 19.2378 10.4065 18.6706 10.709L13.5861 13.4207C13.5158 13.4582 13.4582 13.5158 13.4207 13.5862L10.709 18.6706C10.4065 19.2378 9.59351 19.2378 9.291 18.6706L6.57927 13.5862C6.54176 13.5158 6.48417 13.4582 6.41384 13.4207L1.32934 10.709C0.762155 10.4065 0.762157 9.59349 1.32935 9.29099L6.41384 6.57927C6.48417 6.54176 6.54176 6.48418 6.57927 6.41384L9.291 1.32935Z"
                                            fill="#FFFFFF"
                                        />
                                    </svg>
                                    <style>{`
                                        @keyframes pulseStar {
                                            0% { transform: scale(0.95); opacity: 0.7; }
                                            50% { transform: scale(1.1); opacity: 1; }
                                            100% { transform: scale(0.95); opacity: 0.7; }
                                        }
                                    `}</style>
                                </div>
                            ) : (
                                (!role && status === "idle") ? (
                                    <div 
                                        style={{ width: '100%', height: '100%' }}
                                        onClick={() => handleRoleSelect("mentor")}
                                    >
                                        <RoleSelectionButton colors={themeColors} type="mentor" isCompact={true} isMobileLayout={isMobileLayout} />
                                    </div>
                                ) : (
                                role === "student" && isLiveMode ? (
                                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
                                         <svg
                                            width="32"
                                            height="32"
                                            viewBox="0 0 20 20"
                                            fill="none"
                                            xmlns="http://www.w3.org/2000/svg"
                                            style={{
                                                animation: userIsSpeaking || isLiveGenerating ? "pulseStar 1.5s infinite ease-in-out" : "none",
                                                transition: "all 0.3s ease"
                                            }}
                                        >
                                            <path
                                                d="M9.291 1.32935C9.59351 0.762163 10.4065 0.762164 10.709 1.32935L13.4207 6.41384C13.4582 6.48418 13.5158 6.54176 13.5861 6.57927L18.6706 9.29099C19.2378 9.59349 19.2378 10.4065 18.6706 10.709L13.5861 13.4207C13.5158 13.4582 13.4582 13.5158 13.4207 13.5862L10.709 18.6706C10.4065 19.2378 9.59351 19.2378 9.291 18.6706L6.57927 13.5862C6.54176 13.5158 6.48417 13.4582 6.41384 13.4207L1.32934 10.709C0.762155 10.4065 0.762157 9.59349 1.32935 9.29099L6.41384 6.57927C6.48417 6.54176 6.54176 6.48418 6.57927 6.41384L9.291 1.32935Z"
                                                fill="#FFFFFF"
                                            />
                                        </svg>
                                        <style>{`
                                            @keyframes pulseStar {
                                                0% { transform: scale(0.95); opacity: 0.7; }
                                                50% { transform: scale(1.1); opacity: 1; }
                                                100% { transform: scale(0.95); opacity: 0.7; }
                                            }
                                        `}</style>
                                    </div>
                                ) : (
                                <VideoPlayer 
                                    // If I am Student -> Remote. If Mentor -> Local.
                                    stream={role === "mentor" ? localStream : (role === "student" ? remoteStream : null)} 
                                    isMirrored={role === "mentor"} 
                                    muted={role === "mentor"} // Mute my own camera
                                    placeholder={role === "student" && !remoteStream ? "Waiting for mentor..." : undefined}
                                    style={transparentStyle}
                                    themeColors={themeColors}
                                />
                                )
                                )
                            )}
                        </div>
                    </div>
                    )}

                    {/* MAIN AREA: SCREEN SHARE */}
                    <div 
                        onPointerDown={handlePointerDown}
                        style={{
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
                        <div 
                            onPointerDown={(e) => e.stopPropagation()}
                            style={{
                            position: "relative",
                            // Use calculated dimensions if available, otherwise 100%
                            ...screenShareContainerStyle,
                            // Ensure it never exceeds the parent flex container
                            maxWidth: "100%",
                            maxHeight: "100%",
                            // borderRadius: 14, // Removed from here to allow handles to bleed
                            // overflow: "hidden", // Removed from here
                            marginTop: 0,
                            marginBottom: 0
                        }}>
                            {/* Drag Handles (Left/Right) - Only for screensharing */}
                            {!isDocOpen && !isWhiteboardOpen && (
                                <>
                                    <div 
                                        onPointerDown={(e) => handlePointerDown(e, 'left')}
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            bottom: 0,
                                            left: -12, // Extend outside
                                            width: 24, 
                                            cursor: "ew-resize", // Changed to ew-resize
                                            zIndex: 100, 
                                            touchAction: "none"
                                        }}
                                    />
                                    <div 
                                        onPointerDown={(e) => handlePointerDown(e, 'right')}
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            bottom: 0,
                                            right: -12, // Extend outside
                                            width: 24,
                                            cursor: "ew-resize", // Changed to ew-resize
                                            zIndex: 100,
                                            touchAction: "none"
                                        }}
                                    />
                                </>
                            )}

                            <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: (isDocOpen || isWhiteboardOpen) ? "28px 28px 0 0" : 14, position: "relative", background: (isDocOpen || isWhiteboardOpen) ? "white" : "transparent" }}>
                            {isDocOpen ? (
                                <DocEditor 
                                    content={docContent} 
                                    onChange={handleDocChange}
                                    settings={docSettings}
                                    onSettingsChange={setDocSettings}
                                    themeColors={themeColors}
                                    isMobileLayout={isMobileLayout}
                                    remoteCursor={remoteCursor}
                                    onCursorMove={handleDocPointerMove}
                                />
                            ) : isWhiteboardOpen ? (
                                <div 
                                    ref={whiteboardContainerRef}
                                    onPointerMove={handleWhiteboardPointerMove}
                                    style={{ width: '100%', height: '100%', background: '#FFF', position: 'relative', zIndex: 0 }} 
                                    onPointerDown={(e) => e.stopPropagation()}
                                >
                                    <Tldraw onMount={(e) => {
                                        log("Tldraw editor mounted")
                                        setEditor(e)
                                    }} />
                                    {remoteCursor && (
                                        <LiveCursor 
                                            x={remoteCursor.x} 
                                            y={remoteCursor.y} 
                                            color={remoteCursor.color} 
                                        />
                                    )}
                                </div>
                            ) : (
                                <>
                                    {hasWhiteboardStarted && (
                                         <div style={{ width: '100%', height: '100%', background: '#FFF', position: 'absolute', top: 0, left: 0, zIndex: -1, visibility: 'hidden', pointerEvents: 'none' }} onPointerDown={(e) => e.stopPropagation()}>
                                            <Tldraw onMount={(e) => {
                                                log("Hidden Tldraw editor mounted")
                                                setEditor(e)
                                            }} />
                                         </div>
                                    )}
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
                                        themeColors={themeColors}
                                    />
                                </>
                            )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                !isBanned && (
                // --- STANDARD LAYOUT (SPLIT VIEW) ---
                <div
                    style={{
                        flex: "1 1 0",
                        width: "100%",
                        display: "flex",
                        flexDirection: shouldUseHorizontalLayout ? "row" : "column",
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
                            borderRadius: finalHeight < (isMobileLayout ? 164 : 224) ? 16 : 32, // Smaller radius when compact
                            background: (!role && status === "idle" && !isLiveMode) ? themeColors.state.accent : ((role === "mentor" && !remoteStream) ? themeColors.surface : themeColors.card),
                            overflow: "hidden",
                            position: "relative",
                            flexShrink: 0,
                            cursor: (!role && status === "idle" && !isLiveMode) ? "pointer" : "default",
                            display: "flex",
                            flexDirection: "column",
                        }}
                        onClick={() => (!role && status === "idle" && !isLiveMode) && handleRoleSelect("student")}
                    >
                        {(!role && status === "idle" && !isLiveMode) ? (
                            <RoleSelectionButton colors={themeColors} type="student" isCompact={finalHeight < (isMobileLayout ? 164 : 224)} isMobileLayout={isMobileLayout} />
                        ) : (
                            (role === "student" || isLiveMode) ? (
                                // --- LOCAL USER (STUDENT) ---
                                <VideoPlayer stream={localStream} isMirrored={true} muted={true} themeColors={themeColors} />
                            ) : (
                                // --- REMOTE USER (STUDENT) ---
                                status === "connected" ? (
                                    <VideoPlayer stream={remoteStream} isMirrored={false} themeColors={themeColors} />
                                ) : (
                                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: themeColors.text.secondary, fontSize: 15 }}>Searching for student</div>
                                )
                            )
                        )}
                    </div>

                    {/* ITEM 2: Mentor Card OR Right Video */}
                    <div
                        style={{
                            width: finalWidth,
                            height: finalHeight,
                            borderRadius: finalHeight < (isMobileLayout ? 164 : 224) ? 16 : 32, // Smaller radius when compact
                            background: (role === "student" && !remoteStream) ? themeColors.surface : themeColors.card,
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
                            <RoleSelectionButton colors={themeColors} type="mentor" isCompact={finalHeight < (isMobileLayout ? 164 : 224)} isMobileLayout={isMobileLayout} />
                        ) : (
                            role === "mentor" ? (
                                // --- LOCAL USER (MENTOR) ---
                                <VideoPlayer stream={localStream} isMirrored={true} muted={true} themeColors={themeColors} />
                            ) : (
                                // --- REMOTE USER (MENTOR) ---
                                status === "connected" ? (
                                    isLiveMode ? (
                                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
                                             <svg
                                                width="64"
                                                height="64"
                                                viewBox="0 0 20 20"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                                style={{
                                                    animation: userIsSpeaking || isLiveGenerating ? "pulseStar 1.5s infinite ease-in-out" : "none",
                                                    transition: "all 0.3s ease"
                                                }}
                                            >
                                                <path
                                                    d="M9.291 1.32935C9.59351 0.762163 10.4065 0.762164 10.709 1.32935L13.4207 6.41384C13.4582 6.48418 13.5158 6.54176 13.5861 6.57927L18.6706 9.29099C19.2378 9.59349 19.2378 10.4065 18.6706 10.709L13.5861 13.4207C13.5158 13.4582 13.4582 13.5158 13.4207 13.5862L10.709 18.6706C10.4065 19.2378 9.59351 19.2378 9.291 18.6706L6.57927 13.5862C6.54176 13.5158 6.48417 13.4582 6.41384 13.4207L1.32934 10.709C0.762155 10.4065 0.762157 9.59349 1.32935 9.29099L6.41384 6.57927C6.48417 6.54176 6.54176 6.48418 6.57927 6.41384L9.291 1.32935Z"
                                                    fill="#FFFFFF"
                                                />
                                            </svg>
                                            <style>{`
                                                @keyframes pulseStar {
                                                    0% { transform: scale(0.95); opacity: 0.7; }
                                                    50% { transform: scale(1.1); opacity: 1; }
                                                    100% { transform: scale(0.95); opacity: 0.7; }
                                                }
                                            `}</style>
                                        </div>
                                    ) : (
                                        <VideoPlayer stream={remoteStream} isMirrored={false} themeColors={themeColors} />
                                    )
                                ) : (
                                <div data-layer="tile" className="Tile" style={{alignSelf: 'stretch', height: "100%", padding: 16, background: 'transparent', overflow: 'hidden', borderRadius: 28, flexDirection: 'column', justifyContent: 'center', alignItems: 'center', display: 'flex'}}>
                                      <div data-layer="Searching for mentor" className="SearchingForMentor" style={{textAlign: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column', color: themeColors.text.primary, fontSize: 15, fontFamily: 'Inter', fontWeight: '400', lineHeight: 1.4, wordWrap: 'break-word'}}>Searching for mentor</div>
                                      <div 
                                        onClick={handleConnectWithAI}
                                        data-layer="Or connect with AI" 
                                        className="OrConnectWithAi" 
                                        style={{
                                            height: 44, 
                                            textAlign: 'center', 
                                            justifyContent: 'center', 
                                            display: 'flex', 
                                            flexDirection: 'column', 
                                            color: colors.text.secondary, 
                                            fontSize: 15, 
                                            fontFamily: 'Inter', 
                                            fontWeight: '400', 
                                            lineHeight: 1.4, 
                                            wordWrap: 'break-word',
                                            cursor: 'pointer',
                                            width: '100%',
                                            marginTop: -4 // Negative gap to pull closer as requested
                                        }}
                                      >Or connect with AI</div>
                                    </div>
                                )
                            )
                        )}
                    </div>
                </div>
            ))}

            {/* 2. DRAG HANDLE (Chat Drawer Control) */}
            {(!isBanned || (isScreenSharing || !!remoteScreenStream || isWhiteboardOpen || isDocOpen)) && <div
                onPointerDown={handlePointerDown}
                style={{
                    height: 24,
                    width: "100%",
                    background: (isDocOpen || isWhiteboardOpen) ? "white" : "transparent",
                    ...styles.flexCenter,
                    cursor: "ns-resize",
                    flexShrink: 0,
                    touchAction: "none",
                    zIndex: 20, // Lowered from 25 to be below menu (100)
                }}
            >
                <div
                    style={{
                        width: 32,
                        height: 4,
                        borderRadius: 2,
                        background: (isDocOpen || isWhiteboardOpen) ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.2)"
                    }}
                />
            </div>}

            {/* 3. AI CHAT HISTORY LAYER */}
            <div style={{ width: "100%", height: (isBanned && !(isScreenSharing || !!remoteScreenStream || isWhiteboardOpen || isDocOpen)) ? "100%" : "auto", background: (isDocOpen || isWhiteboardOpen) ? "white" : "transparent", display: "flex", justifyContent: "center" }}>
            <div 
                style={{
                    height: (isBanned && !(isScreenSharing || !!remoteScreenStream || isWhiteboardOpen || isDocOpen)) ? "100%" : chatHeight,
                    paddingTop: (isBanned && !(isScreenSharing || !!remoteScreenStream || isWhiteboardOpen || isDocOpen)) ? 24 : 0,
                    width: "100%",
                    maxWidth: 728,
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <div
                    ref={chatHistoryRef}
                    style={{
                        flex: 1,
                        width: "100%",
                        padding: "0 24px",
                        // FIX: Standard padding.
                        // We rely on the "minHeight" logic of the last message/loader to handle the "void" dynamically.
                        // This removes the permanent giant void at the bottom.
                        paddingBottom: 90, 
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                        overscrollBehavior: "contain",
                        WebkitOverflowScrolling: "touch",
                        position: "relative" // Ensure offsetTop calculations work correctly
                    }}
                >
                    {messages.map((msg, idx) => (
                        <MessageBubble key={idx} id={`msg-${idx}`} msg={msg} isMobileLayout={isMobileLayout} isLast={idx === messages.length - 1} themeColors={chatThemeColors} />
                    ))}
                    {isLoading && (!messages.length || messages[messages.length - 1].role !== "model" || messages[messages.length - 1].text.length === 0) && (
                        <div style={{ 
                            paddingLeft: 8, 
                            paddingBottom: 8,
                            minHeight: "auto"
                        }}>
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
                                            fill={chatThemeColors.text.primary}
                                        />
                                    </g>
                                    <defs>
                                        <clipPath id="clipLoadAnimMentorship">
                                            <rect
                                                width="20"
                                                height="20"
                                                fill={chatThemeColors.text.primary}
                                            />
                                        </clipPath>
                                    </defs>
                                </svg>
                            </div>
                        </div>
                    )}
                    <div />
                </div>

                {/* 4. CHAT INPUT INTERFACE */}
                <div
                    style={{
                        position: (isBanned && !(isScreenSharing || !!remoteScreenStream || isWhiteboardOpen || isDocOpen)) ? "fixed" : "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        width: "100%",
                        display: "flex",
                        justifyContent: "center",
                        zIndex: 1000, // Elevated to ensure menus appear above everything
                        pointerEvents: "none", // Let clicks pass through outside the input
                        paddingBottom: "env(safe-area-inset-bottom)",
                        touchAction: "none",
                    }}
                >
                    <ChatInput 
                        value={inputText}
                        onChange={(e) => {
                            const newValue = e.target.value
                            setInputText(newValue)
                            
                            // Broadcast input change
                            const now = Date.now()
                            const interval = 50 // Throttle updates
                            const timeSinceLastSend = now - lastInputSendTimeRef.current
                            
                            if (inputTimeoutRef.current) clearTimeout(inputTimeoutRef.current)

                            if (timeSinceLastSend > interval) {
                                if (dataConnectionRef.current?.open) {
                                    dataConnectionRef.current.send({ type: 'input-sync', payload: newValue })
                                    lastInputSendTimeRef.current = now
                                }
                            } else {
                                inputTimeoutRef.current = setTimeout(() => {
                                    if (dataConnectionRef.current?.open) {
                                        dataConnectionRef.current.send({ type: 'input-sync', payload: newValue })
                                        lastInputSendTimeRef.current = Date.now()
                                    }
                                }, interval - timeSinceLastSend)
                            }
                        }}
                        onSend={handleSendMessage}
                        onConnectWithAI={handleConnectWithAI}
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
                        isWhiteboardOpen={isWhiteboardOpen}
                        toggleWhiteboard={toggleWhiteboard}
                        isDocOpen={isDocOpen}
                        toggleDoc={toggleDoc}
                        isConnected={status === "connected" && !isLiveMode}
                        isMobileLayout={isMobileLayout}
                        isLiveMode={isLiveMode}
                        onPasteFile={processFiles}
                        themeColors={chatThemeColors}
                    />
                </div>
            </div>
            </div>

            {/* REPORT MODAL */}
            <ReportModal 
                isOpen={showReportModal} 
                onClose={() => setShowReportModal(false)} 
                onSubmit={onSubmitReport} 
            />

            {/* FILE DRAG OVERLAY */}
            <div style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                zIndex: 99999,
                background: themeColors.state.overlay,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                opacity: isDraggingFile ? 1 : 0,
                visibility: isDraggingFile ? "visible" : "hidden"
            }}>
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 16
                }}>
                    <div data-svg-wrapper data-layer="share icon" className="ShareIcon">
                        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3.01893e-06 43.6383V42.9137C3.01893e-06 41.311 1.29968 40.0112 2.9027 40.0112C4.50572 40.0112 5.8054 41.311 5.8054 42.9137V43.6383C5.8054 46.7411 5.80937 48.8951 5.94607 50.569C6.07998 52.2083 6.32803 53.1315 6.67921 53.8211L6.98609 54.3754C7.75563 55.6298 8.85998 56.6529 10.1786 57.3251L10.7455 57.5677C11.373 57.7925 12.2002 57.9575 13.4308 58.0579C15.1048 58.195 17.258 58.1945 20.3615 58.1945H43.6386C46.741 58.1945 48.8955 58.195 50.5693 58.0579C52.2074 57.9243 53.1318 57.676 53.8214 57.3251L54.3753 57.0139C55.6297 56.2444 56.6533 55.1397 57.325 53.8211L57.5681 53.2546C57.7924 52.6269 57.9574 51.7989 58.0583 50.569C58.1949 48.8951 58.1944 46.7411 58.1944 43.6383V42.9137C58.1944 41.3114 59.4947 40.0121 61.0974 40.0112C62.7001 40.0112 63.9999 41.311 63.9999 42.9137V43.6383C63.9999 46.6455 64.0025 49.0771 63.8423 51.0421C63.6992 52.7923 63.4155 54.3684 62.7852 55.8376L62.4954 56.4595C61.3366 58.7336 59.5737 60.6352 57.4101 61.9626L56.4599 62.4951C54.8153 63.3331 53.0415 63.6788 51.042 63.842C49.077 64.0026 46.6459 64 43.6386 64H20.3615C17.3538 64 14.9229 64.0026 12.9577 63.842C11.2095 63.6993 9.63424 63.4186 8.16678 62.7892L7.54446 62.4951C5.26993 61.3362 3.36475 59.5742 2.03744 57.4102L1.50464 56.4595C0.666753 54.8154 0.32107 53.0411 0.157743 51.0421C-0.00274689 49.0771 3.01893e-06 46.6455 3.01893e-06 43.6383ZM29.0994 42.9137V9.91008L19.5047 19.5047C18.3715 20.638 16.5336 20.6375 15.4 19.5047C14.2666 18.3712 14.2666 16.5336 15.4 15.4L29.9476 0.848235L30.3909 0.485922C30.864 0.170791 31.4253 0 32.0019 0C32.7705 0.000392823 33.5086 0.305092 34.0524 0.848235L48.6043 15.4C49.7361 16.5334 49.7365 18.3717 48.6043 19.5047C47.4708 20.6382 45.6285 20.6382 44.495 19.5047L34.9049 9.91432V42.9137C34.904 44.5156 33.6042 45.8158 32.0019 45.8167C30.3995 45.8167 29.1002 44.516 29.0994 42.9137Z" fill="#0099FF" fillOpacity="0.95"/>
                        </svg>
                    </div>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 16,  lineHeight: 1.4 }}>Add anything</div>
                        <div style={{ fontSize: 14, opacity: 0.65, fontWeight: 400, lineHeight: 1.4 }}>Drop any file here to add it to the conversation</div>
                    </div>
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
        description: "Enables an on-screen console overlay for bugs and issues.",
    },
})
