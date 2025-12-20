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
}

interface Message {
    role: string
    text: string
    imageUrl?: string
    attachmentName?: string
    attachmentType?: string
}

// --- HELPER COMPONENT: CHAT INPUT BAR ---
interface ChatInputProps {
    value: string
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    onSend: () => void
    onEndCall: () => void
    onFileSelect: () => void
    placeholder?: string
    showEndCall?: boolean
    imagePreviewUrl?: string
    attachmentPreview?: { name: string; type: string } | null
    onRemoveAttachment?: () => void
    isLoading?: boolean
}

function ChatInput({ 
    value, 
    onChange, 
    onSend, 
    onEndCall, 
    onFileSelect, 
    placeholder = "Ask anything", 
    showEndCall = true,
    imagePreviewUrl = "",
    attachmentPreview = null,
    onRemoveAttachment,
    isLoading = false
}: ChatInputProps) {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)

    // Auto-resize logic to mimic Gemini's behavior
    React.useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "24px" // Reset to calculate correct scrollHeight
            const scrollHeight = textareaRef.current.scrollHeight
            // Expand up to ~148px (approx 6 lines)
            textareaRef.current.style.height = Math.min(scrollHeight, 148) + "px"
        }
    }, [value])

    const hasContent = value.trim() || imagePreviewUrl || attachmentPreview

    return (
        <div data-layer="flexbox" className="Flexbox" style={{width: '100%', maxWidth: 728, position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 0, paddingLeft: 24, paddingRight: 24, boxSizing: "border-box"}}>
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
                gap: 8,
                pointerEvents: "auto"
            }}>
              
              {/* ATTACHMENTS ROW */}
              {(imagePreviewUrl || attachmentPreview) && (
                  <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      paddingTop: 8, // Space for close button
                      paddingLeft: 0, // Aligned with start of input box content
                      width: '100%'
                  }}>
                      <div style={{
                            position: 'relative',
                            width: 48,
                            height: 48,
                            flexShrink: 0,
                            borderRadius: 12, // More rounded for chip look
                            overflow: 'visible',
                            display: 'flex',
                            background: imagePreviewUrl ? 'transparent' : 'rgba(255,255,255,0.1)',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: imagePreviewUrl ? 'none' : '1px solid rgba(255,255,255,0.1)'
                        }}>
                            {/* Remove Button */}
                            <div 
                                onClick={(e) => {
                                    e.stopPropagation()
                                    if(onRemoveAttachment) onRemoveAttachment()
                                }}
                                style={{
                                    position: "absolute",
                                    right: -6,
                                    top: -6,
                                    width: 20,
                                    height: 20,
                                    borderRadius: 10,
                                    background: "#303030", // Match input bg
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    border: "1.5px solid #555", // Distinct border
                                    zIndex: 10
                                }}
                            >
                                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M1 1L9 9M9 1L1 9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </div>

                            {/* Thumbnail / Icon */}
                            {imagePreviewUrl ? (
                                <img 
                                    src={imagePreviewUrl} 
                                    alt="Preview" 
                                    style={{
                                        width: 48,
                                        height: 48,
                                        borderRadius: 12,
                                        objectFit: 'cover',
                                        display: 'block'
                                    }}
                                />
                            ) : (
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" fill="rgba(255,255,255,0.2)"/>
                                    <path d="M14 2V8H20" fill="rgba(255,255,255,0.4)"/>
                                </svg>
                            )}
                        </div>
                  </div>
              )}

              {/* INPUT ROW: [Plus] [Text] [Send] */}
              <div style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 12,
                  width: '100%'
              }}>
                  {/* UPLOAD ICON */}
                  <div 
                    data-svg-wrapper 
                    data-layer="upload-button" 
                    className="UploadButton" 
                    onClick={onFileSelect}
                    style={{
                      cursor: isLoading ? "not-allowed" : "pointer", 
                      opacity: isLoading ? 0.3 : 0.65,
                      pointerEvents: isLoading ? "none" : "auto",
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
                        disabled={isLoading}
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

                  {/* SEND BUTTON */}
                  <div 
                    data-svg-wrapper 
                    data-layer="send-button" 
                    className="SendButton" 
                    onClick={() => {
                      if (hasContent && !isLoading) onSend()
                    }}
                    style={{
                      cursor: (hasContent && !isLoading) ? "pointer" : "not-allowed", 
                      display: hasContent ? "block" : "none",
                      opacity: isLoading ? 0.5 : 1,
                      width: 36,
                      height: 36
                    }}
                  >
                    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect width="36" height="36" rx="18" fill="white" fillOpacity="0.95"/>
                    <path fillRule="evenodd" clipRule="evenodd" d="M14.5611 18.1299L16.8709 15.8202V23.3716C16.8709 23.9948 17.3762 24.5 17.9994 24.5C18.6226 24.5 19.1278 23.9948 19.1278 23.3716V15.8202L21.4375 18.1299C21.8782 18.5706 22.5927 18.5706 23.0334 18.1299C23.4741 17.6893 23.4741 16.9748 23.0334 16.5341L17.9994 11.5L12.9653 16.5341C12.5246 16.9748 12.5246 17.6893 12.9653 18.1299C13.406 18.5706 14.1204 18.5706 14.5611 18.1299Z" fill="black" fillOpacity="0.95"/>
                    </svg>
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

/**
 * OmegleMentorshipUI
 * Main component handling video streaming, real-time signaling, and AI-assisted chat.
 */
export default function OmegleMentorshipUI(props: Props) {
    const { geminiApiKey, systemPrompt, accentColor, model = "gemini-2.5-flash-lite" } = props

    // --- STATE: WEBRTC & CONNECTIVITY ---
    // status: tracks the lifecycle of the connection (idle -> searching -> connected)
    const [status, setStatus] = React.useState("idle")
    const [ready, setReady] = React.useState(false) // Tracks if external scripts are loaded
    
    /**
     * User's session role.
     * student: "Get free help" user seeking guidance.
     * mentor:  "Volunteer" user providing guidance.
     */
    const [role, setRole] = React.useState<"student" | "mentor" | null>(null)
    const roleRef = React.useRef(role)
    React.useEffect(() => { roleRef.current = role }, [role])

    // --- REFS: DOM & PERSISTENT OBJECTS ---
    const localVideoRef = React.useRef<HTMLVideoElement>(null)
    const remoteVideoRef = React.useRef<HTMLVideoElement>(null)
    const localStreamRef = React.useRef<MediaStream | null>(null)
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

    // --- STATE: FILE UPLOADS ---
    const [imageFile, setImageFile] = React.useState<File | null>(null)
    const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string>("")
    const [attachmentFile, setAttachmentFile] = React.useState<File | null>(null)
    const [attachmentPreview, setAttachmentPreview] = React.useState<{
        name: string
        type: string
    } | null>(null)
    const fileInputRef = React.useRef<HTMLInputElement | null>(null)

    // --- STATE: RESPONSIVE UI ---
    const [chatHeight, setChatHeight] = React.useState(300) // Height of the chat drawer
    const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 })
    const isDragging = React.useRef(false)
    const dragStartY = React.useRef(0)
    const dragStartHeight = React.useRef(0)
    const containerRef = React.useRef<HTMLDivElement>(null)
    const rafRef = React.useRef<number | null>(null)

    // Helper for standardized console logging
    const log = (msg: string) => {
        console.log(`[Curastem Mentorship] ${msg}`)
    }

    // Detect mobile for capture attribute
    const isMobile = React.useMemo(() => {
        if (typeof window === "undefined") return false
        return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    }, [])

    // --- EFFECT: HANDLE IMAGE PREVIEW ---
    React.useEffect(() => {
        if (imageFile && typeof window !== "undefined" && imageFile.type && imageFile.type.startsWith("image/")) {
            const objectUrl = URL.createObjectURL(imageFile)
            setImagePreviewUrl(objectUrl)
            return () => URL.revokeObjectURL(objectUrl)
        } else {
            const isVideoSelected = !!(attachmentFile && attachmentFile.type.startsWith("video/"))
            if (!isVideoSelected) setImagePreviewUrl("")
        }
    }, [imageFile, attachmentFile])

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
    // When the first message arrives, set chat height to maximum so items (cards or videos) fill width at top
    React.useEffect(() => {
        if (containerSize.width === 0 || containerSize.height === 0) return
        if (messages.length === 0) return
        
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
        
        // Only auto-maximize if we haven't manually resized yet (heuristic: chatHeight is default 300)
        // AND if we are in the "cards" mode (no role yet), OR if we want it to happen for videos too (which is now requested)
        if (chatHeight === 300) {
             setChatHeight(Math.max(100, maxChatHeight))
        }
    }, [messages.length, containerSize, role])

    const handleRoleSelect = (selectedRole: "student" | "mentor") => {
        if (typeof window !== "undefined") {
            window.location.hash = `#${selectedRole}`
        }
        setRole(selectedRole)
        // Smoothly transition chat height to normal video view size
        setChatHeight(300)
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
        if (activeCall.current) activeCall.current.close()
        if (peerInstance.current) peerInstance.current.destroy()
        if (mqttClient.current) mqttClient.current.end()
        setStatus("idle")
        setRole(null)
        if (typeof window !== "undefined") {
            window.location.hash = ""
        }
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
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream
                localVideoRef.current.muted = true
            }

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
            if (statusRef.current === "connected") return
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

        call.on("stream", (remoteStream: any) => {
            log("Remote stream received. Synchronizing video...")
            if (remoteVideoRef.current)
                remoteVideoRef.current.srcObject = remoteStream
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

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files && e.target.files[0]
        if (!file) {
            setImageFile(null)
            setAttachmentFile(null)
            setAttachmentPreview(null)
            return
        }

        if (file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
            alert(`File size exceeds ${MAX_UPLOAD_SIZE_MB}MB limit.`)
            if (fileInputRef.current) fileInputRef.current.value = ""
            return
        }

        const isImage = file.type.startsWith("image/")
        const isVideo = file.type.startsWith("video/")

        if (isImage) {
            setImageFile(file)
            setAttachmentFile(null)
            setAttachmentPreview(null)
        } else if (isVideo) {
            // Generate video thumbnail
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
                        setImagePreviewUrl(dataUrl)
                        setAttachmentFile(file)
                        setImageFile(null)
                        setAttachmentPreview(null)
                        try {
                            URL.revokeObjectURL(url)
                        } catch {}
                    }
                }
                video.onloadedmetadata = () => {
                    video.currentTime = 1.0
                }
                video.onseeked = () => capture()
                video.onerror = () => {
                    setAttachmentFile(file)
                    setAttachmentPreview({ name: file.name, type: file.type })
                    setImagePreviewUrl("")
                    try {
                        URL.revokeObjectURL(url)
                    } catch {}
                }
            } catch {
                setAttachmentFile(file)
                setAttachmentPreview({ name: file.name, type: file.type })
                setImagePreviewUrl("")
            }
        } else {
            setAttachmentFile(file)
            setAttachmentPreview({ name: file.name, type: file.type })
            setImageFile(null)
            setImagePreviewUrl("")
        }
    }

    const handleRemoveAttachment = () => {
        setImageFile(null)
        setAttachmentFile(null)
        setAttachmentPreview(null)
        setImagePreviewUrl("")
        if (fileInputRef.current) fileInputRef.current.value = ""
    }

    // --- AI CHAT (GEMINI) LOGIC ---

    /**
     * Handles message delivery to the Google Gemini API.
     */
    const handleSendMessage = async () => {
        if (!inputText.trim() && !imageFile && !attachmentFile) return
        if (!geminiApiKey) {
            setMessages(prev => [...prev, { role: "model", text: "Please provide a Gemini API Key in the properties panel." }])
            return
        }

        const textToSend = inputText
        const imageFileToSend = imageFile
        const attachmentFileToSend = attachmentFile

        // Build user message for display
        const userMsg: Message = { 
            role: "user", 
            text: textToSend,
            imageUrl: imagePreviewUrl || undefined,
            attachmentName: attachmentFileToSend?.name || undefined,
            attachmentType: attachmentFileToSend?.type || undefined
        }
        setMessages(prev => [...prev, userMsg])
        setInputText("")
        setImageFile(null)
        setAttachmentFile(null)
        setAttachmentPreview(null)
        setImagePreviewUrl("")
        if (fileInputRef.current) fileInputRef.current.value = ""
        setIsLoading(true)

        try {
            // Build API payload
            let userContent: any = []

            if (textToSend.trim()) {
                userContent.push({ text: textToSend })
            }

            // Handle image
            if (imageFileToSend) {
                const base64 = await new Promise<string>((resolve, reject) => {
                    if (typeof window !== "undefined" && window.FileReader) {
                        const reader = new window.FileReader()
                        reader.onload = () => {
                            const result = reader.result as string
                            if (typeof result === "string") {
                                const base64str = result.substring(result.indexOf(",") + 1)
                                resolve(base64str)
                            } else {
                                reject(new Error("Failed to read image as base64 string"))
                            }
                        }
                        reader.onerror = reject
                        reader.readAsDataURL(imageFileToSend)
                    } else {
                        reject(new Error("FileReader API not available"))
                    }
                })
                userContent.push({
                    inlineData: {
                        mimeType: imageFileToSend.type,
                        data: base64
                    }
                })
            }

            // Handle attachment (video or file)
            if (attachmentFileToSend) {
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader()
                    reader.onload = () => {
                        const result = reader.result as string
                        resolve(result.substring(result.indexOf(",") + 1))
                    }
                    reader.onerror = reject
                    reader.readAsDataURL(attachmentFileToSend)
                })
                userContent.push({
                    inlineData: {
                        mimeType: attachmentFileToSend.type || "application/octet-stream",
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
                    body: JSON.stringify(payload)
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
            console.error("Network Error:", error)
            setMessages(prev => [...prev, { role: "model", text: `Error connecting to Gemini: ${error.message}` }])
        } finally {
            setIsLoading(false)
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
            const maxHeight = containerHeight - 100 // Maintain visibility for the video area

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
    const hasMessages = messages.length > 0
    const currentChatHeight = hasMessages ? chatHeight : 0
    
    // Detect mobile vs desktop based on container width
    const isMobileLayout = containerSize.width < 768

    // Calculates the ideal dimensions for the video containers while preserving aspect ratio.
    const videoSectionHeight = containerSize.height - currentChatHeight - (hasMessages ? 40 : 120)
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
            font-size: 14px;
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
            font-size: 0.85em;
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
                accept="image/*,video/*,audio/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                capture={isMobile ? "environment" : undefined}
                style={{ display: "none" }}
                onChange={handleFileChange}
            />

            {/* 1. CONTENT RENDERING LAYER (Unified for Cards & Videos) */}
            <style>{markdownStyles}</style>
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
                    paddingBottom: hasMessages ? 0 : 100,
                    alignItems: (hasMessages && !isMobileLayout) ? "flex-end" : "center", 
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
                            <video ref={localVideoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
                        ) : (
                            status === "connected" ? (
                                <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
                            <video ref={localVideoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
                        ) : (
                            status === "connected" ? (
                                <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255, 255, 255, 0.45)", fontSize: 15 }}>Searching for mentor...</div>
                            )
                        )
                    )}
                </div>
            </div>

            {/* 2. DRAG HANDLE (Chat Drawer Control) */}
            {hasMessages && (
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
            )}

            {/* 3. AI CHAT HISTORY LAYER */}
            <div 
                style={{
                    height: currentChatHeight,
                    width: "100%",
                    maxWidth: 728,
                    margin: "0 auto",
                    position: "relative",
                    display: hasMessages ? "flex" : "none",
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
                                {/* Display attachment/image preview in message */}
                                {msg.role === "user" && (msg.imageUrl || msg.attachmentName) && (
                                    <div style={{ 
                                        marginBottom: 4,
                                        width: "100%",
                                        display: "flex",
                                        justifyContent: "flex-end"
                                    }}>
                                        {msg.imageUrl ? (
                                            <img 
                                                src={msg.imageUrl} 
                                                alt="Uploaded" 
                                                style={{
                                                    maxHeight: 128,
                                                    width: "auto",
                                                    maxWidth: "100%",
                                                    borderRadius: 16, // Matches Gemini's radius
                                                    display: 'block',
                                                    objectFit: "contain"
                                                }}
                                            />
                                        ) : msg.attachmentName ? (
                                            <div style={{
                                                padding: '12px 16px',
                                                background: 'rgba(255, 255, 255, 0.1)',
                                                borderRadius: 16,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 12,
                                                width: "auto"
                                            }}>
                                                <div style={{
                                                    width: 40,
                                                    height: 40,
                                                    flexShrink: 0
                                                }}>
                                                    <svg width="100%" height="100%" viewBox="0 0 49 49" fill="none">
                                                        <path d="M0.8125 14.6777C0.8125 6.94575 7.08051 0.677734 14.8125 0.677734H48.8125V48.6777H14.8125C7.08051 48.6777 0.8125 42.4097 0.8125 34.6777V14.6777Z" fill="#6AA4FB"/>
                                                        <path d="M15.8125 17.6777C15.8125 17.1254 16.2602 16.6777 16.8125 16.6777H32.8125C33.3648 16.6777 33.8125 17.1254 33.8125 17.6777C33.8125 18.23 33.3648 18.6777 32.8125 18.6777H16.8125C16.2602 18.6777 15.8125 18.23 15.8125 17.6777ZM15.8125 24.6777C15.8125 24.1254 16.2602 23.6777 16.8125 23.6777H32.8125C33.3648 23.6777 33.8125 24.1254 33.8125 24.6777C33.8125 25.23 33.3648 25.6777 32.8125 25.6777H16.8125C16.2602 25.6777 15.8125 25.23 15.8125 24.6777ZM15.8125 31.6777C15.8125 31.1255 16.2602 30.6777 16.8125 30.6777H23.8125C24.3648 30.6777 24.8125 31.1255 24.8125 31.6777C24.8125 32.23 24.3648 32.6777 23.8125 32.6777H16.8125C16.2602 32.6777 15.8125 32.23 15.8125 31.6777Z" fill="white" fillOpacity="0.95"/>
                                                    </svg>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                    <div style={{
                                                        color: 'rgba(255,255,255,0.95)',
                                                        fontSize: 13,
                                                        fontWeight: 500,
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        maxWidth: 200
                                                    }}>
                                                        {msg.attachmentName}
                                                    </div>
                                                    <div style={{
                                                        color: 'rgba(255,255,255,0.65)',
                                                        fontSize: 11,
                                                        fontWeight: 400
                                                    }}>
                                                        {msg.attachmentType?.split('/')[1]?.toUpperCase() || 'FILE'}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                                
                                {/* Text content */}
                                {msg.text && (
                                    <div style={{ 
                                        padding: msg.role === "user" ? "10px 16px" : "0", 
                                        borderRadius: msg.role === "user" ? 20 : 0,
                                        background: msg.role === "user" ? "rgba(255, 255, 255, 0.08)" : "transparent",
                                        color: "rgba(255,255,255,0.95)",
                                        lineHeight: 1.5,
                                        fontSize: 14,
                                        alignSelf: msg.role === "user" ? "flex-end" : "flex-start"
                                    }}>
                                        {msg.role === "user" 
                                            ? msg.text 
                                            : renderSimpleMarkdown(
                                                msg.text, 
                                                { fontSize: 14, color: "rgba(255,255,255,0.95)", lineHeight: 1.5 },
                                                { color: "#4DA6FF", textDecoration: "underline" }
                                              )
                                        }
                                    </div>
                                )}
                             </div>
                         </div>
                    ))}
                    {isLoading && <div style={{ opacity: 0.5, fontSize: 12, paddingLeft: 8 }}>Mentor assistant is thinking...</div>}
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
                        onEndCall={cleanup}
                        onFileSelect={handleFileSelect}
                        placeholder="Ask anything"
                        showEndCall={status !== "idle"}
                        imagePreviewUrl={imagePreviewUrl}
                        attachmentPreview={attachmentPreview}
                        onRemoveAttachment={handleRemoveAttachment}
                        isLoading={isLoading}
                    />
                </div>
            </div>

            {/* INITIAL STATE INPUT (Visible when history is empty) */}
            {!hasMessages && (
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
                        pointerEvents: "none",
                    }}
                >
                    <ChatInput 
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onSend={handleSendMessage}
                        onEndCall={cleanup}
                        onFileSelect={handleFileSelect}
                        placeholder="Ask anything"
                        showEndCall={status !== "idle"}
                        imagePreviewUrl={imagePreviewUrl}
                        attachmentPreview={attachmentPreview}
                        onRemoveAttachment={handleRemoveAttachment}
                        isLoading={isLoading}
                    />
                </div>
            )}

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
})
